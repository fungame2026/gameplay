import { ObjectCategory } from "@common/constants";
import { type ThrowableDefinition } from "@common/definitions/items/throwables";
import { CircleHitbox } from "@common/utils/hitbox";
import { EaseFunctions, Numeric } from "@common/utils/math";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { randomBoolean, randomFloat, randomPointInsideCircle } from "@common/utils/random";
import { FloorTypes } from "@common/utils/terrain";
import { Vec, type Vector } from "@common/utils/vector";
import { GameObject } from "./gameObject";
import { MapManager } from "../mapManager";

export class Projectile extends GameObject.derive(ObjectCategory.Projectile) {
    definition!: ThrowableDefinition;

    hitbox = new CircleHitbox(0);

    height!: number;
    halloweenSkin!: boolean;

    activated!: boolean;
    throwerTeamID?: number;
    tintIndex?: number;

    onFloor?: boolean;
    onWater = false;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.Projectile]) {
        super(id);
        this.updateFromData(data, true);
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Projectile], isNew = false): void {
        if (data.full) {
            const full = data.full;
            const def = this.definition = full.definition;

            this.damageable = def.c4 ?? false;

            this.halloweenSkin = full.halloweenSkin;
            this.activated = full.activated;
            this.throwerTeamID = full.c4?.throwerTeamID;
            this.tintIndex = full.c4?.tintIndex;

            this.hitbox.radius = def.hitboxRadius;
        }

        this.position = data.position;
        this.rotation = data.rotation;
        this.height = data.height;
        this.hitbox.position = this.position;

        if (this.layer !== data.layer) {
            this.layer = data.layer;
            this.updateLayer();
        }
        const onFloorOld = this.onFloor;
        const onWaterOld = this.onWater;
        this.onFloor = this.height <= 0;
        this.onWater = this.onFloor && !!FloorTypes[MapManager.terrain.getFloor(this.position, this.layer)].overlay;
    }

    override updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    override update(): void {
    }

    override updateInterpolation(): void { /* bleh */ }
}