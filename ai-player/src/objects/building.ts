import { ObjectCategory, Layer } from "@common/constants";
import { type BuildingDefinition } from "@common/definitions/buildings";
import { type Orientation } from "@common/typings";
import { CircleHitbox, GroupHitbox, PolygonHitbox, RectangleHitbox, type Hitbox } from "@common/utils/hitbox";
import { equivLayer } from "@common/utils/layer";
import { Angle, EaseFunctions, Numeric } from "@common/utils/math";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { randomBoolean, randomFloat, randomRotation } from "@common/utils/random";
import { Vec, type Vector } from "@common/utils/vector";
import { GameObject } from "./gameObject";

export class Building extends GameObject.derive(ObjectCategory.Building) {
    definition!: BuildingDefinition;

    hitbox?: Hitbox;

    ceilingHitbox?: Hitbox;

    orientation!: Orientation;

    ceilingVisible = false;

    puzzle: ObjectsNetData[ObjectCategory.Building]["puzzle"];

    maskHitbox?: GroupHitbox<RectangleHitbox[]>;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.Building]) {
        super(id);
        this.updateFromData(data, true);
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Building], isNew = false): void {
        if (data.full) {
            const { full } = data;
            const definition = this.definition = full.definition;
            this.position = full.position;
            this.orientation = full.orientation;
            this.rotation = Angle.orientationToRotation(this.orientation);
            this.layer = data.layer;
            this.dead = data.dead;
            this.puzzle = data.puzzle;

            for (const override of definition.visibilityOverrides ?? []) {
                this.maskHitbox ??= new GroupHitbox();

                const collider: Hitbox = override.collider.transform(this.position, 1, this.orientation);
                if (collider instanceof RectangleHitbox) {
                    this.maskHitbox.hitboxes.push(collider);
                } else if (collider instanceof GroupHitbox) {
                    for (const hitbox of (collider).hitboxes) {
                        this.maskHitbox.hitboxes.push(hitbox as RectangleHitbox);
                    }
                }
            }

            if (definition.bulletMask) {
                (this.maskHitbox ??= new GroupHitbox()).hitboxes.push(definition.bulletMask.transform(this.position, 1, this.orientation));
            }

            // Set up hitboxes
            if (this.definition.hitbox) {
                this.hitbox = this.definition.hitbox.transform(this.position, 1, this.orientation);
            }
            this.damageable = !!definition.hitbox;
            if (this.definition.ceilingHitbox) {
                this.ceilingHitbox = this.definition.ceilingHitbox.transform(this.position, 1, this.orientation);
            }
        }
    }

    override update(): void {
    }

    override updateInterpolation(): void { /* bleh */ }

    toggleCeiling(): void {
        // Simplified for AI - no ceiling visibility logic needed
    }

    override updateDebugGraphics(): void {
        // No debug graphics for AI
    }
}