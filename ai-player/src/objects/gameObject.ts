import { Layer, type ObjectCategory } from "@common/constants";
import { makeGameObjectTemplate } from "@common/utils/gameObject";
import { Angle, Numeric } from "@common/utils/math";
import { Timeout } from "@common/utils/misc";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { Vec, type Vector } from "@common/utils/vector";

// Create a wrapper to avoid TypeScript errors with private properties in exported anonymous class

// eslint-disable-next-line
export abstract class GameObject<Cat extends ObjectCategory = ObjectCategory> extends makeGameObjectTemplate() {
    damageable = false;
    destroyed = false;

    layer!: Layer;

    private _oldPosition?: Vector;
    private _lastPositionChange?: number;
    private _position = Vec(0, 0);
    private _positionManuallySet = false;
    get position(): Vector { return this._position; }
    set position(position: Vector) {
        if (this._positionManuallySet) {
            this._oldPosition = Vec.clone(this._position);
        }
        this._positionManuallySet = true;

        this._lastPositionChange = Date.now();
        this._position = position;
    }

    updateContainerPosition(): void {
        // Simplified for AI - no container updates needed
    }

    private _oldRotation?: number;
    private _lastRotationChange?: number;
    private _rotationManuallySet = false;
    private _rotation = 0;
    get rotation(): number { return this._rotation; }
    set rotation(rotation: number) {
        if (this._rotationManuallySet) {
            this._oldRotation = this._rotation;
        }
        this._rotationManuallySet = true;

        this._lastRotationChange = Date.now();
        this._rotation = rotation;
    }

    updateContainerRotation(): void {
        // Simplified for AI - no container updates needed
    }

    dead = false;

    readonly timeouts = new Set<Timeout>();

    addTimeout(callback: () => void, delay?: number): Timeout {
        // Simplified timeout implementation for AI
        const timeout = new Timeout(callback, Date.now() + (delay ?? 0));
        this.timeouts.add(timeout);
        return timeout;
    }

    constructor(readonly id: number) {
        super();
    }

    destroy(): void {
        this.destroyed = true;
        for (const timeout of this.timeouts) {
            timeout.kill();
        }
    }

    playSound(name: string, options?: any): any {
        // No sound for AI
        return undefined;
    }

    abstract updateFromData(data: ObjectsNetData[Cat], isNew: boolean): void;

    updateLayer(forceUpdate = false): void {
        // Simplified for AI - no layer updates needed
    }

    abstract update(): void;
    abstract updateInterpolation(): void;

    abstract updateDebugGraphics(): void;
}