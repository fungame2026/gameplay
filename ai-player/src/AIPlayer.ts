import * as fs from 'fs';
import * as path from 'path';
import { State } from './mistreevous';
import { GameConstants, InputActions, ObjectCategory, PlayerActions } from "@common/constants";
import { type JoinedData } from "@common/packets/joinedPacket";
import { JoinPacket } from "@common/packets/joinPacket";
import { PacketType, type PacketDataIn, type PacketDataOut } from "@common/packets/packet";
import { PacketStream } from "@common/packets/packetStream";
import { type UpdateDataOut } from "@common/packets/updatePacket";
import { InputPacket } from "@common/packets/inputPacket";
import { type GameOverData } from "@common/packets/gameOverPacket";
import { type KillData } from "@common/packets/killPacket";
import { Vec, type Vector } from "@common/utils/vector";
import { Angle, EaseFunctions, Geometry, Numeric } from "@common/utils/math";
import { CircleHitbox } from "@common/utils/hitbox";
import { Skins } from "@common/definitions/items/skins";
import { Badges } from "@common/definitions/badges";
import { Emotes } from "@common/definitions/emotes";
import { HealingItems } from "@common/definitions/items/healingItems";
import { Explosions } from "@common/definitions/explosions";
import { MapManager } from "./mapManager";
import { GasManager } from "./gasManager";
import { type MapData } from "@common/packets/mapPacket";
import { ObjectPool } from "@common/utils/objectPool";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { Player } from "./objects/player";
import { Obstacle } from "./objects/obstacle";
import { DeathMarker } from "./objects/deathMarker";
import { Loot } from "./objects/loot";
import { Building } from "./objects/building";
import { Parachute } from "./objects/parachute";
import { Projectile } from "./objects/projectile";
import { Decal } from "./objects/decal";
import { SyncedParticle } from "./objects/syncedParticle";
import { GameObject } from "./objects/gameObject";
import { DefinitionType } from "@common/utils/objectDefinitions";
import { delay } from "./utility";
import { WeaponEvaluator } from "./weaponEvaluator";
import { MeleeEvaluator } from "./meleeEvaluator";

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

type ObjectClassMapping = {
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

const ObjectClassMapping: ObjectClassMapping = Object.freeze({
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

type ObjectMapping = {
    readonly [Cat in keyof ObjectClassMapping]: InstanceType<ObjectClassMapping[Cat]>
};

export class AIPlayer {
    private _socket: WebSocket | null = null;
    private playerName: string;
    private serverAddress: string;
    private connecting = false;
    private gameStarted = false;
    private gameOver = false;
    private playerDied = false;
    private isWinner = false;
    private lastInputTime = 0;
    private inputInterval = 150; // Send input every 150ms to mimic human players
    private lastActionTime = 0;
    private actionInterval = 1000; // Perform actions every 1000ms on average
    private playerPosition: Vector = { x: 0, y: 0 };
    private gameMap: { width: number; height: number } | null = null;
    private playerId: number | null = null;
    private playerHealth: number = 100;
    private playerAlive: boolean = true;
    private lastRotation: number = 0;
    private targetPosition: Vector | null = null;
    private aliveCount: number = 0;
    private lastEmoteTime: number = 0;
    private emoteInterval: number = 10000; // Send emote every 10 seconds on average
    private lastReloadTime: number = 0;
    private reloadInterval: number = 15000; // Reload every 15 seconds on average
    private isAttacking: boolean = false;
    private attackStartTime: number = 0;
    private attackDuration: number = 0;
    private hasWeapon: boolean = false;
    private currentWeapon: string | null = null;
    private inventory: any = null; // Store the player's inventory data
    private inventoryItems: any = null; // Store the player's items (ammo, meds, etc)
    private lastWeaponCheck: number = 0;
    private weaponCheckInterval: number = 2000; // Check for better weapons every 2 seconds
    private isForceStop: boolean = false; // New: prevents movement during critical actions like looting
    private lootTargetId: number | null = null; // ID of the loot we are currently trying to pick up
    private configPath: string | undefined;

    private lootedItems: Map<number, number> = new Map();
    private droppedItems: { weaponId: string, position: Vector, timestamp: number }[] = [];
    private ignoredLootZones: { position: Vector, radius: number, expiry: number }[] = [];
    private explicitTargetId: number | null = null;
    private postDropCooldownUntil = 0;
    private lastTargetSetTime: number = 0;

    // Stuck Detection
    private lastPosition: Vector | null = null;
    private lastPositionCheckTime: number = 0;

    // Desire System
    private desires: Desire[] = [];

    activePlayerID = -1;
    private playerAdrenaline = 0;
    teamID = -1;

    isTeamMode = false;
    private apiKey: string | null = null;
    readonly objects = new ObjectPool<ObjectMapping>();

    get activePlayer(): Player | undefined {
        return this.objects.get(this.activePlayerID) as Player;
    }

    get playerInventory(): any {
        return this.inventory;
    }

    private _lastUpdateTime = 0;
    get lastUpdateTime(): number { return this._lastUpdateTime; }

    /**
     * Otherwise known as "time since last update", in milliseconds
     */
    private _serverDt = 0;
    /**
     * Otherwise known as "time since last update", in milliseconds
     */
    get serverDt(): number { return this._serverDt; }

    // Index signature to satisfy the Agent interface
    [propertyName: string]: any;

    constructor(serverAddress: string, playerName: string = "AI_Player", configPath?: string) {
        this.serverAddress = serverAddress;
        this.playerName = playerName;
        this.configPath = configPath;
    }

    // --- State Variables ---
    private grenadeState: 'none' | 'equipping' | 'cooking' | 'throwing' | 'recovering' = 'none';
    private grenadeTimer: number = 0;
    private healingState: 'none' | 'equipping' | 'using' | 'recovering' = 'none';
    private healingTimer: number = 0;
    private strafeDirection: number = 1;
    private lastStrafeSwitch: number = 0;
    private lastTargetPos: Vector | null = null; // For velocity calculation

    // Deadlock detection
    private lastCheckPosition: Vector | null = null;
    private lastCheckPositionTime: number = 0;
    private unstuckUntil: number = 0;
    
    // Loot locking to prevent jitter
    private lockedLootTargetId: number | null = null;
    
    // Breadcrumbs for wandering
    private visitedPositions: { pos: Vector, time: number }[] = [];

    public async start() {
        const configPath = this.configPath 
            ? path.resolve(process.cwd(), this.configPath)
            : path.resolve(__dirname, '../data/config.json');

        if (!fs.existsSync(configPath)) {
            console.error('Config file not found at', configPath);
            process.exit(1);
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (!config.api_key) {
            console.error('API key not found in config file');
            process.exit(1);
        }

        this.apiKey = config.api_key;
        if (config.nickname) {
            this.playerName = config.nickname;
        }
        console.log('API key loaded successfully');

        this.connect();
        await this.runGameLoop();
    }

    private isDesireLootInteractable(targetId: number): boolean {
        const object: GameObject | undefined = this.objects.get(targetId);
        if (!object) {
            return false;
        }
        const player = this.activePlayer;
        if (!player) {
            return false;
        }        
        const isLoot = object instanceof Loot;
        const isObstacle = object instanceof Obstacle;
        const isPlayer = object instanceof Player;
        if (!isLoot && !isObstacle && !isPlayer) {
            return false;
        }

        // @ts-ignore
        const canInteract = typeof object.canInteract === 'function' ? object.canInteract(player) : isLoot;
        const sizeMod = (player as any).sizeMod ?? 1;
        const detectionHitbox = new CircleHitbox(3 * sizeMod, this.playerPosition); // radius 3 * sizeMod as per client
        if (canInteract && object.hitbox.collidesWith(detectionHitbox)) {
            return true;
        }
        return false;
    }

    private getClosestInteractable(): GameObject | undefined {
        const player = this.activePlayer;
        if (!player) return undefined;

        const sizeMod = (player as any).sizeMod ?? 1;
        const detectionHitbox = new CircleHitbox(3 * sizeMod, this.playerPosition); // radius 3 * sizeMod as per client

        let closestObject: GameObject | undefined;
        let minDistanceSq = Infinity;

        for (const object of this.objects) {
            if (object.id === this.playerId) continue;

            const isLoot = object instanceof Loot;
            const isObstacle = object instanceof Obstacle;
            const isPlayer = object instanceof Player;

            if (!isLoot && !isObstacle && !isPlayer) continue;

            // @ts-ignore
            const canInteract = typeof object.canInteract === 'function' ? object.canInteract(player) : isLoot;

            if (canInteract && object.hitbox.collidesWith(detectionHitbox)) {
                const distSq = Geometry.distanceSquared(this.playerPosition, object.position);
                if (distSq < minDistanceSq) {
                    minDistanceSq = distSq;
                    closestObject = object;
                }
            }
        }

        return closestObject;
    }

    private async runGameLoop() {
        while (true) {
            if (this.IsGameOver()) {
                this.HandleGameOver();
                return;
            }

            if (this.IsPlayerDead()) {
                this.playerDied = false;
                this.gameStarted = false;
                await delay(100);
                continue;
            }

            if (!this.IsGameStarted()) {
                await delay(100);
                continue;
            }

            // 1. Evaluate environment and add/update desires
            this.evaluateDesires();

            // 2. Process the highest priority desire
            if (this.desires.length > 0) {
                await this.processDesires();
            } else {
                // Idle / Wander if no desires
                // Ensure we aren't force stopped from a previous action
                this.isForceStop = false;
                this.ensureWanderTarget();
                this.UpdateMovement();
            }

            await delay(100);
        }
    }

    private evaluateDesires(): void {
        const now = Date.now();

        /*
        // -1. Stuck Detection (Anti-Camp/Anti-Stuck) - Priority 0
        if (now - this.lastPositionCheckTime > 5000) {
            if (this.lastPosition) {
                const distMoved = Geometry.distance(this.playerPosition, this.lastPosition);
                // If we haven't moved much in 5 seconds, and we aren't healing/interacting
                // (Healing sets checking pos to current, so it shouldn't trigger this)
                if (distMoved < 3) {
                    console.log("Stuck detected! Forcing small movement.");
                    // Move to a random point nearby (Radius 20) to break local deadlocks
                    // Don't go to map center, just move a bit.
                    const angle = Math.random() * Math.PI * 2;
                    const dist = 15 + Math.random() * 10; // 15-25 units away
                    const target = {
                        x: this.playerPosition.x + Math.cos(angle) * dist,
                        y: this.playerPosition.y + Math.sin(angle) * dist
                    };
                    
                    // Clamp to map bounds
                    if (this.gameMap) {
                        target.x = Math.max(0, Math.min(target.x, this.gameMap.width));
                        target.y = Math.max(0, Math.min(target.y, this.gameMap.height));
                    }
                    
                    this.addDesire({
                        type: 'moveToLocation',
                        targetName: 'Unstuck',
                        targetPosition: target,
                        isResolved: false,
                        status: 'pending',
                        priority: 0, // Highest Priority
                        creationTime: now
                    });
                }
            }
            // Update Checkpoint
            this.lastPositionCheckTime = now;
            this.lastPosition = { ...this.playerPosition };
        }*/

        // -0.5 Avoid Grenades (Highest Priority)
        for (const obj of this.objects) {
            if (obj instanceof Projectile && !obj.destroyed) {
                const def = obj.definition;
                if (!def.detonation?.explosion) continue; // No explosion (e.g. smoke)

                const explosionId = def.detonation.explosion;
                const explosionDef = Explosions.definitions.find(e => e.idString === explosionId);
                
                if (explosionDef && explosionDef.damage > 0) {
                     const dist = Geometry.distance(this.playerPosition, obj.position);
                     const safeDist = explosionDef.radius.max + 5; // buffer
                     
                     if (dist < safeDist) {
                         this.addDesire({
                            type: 'avoidGrenade',
                            targetName: 'Grenade',
                            targetPosition: obj.position, // Danger source
                            targetId: obj.id,
                            isResolved: false,
                            status: 'pending',
                            priority: 0, // Top priority
                            creationTime: now
                        });
                     }
                }
            }
        }

        // 0. Avoid Gas (Highest Priority)
        if (this.IsDangerGas()) {
            let safeCenter = GasManager.position;
             if (!safeCenter || (safeCenter.x === 0 && safeCenter.y === 0)) {
                safeCenter = { x: this.gameMap!.width / 2, y: this.gameMap!.height / 2 };
            }
            
            this.addDesire({
                type: 'avoidGas',
                targetName: 'SafeZone',
                targetPosition: safeCenter,
                isResolved: false,
                status: 'pending',
                priority: 0,
                creationTime: now
            });
        }

        // 1. Combat (High Priority)
        const enemy = this.findClosestEnemy();
        if (enemy && Geometry.distance(this.playerPosition, enemy.position) < 80) {
             this.addDesire({
                type: 'killEnemy',
                targetName: `Enemy_${enemy.id}`,
                targetPosition: enemy.position,
                targetId: enemy.id,
                isResolved: false,
                status: 'pending',
                priority: 1,
                creationTime: now
            });
        }
        
        // 2. Healing (High Priority if low health)
        const hasHealthMeds = this.hasMedicalItem(true);
        const hasAnyMeds = this.hasMedicalItem(false);

        if ((this.playerHealth < 95 && hasHealthMeds) || (this.playerHealth < 100 && hasAnyMeds)) {
            let prio = 2;
            if (this.playerHealth < 30) {
                prio = 0;
            } else if (this.playerHealth < 40) {
                prio = 0.5;
            }
            const existing = this.desires.find(d => d.type === 'heal');
            if (!existing || existing.priority > prio) {
                this.addDesire({
                    type: 'heal',
                    targetName: 'Self',
                    targetPosition: this.playerPosition,
                    isResolved: false,
                    status: 'pending',
                    priority: prio,
                    creationTime: now
                });
            }
        }

        // 2.1 Boost Adrenaline (High Priority if combat imminent or just to keep high)
        // Keep adrenaline > 80 if we have boosters.
        const bestBooster = this.getBestMedicalItem(false, true);
        if (bestBooster && this.playerAdrenaline < 80) {
            // If enemy is within 150 units, consider it imminent combat
            const closeEnemy = this.findClosestEnemy();
            const distToEnemy = closeEnemy ? Geometry.distance(this.playerPosition, closeEnemy.position) : Infinity;
            
            let boostPrio = 2.5; // Default Idle Priority

            if (distToEnemy < 150) {
                if (distToEnemy < 30) {
                    // Too close! Prioritize Fighting (Prio 1) over Boosting
                    boostPrio = 1.2;
                } else {
                    // Good range to Pre-pot
                    boostPrio = 0.8;
                }
            }
            
            const existing = this.desires.find(d => d.type === 'heal');
            // If no existing heal, OR existing is lower priority (higher value) than this boost
            if (!existing || existing.priority > boostPrio) {
                 this.addDesire({
                    type: 'heal',
                    targetName: 'Boost',
                    targetPosition: this.playerPosition,
                    isResolved: false,
                    status: 'pending',
                    priority: boostPrio,
                    creationTime: now
                });
            }
        }

        // 2.5 Reloading (Priority 1.5) - Between Combat and Looting
        if (this.inventory?.weapons && this.inventoryItems?.items) {
            for (let i = 0; i < 2; i++) {
                const w = this.inventory.weapons[i];
                if (w && w.definition.idString !== 'fists' && (w.count ?? 0) < w.definition.capacity) {
                    const ammoType = w.definition.ammoType;
                    const reserve = this.inventoryItems.items[ammoType] || 0;
                    if (reserve > 0) {
                        this.addDesire({
                            type: 'reload',
                            targetName: w.definition.idString,
                            targetPosition: this.playerPosition,
                            targetSlot: i,
                            isResolved: false,
                            status: 'pending',
                            priority: 1.5,
                            creationTime: now
                        });
                        break; // One reload at a time
                    }
                }
            }
        }

        // 3. Loot Scanning
        const potentialLoots = this.scanForLoots();
        for (const desire of potentialLoots) {
            this.addDesire(desire);
        }
    }

    private scanForLoots(): Desire[] {
        const results: Desire[] = [];
        const nearbyLoots = this.findNearbyLoots(); // This already handles Distance & Visibility checks
        
        // Sort by distance (closest first)
        nearbyLoots.sort((a, b) => a.distance - b.distance);
        
        // Helper to check if we already have a pending desire for this item
        const hasPendingDesire = (id: number) => this.desires.some(d => d.targetId === id && !d.isResolved);
        
        // Clean up old dropped items records (> 30 seconds)
        const now = Date.now();
        this.droppedItems = this.droppedItems.filter(d => now - d.timestamp < 30000);

        const expectAmmoTypes = new Set<string>();
        for (const item of nearbyLoots) {
            const loot = item.loot as Loot;
            const def = loot.definition;
            
            if (hasPendingDesire(loot.id)) continue;

            // Anti-Ping-Pong: Check if we recently dropped this weapon type nearby
            if (def.defType === DefinitionType.Gun) {
                const isRecentlyDropped = this.droppedItems.some(d => 
                    d.weaponId === def.idString && 
                    Geometry.distance(loot.position, d.position) < 50
                );
                if (isRecentlyDropped) {
                    // console.log(`Ignoring recently dropped weapon: ${def.idString}`);
                    continue;
                }
            }
            
            // Common Desire Props
            const baseDesire = {
                targetName: def.idString,
                targetPosition: loot.position,
                targetId: loot.id,
                isResolved: false,
                status: 'pending' as const,
                priority: 3, // Default priority
                creationTime: now
            };

            switch (def.defType) {
                case DefinitionType.HealingItem: {
                    const healId = def.idString;
                    const current = this.inventoryItems?.items?.[healId] || 0;
                    const backpack = this.activePlayer?.equipment?.backpack;
                    // @ts-ignore
                    const maxCapacity = backpack?.maxCapacity?.[healId] ?? 5;
                    
                    if (current < maxCapacity) {
                         // Higher priority if we have NO healing items
                         if (current === 0 && this.playerHealth < 100) baseDesire.priority = 2;
                         results.push({ ...baseDesire, type: 'pickupLoot', priority: baseDesire.priority });
                    }
                    break;
                }
                case DefinitionType.Gold: {
                    const goldId = def.idString;
                    const current = this.inventoryItems?.items?.[goldId] || 0;
                    const backpack = this.activePlayer?.equipment?.backpack;
                    // @ts-ignore
                    const maxCapacity = backpack?.maxCapacity?.[goldId] ?? 10000;
                    
                    if (current < maxCapacity) {
                         results.push({ ...baseDesire, type: 'pickupLoot', priority: baseDesire.priority });
                    }
                    break;
                }
                case DefinitionType.Armor: {
                    const armorDef = def as any;
                    if (!this.activePlayer) break;
                    
                    if (armorDef.armorType === 0) { // Helmet
                        const currentLevel = this.activePlayer.equipment.helmet?.level ?? 0;
                        if (armorDef.level > currentLevel) {
                            const priority = armorDef.level >= 3 ? 1 : 3;
                            results.push({ ...baseDesire, type: 'pickupLoot', priority });
                        }
                    } else { // Vest (armorType === 1)
                        const currentLevel = this.activePlayer.equipment.vest?.level ?? 0;
                        if (armorDef.level > currentLevel) {
                            const priority = armorDef.level >= 3 ? 1 : 3;
                            results.push({ ...baseDesire, type: 'pickupLoot', priority });
                        }
                    }
                    break;
                }
                case DefinitionType.Backpack: {
                    const backpackDef = def as any;
                    if (!this.activePlayer) break;
                    const currentLevel = this.activePlayer.equipment.backpack?.level ?? 0;
                    if (backpackDef.level > currentLevel) {
                        const priority = backpackDef.level >= 3 ? 1 : 3;
                        results.push({ ...baseDesire, type: 'pickupLoot', priority });
                    }
                    break;
                }
                case DefinitionType.Scope: {
                    const scopeDef = def as any;
                    const currentScope = this.inventoryItems?.scope;
                    if (!currentScope) {
                        results.push({ ...baseDesire, type: 'pickupLoot' });
                    } else if (scopeDef.zoomLevel > currentScope.zoomLevel) {
                        //console.log("holding scope", currentScope, "loot: ", scopeDef);
                        if (scopeDef.zoomLevel >= 160) {
                            results.push({ ...baseDesire, type: 'pickupLoot', priority: 1 });
                        } else {
                            results.push({ ...baseDesire, type: 'pickupLoot' });
                        }
                    }
                    break;
                }
                case DefinitionType.Melee: {
                    if (this.inventory && this.inventory.weapons) {
                        const currentMelee = this.inventory.weapons[2];
                        const groundId = def.idString;
                        
                        if (!currentMelee || currentMelee.definition.idString === 'fists') {
                            results.push({ ...baseDesire, type: 'pickupMelee', priority: 2 });
                        } else if (MeleeEvaluator.shouldSwap(currentMelee?.definition.idString ?? null, groundId)) {
                            results.push({ ...baseDesire, type: 'pickupMelee', priority: 3 });
                        }
                    } else {
                        results.push({ ...baseDesire, type: 'pickupMelee', priority: 3 });
                    }
                    break;
                }
                case DefinitionType.Throwable: {
                    if (this.inventory && this.inventory.weapons) {
                        const currentThrowable = this.inventory.weapons[3];
                        const groundId = def.idString;

                        let throwPriority = 3;
                        if (groundId == "frag_grenade") {
                            let shouldPickup = false;
                            if (!currentThrowable) {
                                shouldPickup = true;
                                throwPriority = 1;
                            }
                            
                            if (shouldPickup) {
                                results.push({ 
                                    ...baseDesire, 
                                    type: 'pickupThrowable', 
                                    priority: throwPriority, 
                                });
                            }
                        }
                    } else {
                        // If no inventory data yet, try to pick up any frag or smoke
                        if (def.idString === 'frag_grenade' || def.idString === 'smoke_grenade') {
                            results.push({ ...baseDesire, type: 'pickupThrowable', priority: 3 });
                        }
                    }
                    break;
                }
                case DefinitionType.Gun: {
                    if (this.inventory && this.inventory.weapons) {
                        const slot1Gun = this.inventory.weapons[0];
                        const slot2Gun = this.inventory.weapons[1];
                        const groundId = def.idString;
                        const groundInfo = WeaponEvaluator.getWeaponInfo(groundId);
                        
                        // Evaluate Slot 1
                        let slot1Better = false;
                        if (!slot1Gun || slot1Gun.definition.idString === 'fists') {
                            slot1Better = true;
                        } else {
                            const s1Info = WeaponEvaluator.getWeaponInfo(slot1Gun.definition.idString);
                            if (groundInfo.score > s1Info.score + 5) slot1Better = true; // +5 Threshold
                        }
                        
                        if (slot1Better) {
                             // Priority Upgrade: If we have NO guns, this is Priority 2.
                             const hasAnyGun1 = (slot1Gun && slot1Gun.definition.idString !== 'fists') || 
                                               (slot2Gun && slot2Gun.definition.idString !== 'fists');
                             const hasAnyGun = hasAnyGun1 || (expectAmmoTypes.size > 0);
                             results.push({ ...baseDesire, type: 'pickupGun', priority: hasAnyGun ? 3 : 0, targetSlot: 0 });
                             // Don't add double desires for the same gun (for slot 1 and 2)
                             // Prioritize Slot 1 if both empty? Yes.
                             expectAmmoTypes.add(def.ammoType);
                             continue;
                        }

                        // Evaluate Slot 2
                        let slot2Better = false;
                        if (!slot2Gun || slot2Gun.definition.idString === 'fists') {
                            slot2Better = true;
                        } else {
                            const s2Info = WeaponEvaluator.getWeaponInfo(slot2Gun.definition.idString);
                            if (groundInfo.score > s2Info.score + 5) slot2Better = true;
                        }

                        if (slot2Better) {
                            const hasAnyGun1 = (slot1Gun && slot1Gun.definition.idString !== 'fists') || 
                                               (slot2Gun && slot2Gun.definition.idString !== 'fists');
                            const hasAnyGun = hasAnyGun1 || (expectAmmoTypes.size > 0);
                            results.push({ ...baseDesire, type: 'pickupGun', priority: hasAnyGun ? 3 : 0, targetSlot: 1 });
                            expectAmmoTypes.add(def.ammoType);
                        }
                    } else {
                        // No inventory info? Just try to pick it up.
                        results.push({ ...baseDesire, type: 'pickupGun', priority: 2, targetSlot: 0 });
                        expectAmmoTypes.add(def.ammoType);
                    }
                    break;
                }
            }
        }
        
        if (this.inventory && this.inventory.weapons) {
            const slot1Gun = this.inventory.weapons[0];
            const slot2Gun = this.inventory.weapons[1];
            if ((slot1Gun && slot1Gun.definition.idString !== 'fists') || (slot2Gun && slot2Gun.definition.idString !== 'fists')) {
                // Implement: For pickupGun desires in this.desire where status is NOT doing, lower priority to 2.
                for (const desire of this.desires) {
                    if (desire.type === 'pickupGun' && desire.status !== 'doing') {
                        desire.priority = 2;
                    }
                }
            }
        }
        //TODO console.log("expectAmmoTypes: ", JSON.stringify(expectAmmoTypes));
        for (const item of nearbyLoots) {
            const loot = item.loot as Loot;
            const def = loot.definition;
            
            if (hasPendingDesire(loot.id)) {
                continue;
            }
            const baseDesire = {
                targetName: def.idString,
                targetPosition: loot.position,
                targetId: loot.id,
                isResolved: false,
                status: 'pending' as const,
                priority: 3, // Default priority
                creationTime: now
            };

            if (def.defType == DefinitionType.Ammo) {
                const ammoId = def.idString;
                const current = this.inventoryItems?.items?.[ammoId] || 0;
                // Need to cast to any because maxCapacity is strictly typed but we are using string index
                const backpack = this.activePlayer?.equipment?.backpack;
                // @ts-ignore
                const maxCapacity = backpack?.maxCapacity?.[ammoId] ?? 999;
                    
                if (current < maxCapacity) {
                    // Check if this ammo matches any of our guns
                    let isMatch = false;
                    if (expectAmmoTypes.has(ammoId)) {
                        isMatch = true;
                    } else if (this.inventory?.weapons) {
                        for (const w of this.inventory.weapons) {
                            if (w && w.definition.idString !== 'fists' && w.definition.ammoType === ammoId) {
                                isMatch = true;
                                break;
                            }
                        }
                    }

                    // Priority Logic:
                    // 1. If we have a gun for this ammo AND it is very close (< 8m), grab it immediately (Priority 1.1)
                    //    This prevents the "pick gun and run" stupidity.
                    // 2. If we are critically low on this ammo (< 30), Priority 1.5
                    // 3. Otherwise, standard Priority 3.
                    let p = 3;
                    if (isMatch) {
                        const dist = Geometry.distance(this.playerPosition, loot.position);
                        if (dist < 20) {
                            p = 0.1;
                        } else if (current < maxCapacity/5) {
                            p = 0.5;
                        }
                    }
                    results.push({ ...baseDesire, type: 'pickupLoot', priority: p });
                }
            }
        }

        return results;
    }

    private addDesire(newDesire: Desire): void {
        // Check if desire already exists
        const existingIndex = this.desires.findIndex(d => 
            d.type === newDesire.type && 
            (d.targetId === newDesire.targetId || (newDesire.targetId === undefined && d.targetName === newDesire.targetName))
        );

        if (existingIndex !== -1) {
            // Update existing desire
            const existing = this.desires[existingIndex];
            existing.targetPosition = newDesire.targetPosition; // Update pos (e.g. moving enemy)
            
            // Only update priority if it became MORE urgent
            if (newDesire.priority < existing.priority) {
                existing.priority = newDesire.priority;
                // Re-sort needed
                this.desires.sort((a, b) => a.priority - b.priority);
            }
            return;
        }
        
        // Insert based on priority
        let insertIndex = this.desires.length;
        for(let i=0; i<this.desires.length; i++) {
            if(newDesire.priority < this.desires[i].priority) {
                insertIndex = i;
                break;
            }
        }
        this.desires.splice(insertIndex, 0, newDesire);
    }

    private async processDesires() {
        if (this.desires.length === 0) return;

        // Sort: Priority (Ascending) -> Distance to Player (Ascending)
        // This ensures that among equal priority tasks, we pick the closest one.
        this.desires.sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            const distA = Geometry.distance(this.playerPosition, a.targetPosition);
            const distB = Geometry.distance(this.playerPosition, b.targetPosition);
            return distA - distB;
        });
        
        // 2. Debug Logging (Top N desires)
        //if (this.desires.length > 0 && Math.random() < 0.05) { 
            //const topDesires = this.desires.slice(0, 5).map(d => `${JSON.stringify(d)}`);
            //console.log(`Top Desires: ${topDesires.join('\n')}`);
        //}

        const currentDesire = this.desires[0];
        currentDesire.status = 'doing';

        // Validate
        if (!this.isDesireValid(currentDesire)) {
            // console.log(`Desire ${currentDesire.type} became invalid. Removing.`);
            this.desires.shift(); 
            this.isForceStop = false; // Reset force stop if we were doing something
            return;
        }

        // Execute
        switch (currentDesire.type) {
            case 'avoidGas':
                this.handleAvoidGas(currentDesire);
                break;
            case 'avoidGrenade':
                this.handleAvoidGrenade(currentDesire);
                break;
            case 'killEnemy':
                await this.handleKillEnemy(currentDesire);
                break;
            case 'pickupGun':
            case 'pickupMelee':
            case 'pickupThrowable':
            case 'pickupLoot':
                await this.handlePickupLoot(currentDesire);
                break;
            case 'heal':
                await this.handleHeal(currentDesire);
                break;
            case 'reload':
                await this.handleReload(currentDesire);
                break;
            case 'moveToLocation':
                await this.handleMoveToLocation(currentDesire);
                break;
        }

        // Check Completion
        if (this.checkDesireCompletion(currentDesire)) {
             currentDesire.isResolved = true;
             console.log(`Desire ${currentDesire.type} completed.`);
             this.desires.shift();
             this.isForceStop = false;
        }
    }

    private isDesireValid(desire: Desire): boolean {
        // Generic timeout
        if (Date.now() - desire.creationTime > 30000) return false;

        switch (desire.type) {
            case 'pickupGun':
            case 'pickupMelee':
            case 'pickupThrowable':
            case 'pickupLoot':
                // Special Case: If we already successfully picked it up (Completion condition met), 
                // then it is VALID (so we can reach the completion check phase).
                if (this.checkDesireCompletion(desire)) return true;

                // Check if loot object still exists
                if (desire.targetId) {
                    const obj = this.objects.get(desire.targetId);
                    if (!obj || obj.destroyed) return false;

                    // Specific validation for lootable items
                    if (obj instanceof Loot) {
                        if (!this.isLootDesireStillValid(desire, obj)) return false;
                    }
                }
                break;
            case 'avoidGrenade':
                if (desire.targetId) {
                    const obj = this.objects.get(desire.targetId);
                    if (!obj || obj.destroyed) return false; // Grenade gone, no need to avoid
                }
                break;
            case 'killEnemy':
                // If enemy is dead, it's valid (will be completed)
                if (desire.targetId) {
                    const enemy = this.objects.get(desire.targetId);
                    //console.log("enemy: ", enemy)
                    if (enemy && enemy.dead) return true; // Will be handled by completion
                    if (!enemy || enemy.destroyed) return false;
                }
                break;
            case 'reload':
                if (this.inventory?.weapons && desire.targetSlot !== undefined) {
                    const w = this.inventory.weapons[desire.targetSlot];
                    if (!w || w.definition.idString !== desire.targetName) return false;
                    const reserve = this.inventoryItems?.items?.[w.definition.ammoType] || 0;
                    if (reserve <= 0) return false;
                }
                break;
        }
        return true;
    }

    private isLootDesireStillValid(desire: Desire, loot: Loot): boolean {
        // 0. Check if the loot still exists in the world
        if (!loot || loot.destroyed || !this.objects.hasId(loot.id)) {
            return false;
        }

        const def = loot.definition;

        // 1. Capacity check for stackable items
        if (def.defType === DefinitionType.Ammo || 
            def.defType === DefinitionType.HealingItem || 
            def.defType === DefinitionType.Gold) {
            const id = def.idString;
            const current = this.inventoryItems?.items?.[id] || 0;
            const backpack = this.activePlayer?.equipment?.backpack;
            if (backpack) {
                const maxCapacity = (backpack.maxCapacity as any)[id];
                if (maxCapacity !== undefined && current >= maxCapacity) return false;
            }
        }

        // 2. Equipment upgrade check
        if (!this.activePlayer) return true;

        switch (def.defType) {
            case DefinitionType.Armor: {
                const armorDef = def as any;
                if (armorDef.armorType === 0) { // Helmet
                    const currentLevel = this.activePlayer.equipment.helmet?.level ?? 0;
                    return armorDef.level > currentLevel;
                } else { // Vest
                    const currentLevel = this.activePlayer.equipment.vest?.level ?? 0;
                    return armorDef.level > currentLevel;
                }
            }
            case DefinitionType.Backpack: {
                const backpackDef = def as any;
                const currentLevel = this.activePlayer.equipment.backpack?.level ?? 0;
                return backpackDef.level > currentLevel;
            }
            case DefinitionType.Scope: {
                const scopeDef = def as any;
                const currentScope = this.inventoryItems?.scope;
                if (!currentScope) return true;
                return scopeDef.zoomLevel > currentScope.zoomLevel;
            }
            case DefinitionType.Melee: {
                if (this.inventory && this.inventory.weapons) {
                    const currentMelee = this.inventory.weapons[2];
                    const groundId = def.idString;
                    return MeleeEvaluator.shouldSwap(currentMelee?.definition.idString ?? null, groundId);
                }
                break;
            }
            case DefinitionType.Throwable: {
                if (this.inventory && this.inventory.weapons) {
                    const currentThrowable = this.inventory.weapons[3];
                    const groundId = def.idString;
                    
                    const throwableOrder = ['frag_grenade', 'smoke_grenade'];
                    const groundIdx = throwableOrder.indexOf(groundId);
                    
                    if (groundIdx === -1) return false;
                    
                    if (!currentThrowable || currentThrowable.definition.idString === 'fists') {
                        return true;
                    } else {
                        const currentIdx = throwableOrder.indexOf(currentThrowable.definition.idString);
                        if (groundIdx < currentIdx) return true;
                        if (groundId === currentThrowable.definition.idString && (currentThrowable.count ?? 0) < 5) return true;
                    }
                    return false;
                }
                break;
            }
            case DefinitionType.Gun: {
                if (desire.targetSlot !== undefined && this.inventory?.weapons) {
                    const currentGun = this.inventory.weapons[desire.targetSlot];
                    const groundId = def.idString;
                    const groundInfo = WeaponEvaluator.getWeaponInfo(groundId);
                    
                    if (!currentGun || currentGun.definition.idString === 'fists') return true;
                    
                    const currentInfo = WeaponEvaluator.getWeaponInfo(currentGun.definition.idString);
                    return groundInfo.score > currentInfo.score + 5;
                }
                break;
            }
        }

        return true;
    }


    private checkDesireCompletion(desire: Desire): boolean {
        switch (desire.type) {
            case 'pickupGun':
                 if (this.inventory && this.inventory.weapons && desire.targetSlot !== undefined) {
                     const w = this.inventory.weapons[desire.targetSlot];
                     const hasIt = w && w.definition.idString === desire.targetName;
                     const isHoldingIt = this.inventory.activeWeaponIndex === desire.targetSlot;
                     // Must HAVE it and be HOLDING it
                     return !!(hasIt && isHoldingIt);
                 }
                 return false;
            
            case 'pickupMelee':
                 if (this.inventory && this.inventory.weapons) {
                     const w = this.inventory.weapons[2];
                     const hasIt = w && w.definition.idString === desire.targetName;
                     return !!hasIt;
                 }
                 return false;

            case 'pickupThrowable':
                if (this.inventory && this.inventory.weapons) {
                    const w = this.inventory.weapons[3];
                    const hasIt = w && w.definition.idString === desire.targetName;
                    return !!hasIt;
                }
                return false;

            case 'pickupLoot':
                 if (this.inventoryItems && this.inventoryItems.items && desire.targetName) {
                     const count = this.inventoryItems.items[desire.targetName] || 0;
                     if (count > 0 && desire.targetId && !this.objects.hasId(desire.targetId)) {
                         return true;
                     }
                 }
                 return false;

            case 'killEnemy':
                 if (desire.targetId) {
                    const enemy = this.objects.get(desire.targetId);
                    if (enemy && enemy.dead) return true;
                 }
                 return false;
            
            case 'avoidGas':
                return this.isInSafeZone(this.playerPosition);

            case 'avoidGrenade':
                if (desire.targetId) {
                    const obj = this.objects.get(desire.targetId);
                    if (!obj || obj.destroyed) return true; // Grenade gone
                    
                    // Re-check distance
                    if (obj instanceof Projectile) {
                        const def = obj.definition;
                        const explosionId = def.detonation?.explosion;
                        const explosionDef = Explosions.definitions.find(e => e.idString === explosionId);
                        const safeDist = (explosionDef?.radius.max ?? 25) + 5;
                        
                        if (Geometry.distance(this.playerPosition, obj.position) > safeDist) return true;
                    }
                }
                return false;
            
            case 'heal':
                return this.playerHealth >= 100 || !this.hasMedicalItem();
            
            case 'reload':
                if (this.inventory?.weapons && desire.targetSlot !== undefined) {
                    const w = this.inventory.weapons[desire.targetSlot];
                    return !!(w && (w.count ?? 0) >= w.definition.capacity);
                }
                return true;

            case 'moveToLocation':
                return Geometry.distance(this.playerPosition, desire.targetPosition) < 5;
        }
        return false;
    }

    private handleAvoidGas(desire: Desire): void {
        this.targetPosition = desire.targetPosition;
        this.isForceStop = false;
        this.UpdateMovement();
    }

    private handleAvoidGrenade(desire: Desire): void {
        this.isForceStop = false;
        
        let grenadePos = desire.targetPosition;
        // If grenade moved (e.g. rolling), update if possible.
        if (desire.targetId) {
             const obj = this.objects.get(desire.targetId);
             if (obj) grenadePos = obj.position;
        }

        const dx = this.playerPosition.x - grenadePos.x;
        const dy = this.playerPosition.y - grenadePos.y;
        const angle = Math.atan2(dy, dx); // Angle AWAY from grenade
        
        // Project a point far away (e.g. 50 units)
        const dist = 50;
        const target = {
            x: this.playerPosition.x + Math.cos(angle) * dist,
            y: this.playerPosition.y + Math.sin(angle) * dist
        };
        
        this.targetPosition = target;
        this.UpdateMovement();
    }

    private async handleKillEnemy(desire: Desire): Promise<void> {
        this.isForceStop = false;
        // Reuse TacticalCombat logic but directed at specific target
        // We need to set target for movement
        this.targetPosition = desire.targetPosition; 
        
        // TacticalCombat finds closest enemy. We should ensure it targets OUR desire enemy.
        // For now, calling TacticalCombat is acceptable as it likely targets the same enemy.
        this.TacticalCombat();
    }

    private async handleMoveToLocation(desire: Desire): Promise<void> {
        this.isForceStop = false;
        this.targetPosition = desire.targetPosition;
        this.UpdateMovement();
        
        // Check if we arrived
        const dist = Geometry.distance(this.playerPosition, desire.targetPosition);
        if (dist < 5) {
            desire.isResolved = true; // Mark as done so we can remove it
        }
    }

    private async handlePickupLoot(desire: Desire): Promise<void> {
        // 1. Move to target
        const dist = Geometry.distance(this.playerPosition, desire.targetPosition);
        //console.log("dist: ", dist);

        this.targetPosition = desire.targetPosition;
        this.isForceStop = true; // Take control of movement

        // CRITICAL: For gun pickups, we MUST be in the correct slot BEFORE interacting.
        // Otherwise we might swap our good gun in Slot 0 instead of filling Empty Slot 1.
        if (desire.type === 'pickupMelee') {
            if (this.inventory?.activeWeaponIndex !== 2) {
                this.sendAction({ type: InputActions.EquipItem, slot: 2 });
                await delay(200);
                return;
            }
        } else if (desire.type === 'pickupThrowable') {
            const w = this.inventory?.weapons?.[3];
            if (!w) {
                //do nothing
            } else if (this.inventory?.activeWeaponIndex !== 3) {
                this.sendAction({ type: InputActions.EquipItem, slot: 3 });
                await delay(200);
                return;
            }
        } else if (desire.type === 'pickupGun') {
            console.log("pickupGun, targetSlot", desire.targetSlot, "activeWeaponIndex:", this.inventory.activeWeaponIndex);
            if (desire.targetSlot == 1) {
                const w = this.inventory?.weapons?.[1];
                if (!w) {
                    //do nothing
                } else if (this.inventory.activeWeaponIndex !== desire.targetSlot) {
                    this.sendAction({ type: InputActions.EquipItem, slot: 1 });
                    await delay(200);
                    return; 
                }
            } else {
                const w = this.inventory?.weapons?.[0];
                if (!w) {
                    //do nothing
                } else if (this.inventory.activeWeaponIndex !== desire.targetSlot) {
                    this.sendAction({ type: InputActions.EquipItem, slot: 0 });
                    await delay(200);
                    return; 
                }
            }
        }

        if (desire.type !== 'pickupGun') {
            const w = this.inventory?.weapons?.[1];
            if (w && w.definition.defType === DefinitionType.Gun && w.definition.idString !== 'fists') {
                if ((w.count ?? 0) > 0) {
                    if (this.inventory.activeWeaponIndex == 1) {
                        this.sendAction({ type: InputActions.EquipItem, slot: 0 });
                        await delay(200);
                    }
                } else {
                   if (this.inventory.activeWeaponIndex == 0) {
                        this.sendAction({ type: InputActions.EquipItem, slot: 1 });
                        await delay(200);
                    }
                }
            }
        }

        const dx = desire.targetPosition.x - this.playerPosition.x;
        const dy = desire.targetPosition.y - this.playerPosition.y;
        const angle = Math.atan2(dy, dx);
        
        const interactionRange = 2.5;
        const movement = {
            up: Math.abs(dy) > interactionRange && dy < 0,
            down: Math.abs(dy) > interactionRange && dy > 0,
            left: Math.abs(dx) > interactionRange && dx < 0,
            right: Math.abs(dx) > interactionRange && dx > 0
        };
        this.constrainMovement(movement);
        
        // Pre-interact logic:
        // Use client-like logic: only interact if our target is the closest interactable
        let actions = [];
        //const closest = this.getClosestInteractable();
        if (this.isDesireLootInteractable(desire.targetId!)) {
            //console.log("closest Interactable", JSON.stringify(this.objects.get(desire.targetId!)));

            // Ensure we are in correct slot if it's a gun, melee or throwable
            if (desire.type !== 'pickupGun' && desire.type !== 'pickupMelee' && desire.type !== 'pickupThrowable') {
                actions.push({ type: InputActions.Interact });
            } else if (desire.type === 'pickupMelee') {
                if (this.inventory?.activeWeaponIndex === 2) {
                    actions.push({ type: InputActions.Interact });
                }
            } else if (desire.type === 'pickupThrowable') {
                const w = this.inventory?.weapons?.[3];
                if (!w) {
                    actions.push({ type: InputActions.Interact });
                } else if (this.inventory?.activeWeaponIndex === 3) {
                    actions.push({ type: InputActions.Interact });
                }
            } else if (desire.type === 'pickupGun') {
                if (desire.targetSlot == 0 || desire.targetSlot == 1) {
                    const w = this.inventory?.weapons?.[desire.targetSlot];
                    if (!w) {
                        actions.push({ type: InputActions.Interact });
                    } else if (this.inventory?.activeWeaponIndex === desire.targetSlot) {
                        actions.push({ type: InputActions.Interact });
                    }
                }
            }
        }
        
         const inputPacket = InputPacket.create({
            movement,
            attacking: false,
            actions: actions,
            pingSeq: 0,
            turning: true,
            rotation: angle,
            distanceToMouse: dist,
            isMobile: false
        });
        this.sendPacket(inputPacket);
        await delay(200);

        if (desire.type === 'pickupGun') {
            // Check if we already have the gun in that slot
            const w = this.inventory?.weapons?.[desire.targetSlot!];
            const alreadyHasGun = w && w.definition.idString === desire.targetName;

            if (alreadyHasGun) {
                // We have it. Just ensure we are holding it (Activation).
                if (this.inventory.activeWeaponIndex !== desire.targetSlot) {
                    console.log("EquipItem 1")
                    this.sendAction({ type: InputActions.EquipItem, slot: desire.targetSlot });
                    await delay(200);
                }
                return;
            }
        }
    }

    private async handleHeal(desire: Desire): Promise<void> {
        this.isForceStop = false; // Moving doesn't interrupt healing
        
        // Ensure we have a movement target while healing
        if (this.IsDangerGas()) {
            this.AvoidGas();
        } else if (!this.targetPosition) {
            this.ensureWanderTarget();
        }

        this.PerformHealing();
        this.UpdateMovement();
    }

    private hasAnyAmmoInClip(): boolean {
        if (!this.inventory?.weapons) return false;
        for (let i = 0; i < 2; i++) {
            const w = this.inventory.weapons[i];
            if (w && w.definition.defType === DefinitionType.Gun && w.definition.idString !== 'fists') {
                if ((w.count ?? 0) > 0) return true;
            }
        }
        return false;
    }

    private calculateRetreatMovement(enemy: Player): any {
        const dx = enemy.position.x - this.playerPosition.x;
        const dy = enemy.position.y - this.playerPosition.y;
        const angleToEnemy = Math.atan2(dy, dx);
        
        // Move directly away from enemy
        const moveAngle = angleToEnemy + Math.PI;
        const moveX = Math.cos(moveAngle);
        const moveY = Math.sin(moveAngle);

        return {
            up: moveY < -0.5,
            down: moveY > 0.5,
            left: moveX < -0.5,
            right: moveX > 0.5
        };
    }

    private async handleReload(desire: Desire): Promise<void> {
        if (!this.inventory || desire.targetSlot === undefined) return;

        // 1. Switch to slot if not active
        if (this.inventory.activeWeaponIndex !== desire.targetSlot) {
            this.sendAction({ type: InputActions.EquipItem, slot: desire.targetSlot });
            return;
        }

        // 2. Trigger reload if holding it
        const player = this.activePlayer;
        if (player && player.action.type === PlayerActions.None) {
            this.sendAction({ type: InputActions.Reload });
        }
    }

    // --- Conditions ---
    public IsDangerGas(): boolean {
        // If gas is inactive, we are safe
        if (GasManager.state === 0) return false; // 0 = Inactive

        if (!this.playerPosition || !this.gameMap) return false;
        
        let safeCenter = GasManager.position;
        let safeRadius = GasManager.radius;

        // Fallback to map center if gas data seems uninitialized (0,0)
        if (!safeCenter || (safeCenter.x === 0 && safeCenter.y === 0)) {
            safeCenter = { x: this.gameMap.width / 2, y: this.gameMap.height / 2 };
        }
        
        if (typeof safeRadius !== 'number') return false;

        const dist = Geometry.distance(this.playerPosition, safeCenter);
        
        // Debug gas state occasionally
        if (Math.random() < 0.05) {
             console.log(`Gas Check: State ${GasManager.state}, Center ${safeCenter.x.toFixed(0)},${safeCenter.y.toFixed(0)}, Radius ${safeRadius.toFixed(0)}, PlayerDist ${dist.toFixed(0)}`);
        }

        // If outside safe zone or very close to edge (buffer 50)
        return dist > (safeRadius - 10); 
    }

    public CanReviveTeammate(): boolean {
        if (this.teamID === -1 || !this.playerPosition) return false;
        
        for (const obj of this.objects) {
            if (obj instanceof Player && 
                obj.id !== this.playerId && 
                obj.teamID === this.teamID && 
                obj.dead) { // 'dead' usually implies downed in this codebase context if they are still an object
                return true;
            }
        }
        return false;
    }

    public InCombat(): boolean {
        // Check if enemies are nearby
        const enemy = this.findClosestEnemy();
        return enemy !== null && Geometry.distance(this.playerPosition, enemy.position) < 80; // 80 units combat range
    }

    public HasWeapon(): boolean {
        return this.hasWeapon;
    }

    public AvoidGas(): void {
        if (!this.gameMap || !this.playerPosition) return;
        
        let target = GasManager.position;
        
        // Fallback to map center if gas position is (0,0)
        if (!target || (target.x === 0 && target.y === 0)) {
            target = { x: this.gameMap.width / 2, y: this.gameMap.height / 2 };
        }
        
        this.targetPosition = target;
    }

    public ReviveTeammate(): State {
        const teammate = this.findDownedTeammate();
        if (!teammate) return State.FAILED;

        const dist = Geometry.distance(this.playerPosition, teammate.position);
        const angle = Math.atan2(teammate.position.y - this.playerPosition.y, teammate.position.x - this.playerPosition.x);

        if (dist < 3) {
            // Interact to revive if teammate is the closest interactable
            let actions = [];
            const closest = this.getClosestInteractable();
            if (closest && closest.id === teammate.id) {
                actions.push({ type: InputActions.Interact });
            }

            // Interact to revive
             const inputPacket = InputPacket.create({
                movement: { up: false, down: false, left: false, right: false },
                attacking: false,
                actions: actions, // Use Interact for reviving and picking up items
                pingSeq: 0,
                turning: true,
                rotation: angle,
                distanceToMouse: dist,
                isMobile: false
            });
            this.sendPacket(inputPacket);
        } else {
            // Move to teammate
             const movement = {
                up: Math.abs(teammate.position.y - this.playerPosition.y) > 0.2 && (teammate.position.y < this.playerPosition.y),
                down: Math.abs(teammate.position.y - this.playerPosition.y) > 0.2 && (teammate.position.y > this.playerPosition.y),
                left: Math.abs(teammate.position.x - this.playerPosition.x) > 0.2 && (teammate.position.x < this.playerPosition.x),
                right: Math.abs(teammate.position.x - this.playerPosition.x) > 0.2 && (teammate.position.x > this.playerPosition.x)
            };
            this.constrainMovement(movement);
             const inputPacket = InputPacket.create({
                movement,
                attacking: false,
                actions: [],
                pingSeq: 0,
                turning: true,
                rotation: angle,
                distanceToMouse: dist,
                isMobile: false
            });
            this.sendPacket(inputPacket);
        }
        return State.SUCCEEDED;
    }

    public PerformHealing(): State {
        const now = Date.now();
        // Prefer booster if health is decent (>50) and adrenaline is not high (<80)
        const preferBooster = this.playerHealth > 50 && this.playerAdrenaline < 80;
        const bestMeds = this.getBestMedicalItem(false, preferBooster);
        
        if (!bestMeds) {
            this.healingState = 'none';
            return State.FAILED;
        }

        const player = this.activePlayer;
        if (!player) return State.FAILED;

        // State Machine for Healing
        switch (this.healingState) {
            case 'none':
                // Start using the item
                this.healingState = 'using';
                this.healingTimer = now;
                this.sendAction({ type: InputActions.UseItem, item: bestMeds.def });
                break;
                
            case 'using':
                // Check if the action is finished on the server
                if (player.action.type === PlayerActions.None) {
                    this.healingState = 'none';
                    return State.SUCCEEDED;
                }

                // Timeout safety (max 10 seconds for medikit)
                if (now - this.healingTimer > 10000) {
                    this.healingState = 'none';
                    return State.FAILED;
                }

                // Allow Movement
                const enemy = this.findClosestEnemy();
                let movement = { up: false, down: false, left: false, right: false };
                let rotation = 0;
                let distToMouse = 10;

                if (enemy) {
                    const dist = Geometry.distance(this.playerPosition, enemy.position);
                    rotation = Math.atan2(enemy.position.y - this.playerPosition.y, enemy.position.x - this.playerPosition.x);
                    distToMouse = dist;
                    // Use combat movement logic
                    if (this.playerHealth < 40) {
                        movement = this.calculateRetreatMovement(enemy);
                    } else {
                        movement = this.calculateCombatMovement(enemy, dist);
                    }
                } else {
                    // Non-combat movement: Follow other desires (e.g. SafeZone) or Wander
                    const moveDesire = this.desires.find(d => d.type === 'avoidGas' || d.type === 'moveToLocation');
                    if (moveDesire) {
                        const dx = moveDesire.targetPosition.x - this.playerPosition.x;
                        const dy = moveDesire.targetPosition.y - this.playerPosition.y;
                        rotation = Math.atan2(dy, dx);
                        movement = {
                            up: Math.abs(dy) > 0.2 && dy < 0,
                            down: Math.abs(dy) > 0.2 && dy > 0,
                            left: Math.abs(dx) > 0.2 && dx < 0,
                            right: Math.abs(dx) > 0.2 && dx > 0
                        };
                    } else {
                        // Random movement to avoid being static
                        const t = now / 500;
                        rotation = (now / 1000) % (Math.PI * 2);
                        movement = {
                            up: Math.sin(t) > 0.7,
                            down: Math.sin(t) < -0.7,
                            left: Math.cos(t) > 0.7,
                            right: Math.cos(t) < -0.7
                        };
                    }
                }

                this.constrainMovement(movement);

                const inputPacket = InputPacket.create({
                    movement,
                    attacking: false,
                    actions: [],
                    pingSeq: 0,
                    turning: true,
                    rotation: rotation,
                    distanceToMouse: distToMouse,
                    isMobile: false
                });
                this.sendPacket(inputPacket);
                break;

            case 'equipping':
            case 'recovering':
                 this.healingState = 'none';
                 return State.SUCCEEDED;
        }

        return State.RUNNING;
    }

    public TacticalCombat(): State {
        const enemy = this.findClosestEnemy();
        if (!enemy) return State.FAILED;

        const dist = Geometry.distance(this.playerPosition, enemy.position);
        
        // 1. Grenade Logic
        if (this.grenadeState !== 'none' || this.shouldThrowGrenade(dist)) {
            return this.performGrenadeThrow(enemy, dist);
        }

        // 2. Weapon Logic
        this.manageWeapon(dist);

        // 3. Movement (Strafing or Retreating)
        const isUsingMelee = this.inventory?.activeWeaponIndex === 2;
        const currentWep = this.inventory?.weapons[this.inventory.activeWeaponIndex];
        const hasAmmoInCurrentWep = currentWep && currentWep.definition.defType === DefinitionType.Gun && (currentWep.count ?? 0) > 0;
        const hasAnyAmmo = this.hasAnyAmmoInClip();
        
        let move;
        if (this.playerHealth < 40) {
            move = this.calculateRetreatMovement(enemy);
        } else if (isUsingMelee) {
            // Aggressively move towards enemy for melee
            move = this.calculateMeleeMovement(enemy, dist);
        } else if (hasAmmoInCurrentWep || hasAnyAmmo) {
            move = this.calculateCombatMovement(enemy, dist);
        } else {
            move = this.calculateRetreatMovement(enemy);
        }
        this.constrainMovement(move);

        // 4. Aiming & Shooting (Leading)
        const aimAngle = this.calculateLeadAim(enemy);
        
        const attacking = isUsingMelee ? (dist < 6) : hasAmmoInCurrentWep; 
        
        const inputPacket = InputPacket.create({
            movement: move,
            attacking: attacking,
            actions: [],
            pingSeq: 0,
            turning: true,
            rotation: aimAngle,
            distanceToMouse: dist,
            isMobile: false
        });
        this.sendPacket(inputPacket);

        return State.SUCCEEDED;
    }

    // --- Helpers ---
    private findClosestEnemy(): Player | null {
        let closest: Player | null = null;
        let minDst = Infinity;
        for (const obj of this.objects) {
            if (obj instanceof Player && obj.id !== this.playerId && !obj.dead) {
                if (obj.teamID == undefined) {
                    //observe
                    continue;
                }
                 if (this.teamID !== -1 && obj.teamID === this.teamID) continue;
                 
                 // Ignore enemies inside the gas (don't chase them to death)
                 if (!this.isInSafeZone(obj.position)) continue;

                 const d = Geometry.distance(this.playerPosition, obj.position);
                 if (d < minDst) { minDst = d; closest = obj; }
            }
        }
        return closest;
    }

    private findDownedTeammate(): Player | null {
        for (const obj of this.objects) {
            if (obj instanceof Player && obj.id !== this.playerId && obj.teamID === this.teamID && obj.dead) {
                return obj;
            }
        }
        return null;
    }

    private isInSafeZone(point: Vector): boolean {
        // If gas is inactive, everywhere is safe
        if (GasManager.state === 0) return true;

        if (!this.gameMap) return true;

        let safeCenter = GasManager.position;
        let safeRadius = GasManager.radius;

        if (!safeCenter || (safeCenter.x === 0 && safeCenter.y === 0)) {
             safeCenter = { x: this.gameMap.width / 2, y: this.gameMap.height / 2 };
        }

        if (typeof safeRadius !== 'number') return true;

        return Geometry.distance(point, safeCenter) <= (safeRadius-10);
    }

    private findNearbyLoots(): any[] {
        const lootItems = [];
        const now = Date.now();
        
        // Cleanup expired zones and looted items
        this.ignoredLootZones = this.ignoredLootZones.filter(z => z.expiry > now);
        for (const [id, expiry] of this.lootedItems) {
            if (expiry < now) this.lootedItems.delete(id);
        }
        
        // Dynamically calculate maxDistance based on scope zoomLevel
        // Default to 200 (for 2x scope which has zoomLevel 100)
        const zoom = this.inventory?.scope?.zoomLevel ?? 100;
        const maxDistance = zoom * 2;

        if (!this.gameMap) return [];

        const marginX = this.gameMap.width * 0.05;
        const marginY = this.gameMap.height * 0.05;
        //console.log("this.objects size: ", this.objects.size, "maxDistance: ", maxDistance);
        //console.log("agent position: ", this.playerPosition, "map info:", this.gameMap);

        for (const obj of this.objects) {
            if (obj instanceof (ObjectClassMapping[ObjectCategory.Loot] as any)) {
                const loot = obj as InstanceType<typeof ObjectClassMapping[ObjectCategory.Loot]>;
                
                // Ignore checks
                if (this.lootedItems.has(loot.id)) continue;

                // Zone check
                let inIgnoreZone = false;
                for (const zone of this.ignoredLootZones) {
                    if (Geometry.distance(loot.position, zone.position) < zone.radius) {
                        // Allow if it is our explicit target
                        if (this.explicitTargetId !== loot.id) {
                            // Fix: Only ignore GUNS in the ignored zone.
                            // This allows us to pick up ammo/meds that are right next to the gun we just swapped.
                            if (loot.definition.defType === DefinitionType.Gun) {
                                inIgnoreZone = true;
                                break;
                            }
                        }
                    }
                }
                if (inIgnoreZone) continue;
                
                // Ignore loot in the buffer zone or outside safe zone
                if (loot.position.x < marginX || loot.position.x > this.gameMap.width - marginX ||
                    loot.position.y < marginY || loot.position.y > this.gameMap.height - marginY ||
                    !this.isInSafeZone(loot.position)) {
                    continue;
                }

                if (loot.definition && 
                    (loot.definition.defType === DefinitionType.Gun || 
                     loot.definition.defType === DefinitionType.Melee ||
                     loot.definition.defType === DefinitionType.Throwable ||
                     loot.definition.defType === DefinitionType.Armor ||
                     loot.definition.defType === DefinitionType.Ammo ||
                     loot.definition.defType === DefinitionType.HealingItem ||
                     loot.definition.defType === DefinitionType.Scope ||
                     loot.definition.defType === DefinitionType.Gold)) {
                    
                    // Check carry limits for specific items
                    if (loot.definition.defType === DefinitionType.HealingItem || 
                        loot.definition.defType === DefinitionType.Ammo ||
                        loot.definition.defType === DefinitionType.Gold) {
                        const id = loot.definition.idString;
                        if (this.activePlayer && this.inventoryItems && this.inventoryItems.items) {
                            const currentCount = this.inventoryItems.items[id] || 0;
                            // Need to cast to any because maxCapacity is strictly typed but we are using string index
                            const backpack = this.activePlayer.equipment.backpack;
                            const maxCapacity = (backpack.maxCapacity as any)[id];
                            //console.log("id: ", id, "currentCount: ", currentCount, "maxCapacity: ", maxCapacity);
                            if (maxCapacity !== undefined && currentCount >= maxCapacity) {
                                continue;
                            }
                        }
                    }

                    const distance = Geometry.distance(this.playerPosition, loot.position);
                    if (distance <= maxDistance) {
                        lootItems.push({
                            loot: loot,
                            position: loot.position,
                            definition: loot.definition,
                            distance: distance
                        });
                    }
                }
            }
        }
        //if (lootItems.length > 0) {
        //    console.log(`Found ${lootItems.length} nearby loot items within distance ${maxDistance}.`);
        //}
        return lootItems;
    }

    private hasMedicalItem(onlyHealth: boolean = false): boolean {
        return !!this.getBestMedicalItem(onlyHealth);
    }

    private getBestMedicalItem(onlyHealth: boolean = false, preferBooster: boolean = false): { index: number, def: any } | null {
        if (!this.inventoryItems || !this.inventoryItems.items) return null;
        
        // Prioritize medikit > gauze for health
        const healthPriorities = ["medikit", "gauze"];
        const boosterPriorities = ["tablets", "cola"];

        if (preferBooster) {
            for (const id of boosterPriorities) {
                const count = this.inventoryItems.items[id] ?? 0;
                if (count > 0) {
                    const def = HealingItems.definitions.find(d => d.idString === id);
                    if (def) return { index: -1, def };
                }
            }
        }

        if (this.playerHealth < 100) {
            // If very low, medikit is best. If moderately low, gauze is fine.
            const preferredHealth = this.playerHealth < 50 ? ["medikit", "gauze"] : ["gauze", "medikit"];
            for (const id of preferredHealth) {
                const count = this.inventoryItems.items[id] ?? 0;
                if (count > 0) {
                    const def = HealingItems.definitions.find(d => d.idString === id);
                    if (def) return { index: -1, def };
                }
            }
        }

        if (onlyHealth) return null;

        // Boosters (only if not already checked)
        if (!preferBooster) {
            for (const id of boosterPriorities) {
                const count = this.inventoryItems.items[id] ?? 0;
                if (count > 0) {
                    const def = HealingItems.definitions.find(d => d.idString === id);
                    if (def) return { index: -1, def };
                }
            }
        }

        return null;
    }

    private shouldThrowGrenade(dist: number): boolean {
        // Check if we have grenade (usually slot 3, index 2 or 3 depending on 0-base)
        // Check range (e.g. 20 < dist < 60)
        return this.hasGrenade() && dist > 20 && dist < 60 && Math.random() < 0.05; // Low chance to not spam
    }

    private hasGrenade(): boolean {
        // Check slot 3 (index 2 or 3)
        // Simplified check
        return this.getGrenadeSlot() !== -1;
    }

    private getGrenadeSlot(): number {
         if (this.inventory && this.inventory.weapons) {
            for (let i = 0; i < this.inventory.weapons.length; i++) {
                const w = this.inventory.weapons[i];
                if (w && w.definition && w.definition.defType === DefinitionType.Throwable) {
                    return i;
                }
            }
        }
        return -1;
    }

    private performGrenadeThrow(enemy: Player, dist: number): State {
        const now = Date.now();
        const slot = this.getGrenadeSlot();
        
        if (slot === -1) {
             this.grenadeState = 'none';
             return State.FAILED;
        }

        const throwable = this.inventory.weapons[slot];
        const isCookable = throwable?.definition?.cookable;

        switch (this.grenadeState) {
            case 'none':
                this.grenadeState = 'equipping';
                this.grenadeTimer = now;
                this.sendAction({ type: InputActions.EquipItem, slot: slot });
                break;
            case 'equipping':
                if (now - this.grenadeTimer > 500) {
                    if (isCookable) {
                        this.grenadeState = 'cooking';
                    } else {
                        this.grenadeState = 'throwing';
                    }
                    this.grenadeTimer = now;
                }
                break;
            case 'cooking':
                // Aim
                const angle = this.calculateLeadAim(enemy);
                const inputPacket = InputPacket.create({
                    movement: { up: false, down: false, left: false, right: false },
                    attacking: true, // Cook
                    actions: [],
                    pingSeq: 0,
                    turning: true,
                    rotation: angle,
                    distanceToMouse: dist,
                    isMobile: false
                });
                this.sendPacket(inputPacket);

                if (now - this.grenadeTimer > 1500) { // Cook for 1.5s
                    this.grenadeState = 'throwing';
                }
                break;
            case 'throwing':
                 const angle2 = this.calculateLeadAim(enemy);
                 const inputPacket2 = InputPacket.create({
                    movement: { up: false, down: false, left: false, right: false },
                    attacking: true, // For non-cookable, attacking: true then false throws. For cookable, we were already attacking.
                    actions: [],
                    pingSeq: 0,
                    turning: true,
                    rotation: angle2,
                    distanceToMouse: dist,
                    isMobile: false
                });
                this.sendPacket(inputPacket2);
                
                // For non-cookable we might need to send a release packet in next frame, 
                // but here we just transition to recovering which stops attacking.
                this.grenadeState = 'recovering';
                this.grenadeTimer = now;
                break;
            case 'recovering':
                // Send a packet with attacking: false to ensure release
                const inputPacket3 = InputPacket.create({
                    movement: { up: false, down: false, left: false, right: false },
                    attacking: false, 
                    actions: [],
                    pingSeq: 0,
                    turning: true,
                    rotation: this.lastRotation,
                    distanceToMouse: 0,
                    isMobile: false
                });
                this.sendPacket(inputPacket3);

                if (now - this.grenadeTimer > 500) {
                    this.equipBestGun();
                    this.grenadeState = 'none';
                    return State.SUCCEEDED;
                }
                break;
        }
        return State.RUNNING;
    }

    private manageWeapon(dist: number): void {
        // Logic to switch weapons based on distance or ammo
        if (!this.inventory || !this.inventory.weapons) return;
        
        const currentWep = this.inventory.weapons[this.inventory.activeWeaponIndex];
        const isUsingMelee = this.inventory.activeWeaponIndex === 2;

        // 1. Close Range Melee Switch (approx 2~6 body lengths)
        // If dist < 10 units and we have a melee weapon, consider switching
        if (dist < 10) {
            const meleeWep = this.inventory.weapons[2];
            if (meleeWep && meleeWep.definition.idString !== 'fists' && !isUsingMelee) {
                let shouldSwitch = false;
                // Switch if gun is empty or distance is extremely close
                if (!currentWep || currentWep.definition.defType !== DefinitionType.Gun || (currentWep.count ?? 0) === 0) {
                    shouldSwitch = true;
                } else if (dist < 6) { // 3个身位左右，开始切刀/斧头
                    shouldSwitch = true;
                }

                if (shouldSwitch) {
                    console.log(`Switching to melee due to close range (${dist.toFixed(1)})`);
                    this.sendAction({ type: InputActions.EquipItem, slot: 2 });
                    return;
                }
            }
        }

        // 2. Switch back to gun if enemy is far away
        if (isUsingMelee && dist > 18) {
            const w0 = this.inventory.weapons[0];
            const w1 = this.inventory.weapons[1];
            if (w0 && w0.definition.defType === DefinitionType.Gun && (w0.count ?? 0) > 0) {
                this.sendAction({ type: InputActions.EquipItem, slot: 0 });
                return;
            } else if (w1 && w1.definition.defType === DefinitionType.Gun && (w1.count ?? 0) > 0) {
                this.sendAction({ type: InputActions.EquipItem, slot: 1 });
                return;
            }
        }

        // Simple logic: Close range (< 20) prefer shotgun/smg. Long range (> 40) prefer rifle/sniper.
        // Also check ammo.
        
        // TODO: Detailed weapon type checking requires definition analysis. 
        // For now, reload if empty.
        
        console.log("manageWeapon, activeWeaponIndex:", this.inventory.activeWeaponIndex);
        
        // If current weapon is a gun and empty
        if (currentWep && currentWep.definition.defType === DefinitionType.Gun && (currentWep.count ?? 0) === 0) {
             const ammoType = currentWep.definition.ammoType;
             const reserveAmmo = this.inventoryItems?.items?.[ammoType] || 0;
             
             if (reserveAmmo > 0) {
                 this.sendAction({ type: InputActions.Reload });
             } else {
                 // No ammo for current gun, try other gun
                 const otherSlot = (this.inventory.activeWeaponIndex + 1) % 2; 
                 const otherWep = this.inventory.weapons[otherSlot];
                 if (otherWep && otherWep.definition.defType === DefinitionType.Gun && (otherWep.count ?? 0) > 0) {
                     this.sendAction({ type: InputActions.EquipItem, slot: otherSlot });
                 } else {
                     // Both guns dry, switch to melee
                     if (this.inventory.activeWeaponIndex !== 2) {
                         this.sendAction({ type: InputActions.EquipItem, slot: 2 });
                     }
                 }
             }
        } else if (!currentWep || currentWep.definition.idString === 'fists') {
            // If we are holding fists, check if we have guns with ammo
            const w0 = this.inventory.weapons[0];
            const w1 = this.inventory.weapons[1];
            const w2 = this.inventory.weapons[2]; // Melee slot

            if (w0 && w0.definition.defType === DefinitionType.Gun && (w0.count ?? 0) > 0) {
                this.sendAction({ type: InputActions.EquipItem, slot: 0 });
            } else if (w1 && w1.definition.defType === DefinitionType.Gun && (w1.count ?? 0) > 0) {
                this.sendAction({ type: InputActions.EquipItem, slot: 1 });
            } else if (w2 && w2.definition.idString !== 'fists' && this.inventory.activeWeaponIndex !== 2) {
                // If we have a better melee weapon and aren't holding it, and have no guns with ammo
                this.sendAction({ type: InputActions.EquipItem, slot: 2 });
            }
        }
    }

    private equipBestGun(): void {
        // Equip slot 0 or 1
        this.sendAction({ type: InputActions.EquipItem, slot: 0 });
    }

    private calculateMeleeMovement(enemy: Player, dist: number): any {
        const now = Date.now();
        const dx = enemy.position.x - this.playerPosition.x;
        const dy = enemy.position.y - this.playerPosition.y;
        const angleToEnemy = Math.atan2(dy, dx);

        // Switch circling direction occasionally
        if (now - this.lastStrafeSwitch > 800 + Math.random() * 400) {
            this.strafeDirection *= -1;
            this.lastStrafeSwitch = now;
        }

        let moveAngle;

        if (dist > 4) {
            // Still a bit far, move in at an angle (diagonal approach)
            moveAngle = angleToEnemy + (Math.PI / 6 * this.strafeDirection);
        } else if (dist < 2.5) {
            // Too close! Back up slightly while circling
            moveAngle = angleToEnemy + (Math.PI * 0.8 * this.strafeDirection);
        } else {
            // Sweet spot: Circle the enemy
            moveAngle = angleToEnemy + (Math.PI / 2 * this.strafeDirection);
        }

        const moveX = Math.cos(moveAngle);
        const moveY = Math.sin(moveAngle);

        return {
            up: moveY < -0.4,
            down: moveY > 0.4,
            left: moveX < -0.4,
            right: moveX > 0.4
        };
    }

    private calculateCombatMovement(enemy: Player, dist: number): any {
        const now = Date.now();
        // Strafing logic
        if (now - this.lastStrafeSwitch > 1000 + Math.random() * 1000) {
            this.strafeDirection *= -1;
            this.lastStrafeSwitch = now;
        }

        const dx = enemy.position.x - this.playerPosition.x;
        const dy = enemy.position.y - this.playerPosition.y;
        const angleToEnemy = Math.atan2(dy, dx);
        
        // Move perpendicular (Strafe) + Move closer/away
        const strafeAngle = angleToEnemy + (Math.PI / 2 * this.strafeDirection);
        
        let moveAngle = strafeAngle;
        
        if (dist > 40) { // Too far, move in
            moveAngle = angleToEnemy + (Math.PI / 4 * this.strafeDirection); 
        } else if (dist < 15) { // Too close, back up
            moveAngle = angleToEnemy + (Math.PI * 0.8 * this.strafeDirection); // Backwards-ish
        }

        const moveX = Math.cos(moveAngle);
        const moveY = Math.sin(moveAngle);

        return {
            up: moveY < -0.5,
            down: moveY > 0.5,
            left: moveX < -0.5,
            right: moveX > 0.5
        };
    }

    private calculateLeadAim(enemy: Player): number {
        // Simple leading: Aim at pos + velocity * time
        // We don't have explicit velocity, so estimate from last pos
        let vx = 0, vy = 0;
        if (this.lastTargetPos) {
            vx = enemy.position.x - this.lastTargetPos.x;
            vy = enemy.position.y - this.lastTargetPos.y;
        }
        this.lastTargetPos = { ...enemy.position };

        // Prediction factor (ping + bullet time approx)
        const factor = 5; 
        
        const targetX = enemy.position.x + vx * factor;
        const targetY = enemy.position.y + vy * factor;

        return Math.atan2(targetY - this.playerPosition.y, targetX - this.playerPosition.x);
    }
    
    private getMovementInput(): { up: boolean, down: boolean, left: boolean, right: boolean } {
        if (this.isForceStop || !this.targetPosition) {
            return { up: false, down: false, left: false, right: false };
        }

        const dx = this.targetPosition.x - this.playerPosition.x;
        const dy = this.targetPosition.y - this.playerPosition.y;
        
        const movement = {
            up: false,
            down: false,
            left: false,
            right: false
        };
        
        if (Math.abs(dx) > 1.0) {
            movement.left = dx < 0;
            movement.right = dx > 0;
        }
        if (Math.abs(dy) > 1.0) {
             movement.up = dy < 0;
             movement.down = dy > 0;
        }

        this.constrainMovement(movement);
        return movement;
    }
    
    private sendAction(action: any): void {
        const movement = this.getMovementInput();
        let rotation = this.lastRotation;
        let dist = 100;

        if (this.targetPosition) {
            const dx = this.targetPosition.x - this.playerPosition.x;
            const dy = this.targetPosition.y - this.playerPosition.y;
            rotation = Math.atan2(dy, dx);
            dist = Math.sqrt(dx * dx + dy * dy);
            this.lastRotation = rotation;
        }

        const inputPacket = InputPacket.create({
            movement,
            attacking: this.isAttacking,
            actions: [action],
            pingSeq: 0,
            turning: true,
            rotation: rotation,
            distanceToMouse: dist,
            isMobile: false
        });
        this.sendPacket(inputPacket);
    }

    // --- End New Methods ---
    public connect(): void {
        console.log(`Connecting to server at ${this.serverAddress}`);
        if (this.gameStarted) return;

        this._socket = new WebSocket(this.serverAddress);
        this._socket.binaryType = "arraybuffer";

        this._socket.onopen = (): void => {
            console.log('Connected to server');
            this.connecting = false;
            this.gameStarted = false;   //here must be false!
            this.gameOver = false;
            this.playerDied = false;
            
            // Send join packet immediately after connection
            this.sendJoinPacket();
        };

        this._socket.onmessage = (message: MessageEvent<ArrayBuffer>): void => {
            this.handleMessage(message.data);
        };

        this._socket.onclose = (): void => {
            console.log('Disconnected from server');
            this.connecting = false;
            this.gameStarted = false;
            process.exit(0);
        };

        this._socket.onerror = (error): void => {
            console.error('WebSocket error:', error);
            process.exit(1);
        };
    }

    private handleMessage(data: ArrayBuffer): void {
        try {
            const stream = new PacketStream(data);
            let iterationCount = 0;
            const splits: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];
            while (true) {
                if (++iterationCount === 1e3) {
                    console.warn("1000 iterations of packet reading; possible infinite loop");
                }
                const packet = stream.deserialize(splits);
                if (packet === undefined) break;
                this.onPacket(packet);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    private onPacket(packet: PacketDataOut): void {
        switch (packet.type) {
            case PacketType.Joined:
                this.handleJoinedPacket(packet as JoinedData);
                break;
            case PacketType.Map:
                this.handleMapPacket(packet as MapData);
                break;
            case PacketType.Update:
                this.handleUpdatePacket(packet as UpdateDataOut);
                break;
            case PacketType.GameOver:
                this.handleGameOverPacket(packet as GameOverData);
                break;
            case PacketType.Kill:
                this.handleKillPacket(packet as KillData);
                break;
        }
    }

    private handleJoinedPacket(packet: JoinedData): void {
        console.log('Joined game successfully');
        this.gameStarted = true;
        this.gameMap = {
            width: 1924, // Updated for Hunted map size
            height: 1924
        };
        // Set initial position to center of map
        this.playerPosition = {
            x: this.gameMap.width / 2,
            y: this.gameMap.height / 2
        };
    }

    private handleUpdatePacket(updateData: UpdateDataOut): void {
        const now = Date.now();
        this._serverDt = now - this._lastUpdateTime;
        this._lastUpdateTime = now;
    
        const playerData = updateData.playerData;
        if (playerData) {
            //if (this.spectating && playerData.teamID !== undefined && playerData.id !== undefined) {
            if (playerData.teamID !== undefined) {
                this.teamID = playerData.teamID;
            }

            // Update current player ID and weapon if available
            if (playerData.id !== undefined) {
                this.playerId = playerData.id.id;
                this.activePlayerID = playerData.id.id;
            }

            if (playerData.health !== undefined) {
                this.playerHealth = playerData.health * 100;
            }
            if (playerData.adrenaline !== undefined) {
                this.playerAdrenaline = playerData.adrenaline * 100;
            }
            
            // Update current weapon if player data contains active item info
            if (playerData.inventory) {
                // Initialize inventory if null
                if (!this.inventory) {
                    this.inventory = {
                        activeWeaponIndex: 0,
                        weapons: [undefined, undefined, undefined, undefined]
                    };
                }

                // Update Active Index
                this.inventory.activeWeaponIndex = playerData.inventory.activeWeaponIndex;

                if (playerData.inventory.weapons) {
                    for (let i = 0; i < 4; i++) {
                        const newWep = playerData.inventory.weapons[i];
                        const oldWep = this.inventory.weapons[i];
                        
                        // Detect Drop: Old existed, New is different or empty
                        if (oldWep && oldWep.definition.idString !== 'fists') {
                            // If newWep is undefined, it means slot is now EMPTY (dropped).
                            // If newWep is defined but ID is different, it means SWAPPED.
                            if (!newWep || newWep.definition.idString !== oldWep.definition.idString) {
                                console.log(`Detected weapon drop/swap: ${oldWep.definition.idString} -> ${newWep ? newWep.definition.idString : 'Empty'}`);
                                this.droppedItems.push({
                                    weaponId: oldWep.definition.idString,
                                    position: { ...this.playerPosition },
                                    timestamp: now
                                });
                            }
                        }
                        
                        // Update local inventory (Full Overwrite)
                        this.inventory.weapons[i] = newWep;
                    }
                }
                
                // Update helpers
                const weaponUsing = this.inventory.weapons[this.inventory.activeWeaponIndex];
                if (weaponUsing) {
                    this.currentWeapon = weaponUsing.definition.idString;
                    this.hasWeapon = this.currentWeapon !== "fists";
                } else {
                    this.currentWeapon = null;
                    this.hasWeapon = false; 
                }
            } else {
               // No inventory data in this packet, keep old state
            }

            if (playerData.items) {
                this.inventoryItems = playerData.items;
            }
        }

        for (const { id, type, data } of updateData.fullDirtyObjects ?? []) {
            const object: GameObject | undefined = this.objects.get(id);

            if (object === undefined || object.destroyed) {
                type K = typeof type;

                const _object = new (
                    ObjectClassMapping[type] as new (id: number, data: ObjectsNetData[K]) => InstanceType<ObjectClassMapping[K]>
                )(id, data);
                this.objects.add(_object);
            } else {
                object.updateFromData(data, false);
            }
            
            // Check if this is our player and update weapon info
            if (type === ObjectCategory.Player && this.playerId !== null && id === this.playerId) {
                const player = this.objects.get(id) as Player;
                if (player) {
                    this.currentWeapon = player.activeItem.idString;
                    this.hasWeapon = player.activeItem.idString !== "fists";
                }
            }
        }

        for (const { id, data } of updateData.partialDirtyObjects ?? []) {
            const object = this.objects.get(id);
            if (object === undefined) {
                console.warn(`Trying to partially update non-existant object with ID ${id}`);
                continue;
            }

            (object as GameObject).updateFromData(data, false);
        }

        for (const id of updateData.deletedObjects ?? []) {
            const object = this.objects.get(id);
            if (object === undefined) {
                console.warn(`Trying to delete unknown object with ID ${id}`);
                continue;
            }

            object.destroy();
            this.objects.delete(object);
        }

        GasManager.updateFrom(updateData);

        // Update alive count
        if (updateData.aliveCount !== undefined) {
            this.aliveCount = updateData.aliveCount;
        }

        const player = this.activePlayer;
        if (!player) return;
        this.playerPosition = player.position;
        //console.log("agent position updated: ", player.position);
    }

    private handleGameOverPacket(packet: GameOverData): void {
        console.log(`Game over. Rank: ${packet.rank}`);
        this.gameOver = true;
        this.isWinner = packet.rank === 1;
        this.gameStarted = false;
    }

    private handleKillPacket(packet: KillData): void {
        // Check if this AI player was killed
        if (packet.victimId === this.playerId) {
            console.log('Player was killed');
            this.playerDied = true;
            this.playerAlive = false;
        }
    }

    private handleMapPacket(packet: MapData): void {
        // Update map data using our MapManager
        MapManager.updateFromPacket(packet);
        
        // Update our game map dimensions
        if (this.gameMap) {
            this.gameMap.width = packet.width;
            this.gameMap.height = packet.height;
        } else {
            this.gameMap = {
                width: packet.width,
                height: packet.height
            };
        }
    }

    // Behavior Tree Functions
    public IsGameStarted(): boolean {
        return this.gameStarted;
    }

    public IsGameOver(): boolean {
        return this.gameOver;
    }

    public IsPlayerDead(): boolean {
        return this.playerDied;
    }

    private sendJoinPacket(): void {
        if (this._socket?.readyState === WebSocket.OPEN) {
            try {
                // Create a proper join packet using the common library
                const joinPacket: PacketDataIn = JoinPacket.create({
                    isMobile: false,
                    isAgent: true,
                    name: this.playerName,
                    boost: 1,
                    basicEntryFeePerRound: 0.5,
                    skin: Skins.fromStringSafe(GameConstants.player.defaultSkin) || Skins.definitions[0],
                    badge: Badges.fromStringSafe("bdg_suroi_logo"),
                    emotes: [
                        Emotes.fromStringSafe("happy_face"),
                        Emotes.fromStringSafe("thumbs_up"),
                        Emotes.fromStringSafe("wave"),
                        Emotes.fromStringSafe("suroi_logo"),
                        Emotes.fromStringSafe("fire"),
                        Emotes.fromStringSafe("gg"),
                        Emotes.fromStringSafe("troll_face"),
                        Emotes.fromStringSafe("skull")
                    ],
                    accessToken: this.apiKey ?? ""
                });

                this.sendPacket(joinPacket);
                console.log('Join packet sent');
            } catch (error) {
                console.error('Error sending join packet:', error);
            }
        }
    }

    public HandleGameOver(): State {
        console.log(`Game over. AI player rank: ${this.isWinner ? '1 (Winner!)' : 'Not winner'}`);
        
        // Reset game state
        this.gameOver = false;
        this.gameStarted = false;
        this.playerDied = false;
        
        // If AI won, restart immediately
        if (this.isWinner) {
            console.log('AI won the game! Restarting...');
            //setTimeout(() => { this.connect(); }, 3000); // Wait 3 seconds before rejoining
        } else {
            // If AI didn't win, wait a bit then rejoin
            console.log('AI did not win. Rejoining new game...');
            //setTimeout(() => { this.connect(); }, 5000); // Wait 5 seconds before rejoining
        }
        
        return State.SUCCEEDED;
    }

    public HandlePlayerDeath(): State {
        console.log('Handling player death');
        
        // Reset player state
        this.playerDied = false;
        this.gameStarted = false;

        return State.SUCCEEDED;
    }

    public UpdateMovement(): void {
        const movement = this.getMovementInput();
        let rotation = this.lastRotation;
        let dist = 100;

        if (this.targetPosition) {
            const dx = this.targetPosition.x - this.playerPosition.x;
            const dy = this.targetPosition.y - this.playerPosition.y;
            rotation = Math.atan2(dy, dx);
            dist = Math.sqrt(dx * dx + dy * dy);
            
            // Add some randomness to rotation occasionally
            rotation += (Math.random() - 0.5) * 0.1;
            this.lastRotation = rotation;
        }

        const inputPacket: PacketDataIn = InputPacket.create({
                    movement,
                    attacking: this.isAttacking,
                    actions: [],
                    pingSeq: 0,
                    turning: true,
                    rotation: rotation,
                    distanceToMouse: dist,
                    isMobile: false
                });
        this.sendPacket(inputPacket);

        const now = Date.now();
        if (now - this.lastInputTime >= this.inputInterval) {
            this.lastInputTime = now;
        }
    }

    private constrainMovement(movement: { up: boolean, down: boolean, left: boolean, right: boolean }): void {
        if (!this.gameMap || !this.playerPosition) return;

        // Calculate margin as 5% of map dimensions (approx 96.2 for 1924 map)
        const marginX = this.gameMap.width * 0.05;
        const marginY = this.gameMap.height * 0.05;
        let corrected = false;

        // X-axis boundary control
        if (this.playerPosition.x < marginX) {
            movement.left = false;
            movement.right = true; // Force move towards center
            corrected = true;
        } else if (this.playerPosition.x > this.gameMap.width - marginX) {
            movement.right = false;
            movement.left = true; // Force move towards center
            corrected = true;
        }

        // Y-axis boundary control
        if (this.playerPosition.y < marginY) {
            movement.up = false;
            movement.down = true; // Force move towards center
            corrected = true;
        } else if (this.playerPosition.y > this.gameMap.height - marginY) {
            movement.down = false;
            movement.up = true; // Force move towards center
            corrected = true;
        }

        // If we hit a wall, reset target to center to stop AI from trying to go back to the wall
        if (corrected) {
            this.targetPosition = {
                x: this.gameMap.width / 2,
                y: this.gameMap.height / 2
            };
        }
    }

    private ensureWanderTarget(): void {
        if (!this.gameMap || !this.playerPosition) return;

        const now = Date.now();
        // Cleanup old breadcrumbs (> 2 minutes)
        this.visitedPositions = this.visitedPositions.filter(p => now - p.time < 120000);

        // Check if we reached the target or don't have one
        let needsNewTarget = !this.targetPosition;
        
        if (this.targetPosition) {
            const dist = Geometry.distance(this.playerPosition, this.targetPosition);
            
            // 1. Reached target
            if (dist < 12) { 
                 needsNewTarget = true; 
                 this.visitedPositions.push({ pos: { ...this.playerPosition }, time: now });
                 if (this.visitedPositions.length > 15) this.visitedPositions.shift();
            }
            
            // 2. Timeout: Stuck or taking too long (15 seconds)
            if (now - this.lastTargetSetTime > 15000) {
                console.log("Wander target timeout, picking new one.");
                needsNewTarget = true;
            }
        }
        
        if (needsNewTarget) {
            this.targetPosition = this.findSmartWanderTarget();
            this.lastTargetSetTime = now;
            console.log("New wander target set:", this.targetPosition);
        }
    }

    private getCurrentQuadrantBounds(): { minX: number, maxX: number, minY: number, maxY: number } {
        if (!this.gameMap) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        const midX = this.gameMap.width / 2;
        const midY = this.gameMap.height / 2;
        
        const isRight = this.playerPosition.x >= midX;
        const isBottom = this.playerPosition.y >= midY;
        
        return {
            minX: isRight ? midX : 0,
            maxX: isRight ? this.gameMap.width : midX,
            minY: isBottom ? midY : 0,
            maxY: isBottom ? this.gameMap.height : midY
        };
    }

    private findSmartWanderTarget(): Vector {
        const candidates: Vector[] = [];
        const candidateCount = 15;
        const margin = this.gameMap!.width * 0.05;

        // Determine bounds based on Gas
        let safeCenter = { x: this.gameMap!.width / 2, y: this.gameMap!.height / 2 };
        let safeRadius = this.gameMap!.width; 
        
        if (GasManager.position && typeof GasManager.radius === 'number' && GasManager.state !== 0) {
            safeCenter = GasManager.position;
            safeRadius = GasManager.radius;
        }

        const quadrant = this.getCurrentQuadrantBounds();

        // Generate Candidates
        for (let i = 0; i < candidateCount; i++) {
             let cx, cy;
             
             // 70% chance to stay in quadrant, 30% chance to go anywhere safe
             if (Math.random() < 0.7) {
                 cx = quadrant.minX + Math.random() * (quadrant.maxX - quadrant.minX);
                 cy = quadrant.minY + Math.random() * (quadrant.maxY - quadrant.minY);
             } else {
                 const r = Math.random() * safeRadius * 0.8;
                 const theta = Math.random() * Math.PI * 2;
                 cx = safeCenter.x + r * Math.cos(theta);
                 cy = safeCenter.y + r * Math.sin(theta);
             }
             
             // Safety check
             if (Geometry.distance({ x: cx, y: cy }, safeCenter) > safeRadius * 0.9) {
                 const r = Math.random() * safeRadius * 0.5;
                 const theta = Math.random() * Math.PI * 2;
                 cx = safeCenter.x + r * Math.cos(theta);
                 cy = safeCenter.y + r * Math.sin(theta);
             }

             cx = Math.max(margin, Math.min(cx, this.gameMap!.width - margin));
             cy = Math.max(margin, Math.min(cy, this.gameMap!.height - margin));
             candidates.push({ x: cx, y: cy });
        }

        let bestScore = -Infinity;
        let bestPos = candidates[0];

        for (const pos of candidates) {
             let score = 0;
             const distFromMe = Geometry.distance(this.playerPosition, pos);
             
             // Prefer moves that aren't too short but not impossibly long
             if (distFromMe < 30) score -= 2000;
             else score += Math.min(distFromMe, 500); 

             // Repulsion from breadcrumbs
             let minVisitDist = Infinity;
             for (const visit of this.visitedPositions) {
                 const d = Geometry.distance(pos, visit.pos);
                 if (d < minVisitDist) minVisitDist = d;
             }
             
             if (minVisitDist < 60) score -= 3000;
             else if (minVisitDist < 120) score -= 1000;

             if (score > bestScore) {
                 bestScore = score;
                 bestPos = pos;
             }
        }
        return bestPos;
    }

    private sendPacket(packet: PacketDataIn): void {
        if (this._socket?.readyState === WebSocket.OPEN) {
            try {
                const stream = new PacketStream(new ArrayBuffer(1024));
                stream.stream.index = 0;
                stream.serialize(packet);
                const buffer = stream.getBuffer();
                this._socket.send(buffer);
            } catch (error) {
                console.error('Error sending packet:', error);
            }
        }
    }

    private isLocationDeadLock(): boolean {
        const now = Date.now();

        // If we are healing, we are intentionally stationary.
        // Update the timer and position to prevent false deadlock detection.
        if (this.healingState !== 'none') {
            this.lastCheckPosition = { ...this.playerPosition };
            this.lastCheckPositionTime = now;
            return false;
        }

        if (!this.lastCheckPosition) {
            this.lastCheckPosition = { ...this.playerPosition };
            this.lastCheckPositionTime = now;
            return false;
        }

        const dist = Geometry.distance(this.playerPosition, this.lastCheckPosition);

        if (dist > 2.0) {
            // We moved! Reset.
            this.lastCheckPosition = { ...this.playerPosition };
            this.lastCheckPositionTime = now;
            return false;
        }

        // We haven't moved far since lastCheckPositionTime
        if (now - this.lastCheckPositionTime > 10000) {
            // Stuck for 10 seconds
            console.warn(`Deadlock detected! Stuck at ${this.playerPosition.x.toFixed(1)},${this.playerPosition.y.toFixed(1)} for 5s.`);
            this.lastCheckPositionTime = now; // Reset to avoid spamming
            this.lastCheckPosition = { ...this.playerPosition }; // Reset position anchor
            return true;
        }

        return false;
    }
}
