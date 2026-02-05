import { ObjectCategory } from "@common/constants";
import { type Vector } from "@common/utils/vector";
import { Player } from "./objects/player";
import { Obstacle } from "./objects/obstacle";
import { DeathMarker } from "./objects/deathMarker";
import { Loot } from "./objects/loot";
import { Building } from "./objects/building";
import { Parachute } from "./objects/parachute";
import { Projectile } from "./objects/projectile";
import { Decal } from "./objects/decal";
import { SyncedParticle } from "./objects/syncedParticle";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";

export interface Region {
    /**
     * The human-readable name of the region, displayed in the server selector.
     */
    readonly name: string

    /**
     * An emoji flag to display alongside the region name.
     */
    readonly flag?: string

    /**
     * The address of the region's main server.
     */
    readonly mainAddress: string

    /**
     * Pattern used to determine the address of the region's game servers.
     * The string `<gameID>` is replaced by the `gameID` given by the /getGame API, plus {@linkcode offset}.
     * For example, if `gameID` is 0, `gameAddress` is `"wss://na.suroi.io/game/<gameID>"`, and `offset` is 1, the resulting address will be wss://na.suroi.io/game/1.
     */
    readonly gameAddress: string

    /**
     * Number to increment `gameID` by when determining the game address. See {@linkcode gameAddress} for more info.
     */
    readonly offset: number
}

export interface ConfigType {
    readonly regions: Record<string, Region>
    readonly defaultRegion: string
}

/* eslint-disable @stylistic/indent */
export type DesireType = 'pickupGun' | 'pickupMelee' | 'pickupThrowable' | 'pickupLoot' | 'killEnemy' | 'avoidGas' | 'avoidGrenade' | 'moveToLocation' | 'reviveTeammate' | 'heal' | 'reload';

export interface Desire {
    type: DesireType;
    targetName: string | null;
    targetPosition: Vector;
    targetId?: number;
    targetSlot?: number; // For pickupGun
    isResolved: boolean;
    status: 'pending' | 'doing';
    priority: number; // 0 is highest
    creationTime: number;
}

export type ObjectClassMapping = {
    readonly [ObjectCategory.Player]: typeof Player
    readonly [ObjectCategory.Obstacle]: typeof Obstacle
    readonly [ObjectCategory.DeathMarker]: typeof DeathMarker
    readonly [ObjectCategory.Loot]: typeof Loot
    readonly [ObjectCategory.Building]: typeof Building
    readonly [ObjectCategory.Decal]: typeof Decal
    readonly [ObjectCategory.Parachute]: typeof Parachute
    readonly [ObjectCategory.Projectile]: typeof Projectile
    readonly [ObjectCategory.SyncedParticle]: typeof SyncedParticle
};

export const ObjectClassMapping: ObjectClassMapping = Object.freeze({
    [ObjectCategory.Player]: Player,
    [ObjectCategory.Obstacle]: Obstacle,
    [ObjectCategory.DeathMarker]: DeathMarker,
    [ObjectCategory.Loot]: Loot,
    [ObjectCategory.Building]: Building,
    [ObjectCategory.Decal]: Decal,
    [ObjectCategory.Parachute]: Parachute,
    [ObjectCategory.Projectile]: Projectile,
    [ObjectCategory.SyncedParticle]: SyncedParticle
} satisfies {
    readonly [K in ObjectCategory]: new (id: number, data: ObjectsNetData[K]) => InstanceType<ObjectClassMapping[K]>
});

export type ObjectMapping = {
    readonly [Cat in keyof ObjectClassMapping]: InstanceType<ObjectClassMapping[Cat]>
};
