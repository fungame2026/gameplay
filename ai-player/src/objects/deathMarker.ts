import { ObjectCategory } from "@common/constants";
import { type BadgeDefinition } from "@common/definitions/badges";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { Vec, type Vector } from "@common/utils/vector";
import { GameObject } from "./gameObject";

export class DeathMarker extends GameObject.derive(ObjectCategory.DeathMarker) {
    playerName!: string;
    nameColor = 0xdcdcdc;
    playerBadge!: BadgeDefinition;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.DeathMarker]) {
        super(id);
        this.updateFromData(data, true);
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.DeathMarker], isNew = false): void {
        this.position = data.position;
        this.layer = data.layer;

        // Simplified for AI - no visual updates needed
        const playerName = "Player"; // Simplified for AI
        this.playerName = playerName;

        // Play an animation if this is a new death marker.
        if (data.isNew && isNew) {
            // Simplified for AI - no animations needed
        }
    }

    override update(): void { /* bleh */ }
    override updateInterpolation(): void { /* bleh */ }
    updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    override destroy(): void {
        super.destroy();
    }
}