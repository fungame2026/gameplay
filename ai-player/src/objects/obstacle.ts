import { ObjectCategory } from "@common/constants";
import { type ObstacleDefinition } from "@common/definitions/obstacles";
import { type Orientation, type Variation } from "@common/typings";
import { HitboxType, RectangleHitbox, type Hitbox } from "@common/utils/hitbox";
import { equivLayer } from "@common/utils/layer";
import { Angle, calculateDoorHitboxes, EaseFunctions, Numeric } from "@common/utils/math";
import { type Timeout } from "@common/utils/misc";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { random, randomBoolean, randomFloat, randomRotation } from "@common/utils/random";
import { Vec, type Vector } from "@common/utils/vector";
import { GameObject } from "./gameObject";
import { type Player } from "./player";

export class Obstacle extends GameObject.derive(ObjectCategory.Obstacle) {
    override readonly damageable = true;

    definition!: ObstacleDefinition;
    scale!: number;
    variation?: Variation;

    animationFrame?: number;

    /**
     * `undefined` if this obstacle hasn't been updated yet, or if it's not a door obstacle
     */
    private _door?: {
        closedHitbox?: RectangleHitbox
        openHitbox?: RectangleHitbox
        openAltHitbox?: RectangleHitbox
        hitbox?: RectangleHitbox
        offset: number
        locked?: boolean
    };

    get door(): {
        readonly closedHitbox?: RectangleHitbox
        readonly openHitbox?: RectangleHitbox
        readonly openAltHitbox?: RectangleHitbox
        readonly hitbox?: RectangleHitbox
        readonly offset: number
        readonly locked?: boolean
    } | undefined { return this._door; }

    get isDoor(): boolean { return this._door !== undefined; }

    activated?: boolean;
    hitbox!: Hitbox;
    orientation: Orientation = 0;

    waterOverlay = false;

    powered = false;

    notOnCoolDown = true;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.Obstacle]) {
        super(id);
        this.updateFromData(data, true);
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Obstacle], isNew = false): void {
        const full = data.full;
        if (full) {
            const definition = this.definition = full.definition;

            this.position = full.position;

            const { rotation, orientation } = full.rotation;
            this.rotation = rotation;
            this.orientation = orientation;

            this.layer = full.layer;
            this.updateLayer();

            this.variation = full.variation;
            if (this.activated !== full.activated) {
                this.activated = full.activated;
            }
            this.updateDoor(full, isNew);
        }

        const definition = this.definition;

        this.scale = data.scale;

        const destroyScale = definition.scale?.destroy ?? 1;
        const scaleFactor = (this.scale - destroyScale) / ((definition.scale?.spawnMax ?? 1) - destroyScale);

        this.powered = data.powered;

        if (data.dead !== undefined) {
            this.dead = data.dead;
        }

        if (this._door === undefined) {
            this.hitbox = definition.hitbox.transform(this.position, this.scale, this.orientation);
        }
    }

    updateDoor(data: ObjectsNetData[ObjectCategory.Obstacle]["full"], isNew = false): void {
        if (!data?.door || !data.definition.isDoor) return;
        const definition = data.definition;

        if (!this._door) this._door = { offset: 0 };

        this.rotation = Angle.orientationToRotation(this.orientation);

        const hitboxes = calculateDoorHitboxes(definition, this.position, this.orientation);

        this._door.openHitbox = hitboxes.openHitbox;
        if ("openAltHitbox" in hitboxes) this._door.openAltHitbox = hitboxes.openAltHitbox;

        this._door.locked = data.door.locked;

        let backupHitbox = (definition.hitbox as RectangleHitbox).transform(this.position, this.scale, this.orientation);

        this._door.closedHitbox = backupHitbox.clone();

        switch (data.door.offset) {
            case 1: {
                backupHitbox = this._door.openHitbox.clone();
                break;
            }
            case 3: {
                // offset 3 means that this is a "swivel" door, meaning that there is an altHitbox
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                backupHitbox = this._door.openAltHitbox!.clone();
                break;
            }
        }

        const savedBackupHitbox = backupHitbox;
        if (definition.interactionDelay && !this.powered && this.door?.locked) {
            backupHitbox = this._door.closedHitbox.clone();
        }

        this.hitbox = this._door.hitbox = backupHitbox;

        const offset = data.door.offset;
        if (isNew) {
            this._door.offset = offset;
        } else if (offset !== this._door.offset) {
            this._door.offset = offset;
        }
    }

    canInteract(player: Player): boolean {
        type DoorDef = { openOnce?: boolean, automatic?: boolean };
        if (this._door !== undefined
            && (this.definition as DoorDef).openOnce
            && !this._door.locked
            && !((this.definition as DoorDef).openOnce && this._door.offset === 0)) return false;
        return !this.dead && !this.definition?.damage
            && (
                this.definition.interactOnlyFromSide === undefined
                || this.definition.interactOnlyFromSide === (this.hitbox as RectangleHitbox).getSide(player.position)
            )
            && (
                (
                    this._door !== undefined
                    && !this._door.locked
                    && !(this.definition as DoorDef).automatic
                    && !((this.definition as DoorDef).openOnce && this._door.offset === 1)
                ) || (
                    this.definition.isActivatable === true
                    && (this.definition.requiredItem === undefined || player.activeItem.idString === this.definition.requiredItem)
                    && !this.activated
                )
            );
    }

    override updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    override update(): void {
    }

    override updateInterpolation(): void { /* bleh */ }
}