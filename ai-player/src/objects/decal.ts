import { ObjectCategory } from "@common/constants";
import { type DecalDefinition } from "@common/definitions/decals";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { GameObject } from "./gameObject";

export class Decal extends GameObject.derive(ObjectCategory.Decal) {
    definition!: DecalDefinition;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.Decal]) {
        super(id);
        this.updateFromData(data);
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Decal]): void {
        this.position = data.position;
        this.layer = data.layer;
        const definition = this.definition = data.definition;
        
        // Simplified for AI - no visual updates needed
    }

    update(): void { /* bleh */ }
    updateInterpolation(): void { /* bleh */ }
    updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    override destroy(): void {
        super.destroy();
    }
}