import { ObjectCategory } from "@common/constants";
import { type SyncedParticleDefinition } from "@common/definitions/syncedParticles";
import { Angle, EaseFunctions, Numeric } from "@common/utils/math";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { Vec, type Vector } from "@common/utils/vector";
import { GameObject } from "./gameObject";

export class SyncedParticle extends GameObject.derive(ObjectCategory.SyncedParticle) {
    private _spawnTime = 0;
    private _age = 0;
    private _lifetime = 0;

    angularVelocity = 0;

    private _definition!: SyncedParticleDefinition;
    get definition(): SyncedParticleDefinition { return this._definition; }

    constructor(id: number, data: ObjectsNetData[ObjectCategory.SyncedParticle]) {
        super(id);
        this.updateFromData(data, true);
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.SyncedParticle], isNew = false): void {
        const {
            definition,
            startPosition,
            endPosition,
            layer,
            age,
            lifetime,
            angularVelocity,
            scale,
            alpha,
            variant
        } = data;

        this._definition = definition;
        this.position = startPosition;

        if (layer !== this.layer) {
            this.layer = layer;
        }
        this._lifetime = lifetime ?? definition.lifetime as number;
        this._age = age;
        this._spawnTime = Date.now() - this._age * this._lifetime;
        this.angularVelocity = angularVelocity ?? definition.angularVelocity as number;

        // Simplified for AI - no visual updates needed
    }

    override updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    updateScale(): void {
        // Simplified for AI
    }

    updateAlpha(): void {
        // Simplified for AI
    }

    override update(): void {
        const ageMs = Date.now() - this._spawnTime;
        this._age = ageMs / this._lifetime;
        if (this._age > 1) return;

        this.updateScale();
        this.updateAlpha();
    }

    override updateInterpolation(): void { /* bleh */ }

    override destroy(): void {
        super.destroy();
    }
}