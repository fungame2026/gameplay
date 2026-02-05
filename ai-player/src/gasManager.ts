import { GasState } from "@common/constants";
import { type UpdateDataOut } from "@common/packets/updatePacket";
import { Numeric } from "@common/utils/math";
import { Vec, type Vector } from "@common/utils/vector";

export class GasManagerClass {
    state = GasState.Inactive;
    currentDuration = 0;
    oldPosition = Vec(0, 0);
    lastPosition = Vec(0, 0);
    position = Vec(0, 0);
    newPosition = Vec(0, 0);
    oldRadius = 2048;
    lastRadius = 2048;
    radius = 2048;
    newRadius = 2048;

    lastUpdateTime = Date.now();

    time: number | undefined;

    updateFrom(data: UpdateDataOut): void {
        const gas = data.gas;
        const gasProgress = data.gasProgress;

        if (gas) {
            this.state = gas.state;
            this.currentDuration = gas.currentDuration;
            this.oldPosition = gas.oldPosition;
            this.newPosition = gas.newPosition;
            this.oldRadius = gas.oldRadius;
            this.newRadius = gas.newRadius;
        }

        if (gasProgress !== undefined) {
            const time = this.currentDuration - Math.round(this.currentDuration * gasProgress);
            if (time !== this.time) {
                this.time = time;
            }

            if (this.state !== GasState.Advancing) {
                this.position = this.oldPosition;
                this.radius = this.oldRadius;
            }

            if (this.state === GasState.Advancing) {
                this.lastPosition = Vec.clone(this.position);
                this.lastRadius = this.radius;
                this.position = Vec.lerp(this.oldPosition, this.newPosition, gasProgress);
                this.radius = Numeric.lerp(this.oldRadius, this.newRadius, gasProgress);
                this.lastUpdateTime = Date.now();
            }
        }
    }

    reset(): void {
        this.time = undefined;
    }
}

export const GasManager = new GasManagerClass();