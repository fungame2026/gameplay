import { ObjectCategory, Layer } from "@common/constants";
import { Numeric } from "@common/utils/math";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { Vec, type Vector } from "@common/utils/vector";
import { GameObject } from "./gameObject";

export class Parachute extends GameObject.derive(ObjectCategory.Parachute) {
    height = 0;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.Parachute]) {
        super(id);
        this.updateFromData(data, true);
        this.layer = Layer.Ground;
        this.updateLayer();
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Parachute], isNew = false): void {
        if (data.full) {
            this.position = data.full.position;
        }
        this.height = data.height;

        if (data.height === 0) {
            // Landing effects - simplified for AI
        }
    }

    override update(): void { /* bleh */ }

    override updateInterpolation(): void { /* bleh */ }

    override updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    destroy(): void {
        super.destroy();
    }
}