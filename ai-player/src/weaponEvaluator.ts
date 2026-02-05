import { Guns } from "@common/definitions/items/guns";
import { FireMode } from "@common/constants";

export enum WeaponCategory {
    Primary = "Primary",   // AR, LMG, DMR - Best for Slot 1
    CQC = "CQC",           // Shotgun, SMG - Best for Slot 2
    Sniper = "Sniper",     // Long range, slow fire
    Sidearm = "Sidearm",   // Pistols
    Special = "Special",   // Launchers, etc.
    Unknown = "Unknown"
}

export interface WeaponInfo {
    id: string;
    category: WeaponCategory;
    score: number; // 0 - 100, higher is better for Offensive AI
}

// Configuration optimized for an Aggressive/Offensive Playstyle
// Priority: High Burst/DPS > Versatility > Range
const WEAPON_CONFIG: Record<string, { category: WeaponCategory, score: number }> = {
    // --- SHOTGUNS (CQC Kings) ---
    "usas12": { category: WeaponCategory.CQC, score: 100 }, // Explosive auto shotgun
    "saiga12": { category: WeaponCategory.CQC, score: 95.9 }, // Assuming existence or similar
    "mp153": { category: WeaponCategory.CQC, score: 92.9 },
    "vepr12": { category: WeaponCategory.CQC, score: 90.9 },
    "m3k": { category: WeaponCategory.CQC, score: 88.9 },
    "m590m": { category: WeaponCategory.CQC, score: 85.9 },
    "hp18": { category: WeaponCategory.CQC, score: 83.0 }, // Functionally similar to 940 Pro (Removed) / M590
    "stevens_555": { category: WeaponCategory.CQC, score: 80.9 }, // Double barrel burst
    "model_37": { category: WeaponCategory.CQC, score: 75.9 },
    
    // --- ASSAULT RIFLES (Versatile Primary) ---
    "acr": { category: WeaponCategory.Primary, score: 98 }, // Laser beam
    "mcx_spear": { category: WeaponCategory.Primary, score: 96 },
    "aug": { category: WeaponCategory.Primary, score: 92 },
    "ak47": { category: WeaponCategory.Primary, score: 90.8 },
    "m16a2": { category: WeaponCategory.Primary, score: 88.8 },
    "an94": { category: WeaponCategory.Primary, score: 87 },
    "arx160": { category: WeaponCategory.Primary, score: 85.8 },
    "aks74u": { category: WeaponCategory.Primary, score: 82.9 },
    
    // --- LMGs (Sustained Fire Primary) ---
    "mg5": { category: WeaponCategory.Primary, score: 95 },
    "stoner_63": { category: WeaponCategory.Primary, score: 88.7 },
    "negev": { category: WeaponCategory.Primary, score: 85.7 },
    "pk61": { category: WeaponCategory.Primary, score: 84 },
    "rpk16": { category: WeaponCategory.Primary, score: 82.8 },
    
    // --- SMGs (High Mobility CQC) ---
    "vector": { category: WeaponCategory.CQC, score: 94 }, // Laser hose
    "pp19": { category: WeaponCategory.CQC, score: 82.7 },
    "mp5k": { category: WeaponCategory.CQC, score: 80.8 },
    "mpx": { category: WeaponCategory.CQC, score: 78.9 },
    "saf200": { category: WeaponCategory.CQC, score: 75.8 },
    "micro_uzi": { category: WeaponCategory.CQC, score: 70.9 },
    
    // --- DMRs (Mid-Long Range) ---
    "mk18": { category: WeaponCategory.Primary, score: 90.7 }, // Mjolnir
    "sr25": { category: WeaponCategory.Primary, score: 85.6 },
    "mini14": { category: WeaponCategory.Primary, score: 82.6 },
    "m1_garand": { category: WeaponCategory.Primary, score: 80.7 },
    "svu": { category: WeaponCategory.Primary, score: 78 },
    "vss": { category: WeaponCategory.Primary, score: 75.7 },
    
    // --- SNIPERS (Situational) ---
    "l115a1": { category: WeaponCategory.Sniper, score: 85.5 }, // AWM - High damage makes it worth it
    "tango_51": { category: WeaponCategory.Sniper, score: 70.8 },
    "vks": { category: WeaponCategory.Sniper, score: 65 },
    "mosin_nagant": { category: WeaponCategory.Sniper, score: 50 }, // Too slow for aggro AI unless perfect aim
    
    // --- PISTOLS / SIDEARMS (Replace ASAP) ---
    "deagle": { category: WeaponCategory.Sidearm, score: 55 },
    "rsh12": { category: WeaponCategory.Sidearm, score: 50 },
    "g19": { category: WeaponCategory.Sidearm, score: 20.9 },
    "cz75a": { category: WeaponCategory.Sidearm, score: 25 },
    "m9": { category: WeaponCategory.Sidearm, score: 20 },
    "ot38": { category: WeaponCategory.Sidearm, score: 10 },
    
    // --- SPECIAL ---
    "m202": { category: WeaponCategory.Special, score: 60 }, // Dangerous to self
};

export class WeaponEvaluator {

    /**
     * Retrieves the tactical information for a given gun ID.
     * Uses the predefined config if available, otherwise attempts to auto-classify.
     */
    static getWeaponInfo(gunId: string): WeaponInfo {
        const config = WEAPON_CONFIG[gunId];
        
        if (config) {
            return { id: gunId, ...config };
        }

        // Fallback: Auto-classify based on game definition
        const def = Guns.definitions.find(g => g.idString === gunId);
        if (!def) {
            return { id: gunId, category: WeaponCategory.Unknown, score: 0 };
        }

        let category = WeaponCategory.Unknown;
        let score = 40; // Base score for unknown weapons

        // Classification Logic
        const isAuto = def.fireMode === FireMode.Auto || def.fireMode === FireMode.Burst;
        const isShotgun = def.ammoType === '12g';
        const isSmallCaliber = def.ammoType === '9mm' || def.ammoType === '45acp';
        const isRifleCaliber = def.ammoType === '556mm' || def.ammoType === '762mm';

        if (isShotgun) {
            category = WeaponCategory.CQC;
            score = 75; 
        } else if (isRifleCaliber) {
            if (isAuto && def.length > 7) {
                category = WeaponCategory.Primary; // AR/LMG
                score = 80;
            } else {
                category = WeaponCategory.Primary; // DMR
                score = 70;
            }
        } else if (isSmallCaliber) {
            if (def.capacity > 20 && isAuto) {
                category = WeaponCategory.CQC; // SMG
                score = 70;
            } else {
                category = WeaponCategory.Sidearm; // Pistol
                score = 20;
            }
        } else if (def.ammoType === '50cal' || def.ammoType === '338lap') {
            if (def.capacity < 10 && !isAuto) {
                category = WeaponCategory.Sniper;
                score = 60;
            } else {
                category = WeaponCategory.Primary; // Heavy AR/LMG
                score = 85;
            }
        }

        return { id: gunId, category, score };
    }

    /**
     * Determines if the AI should swap its current weapon for a ground weapon.
     * Implements the "Ideal Loadout" logic: [Slot 1: Primary] + [Slot 2: CQC]
     * 
     * @param currentGunId The ID of the gun currently in the slot (or null if empty)
     * @param groundGunId The ID of the gun on the ground
     * @param slotIndex The index of the slot being considered (0 = Slot 1, 1 = Slot 2)
     * @param otherSlotGunId The ID of the gun in the OTHER slot (to check loadout balance)
     */
    static shouldSwap(currentGunId: string | null, groundGunId: string, slotIndex: number, otherSlotGunId: string | null): boolean {
        // 1. Always pick up if empty
        if (!currentGunId) return true;

        const current = this.getWeaponInfo(currentGunId);
        const ground = this.getWeaponInfo(groundGunId);
        const other = otherSlotGunId ? this.getWeaponInfo(otherSlotGunId) : null;

        // 2. Significant Upgrade Rule (Score diff > 10)
        // If the ground weapon is significantly better, take it regardless of category preference logic initially
        // (We can sort slots later, but getting the power weapon is priority)
        if (ground.score > current.score + 15) return true;

        // 3. Loadout Optimization
        const isSlot1 = slotIndex === 0;
        
        // Target: Slot 1 prefers PRIMARY, Slot 2 prefers CQC
        const preferredCategory = isSlot1 ? WeaponCategory.Primary : WeaponCategory.CQC;

        // If current weapon is NOT the preferred category, but ground IS, swap (unless ground is trash)
        if (current.category !== preferredCategory && ground.category === preferredCategory) {
            if (ground.score >= current.score - 5) return true; // Allow slight score drop to get correct category
        }

        // 4. Avoid Redundancy
        // If we already have this category in the other slot, and the ground weapon offers a complementary category
        if (other && other.category === current.category && ground.category !== current.category) {
            // If I have 2 Primaries, and ground is CQC, replace the worse Primary with CQC
            // (Assumes the caller is checking this specific slot. Ideally we swap the lower score one)
            if (ground.category === WeaponCategory.CQC || ground.category === WeaponCategory.Primary) {
                 if (ground.score > 60) return true; // Only if it's a decent weapon
            }
        }

        // 5. Sidearm Cleanup
        // Always replace a Sidearm with any Primary/CQC
        if (current.category === WeaponCategory.Sidearm && 
           (ground.category === WeaponCategory.Primary || ground.category === WeaponCategory.CQC)) {
            return true;
        }

        // 6. Same Category Upgrade
        if (current.category === ground.category) {
            return ground.score > current.score;
        }

        return false;
    }
}
