import { Melees } from "@common/definitions/items/melees";

export interface MeleeInfo {
    id: string;
    score: number; // 0 - 100, higher is better
}

// Ordered from best to worst as per requirement
const MELEE_ORDER = [
    "steelfang",
    "pan",
    "maul",
    "fire_hatchet",
    "falchion",
    "baseball_bat",
    "sickle",
    "ice_pick",
    "kukri",
    "seax",
    "hatchet",
    "pipe_wrench",
    "heap_sword", // Adding some others that were in the file but not the list
    "crowbar",
    "kbar",
    "gas_can",
    "hand_saw",
    "fists"
];

const MELEE_SCORES: Record<string, number> = {};
MELEE_ORDER.forEach((id, index) => {
    MELEE_SCORES[id] = 100 - (index * (100 / MELEE_ORDER.length));
});

export class MeleeEvaluator {
    static getMeleeInfo(meleeId: string): MeleeInfo {
        const score = MELEE_SCORES[meleeId];
        if (score !== undefined) {
            return { id: meleeId, score };
        }

        // Fallback for unknown melee weapons
        const def = Melees.definitions.find(m => m.idString === meleeId);
        if (!def) {
            return { id: meleeId, score: 0 };
        }

        // Basic score based on damage and radius if unknown
        const baseScore = (def.damage * 1.5) + (def.radius * 5);
        return { id: meleeId, score: Math.min(baseScore, 40) }; // Keep unknown ones relatively low
    }

    static shouldSwap(currentMeleeId: string | null, groundMeleeId: string): boolean {
        if (!currentMeleeId || currentMeleeId === 'fists') return true;
        
        const current = this.getMeleeInfo(currentMeleeId);
        const ground = this.getMeleeInfo(groundMeleeId);

        return ground.score > current.score;
    }
}
