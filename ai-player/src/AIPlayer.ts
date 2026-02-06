import * as fs from 'fs';
import * as path from 'path';
import { State } from './mistreevous';
import { InputActions, PlayerActions } from "@common/constants";
import { PacketDataIn } from "@common/packets/packet";
import { InputPacket } from "@common/packets/inputPacket";
import { type Vector } from "@common/utils/vector";
import { Geometry } from "@common/utils/math";
import { GasManager } from "./gasManager";
import { ObjectPool } from "@common/utils/objectPool";
import { Player } from "./objects/player";
import { Building } from "./objects/building";
import { DefinitionType } from "@common/utils/objectDefinitions";
import { delay } from "./utility";
import { LootManager } from "./managers/LootManager";
import { NetworkManager } from "./managers/NetworkManager";
import { CombatManager } from "./managers/CombatManager";
import { DesireManager } from "./managers/DesireManager";
import { Desire, ObjectMapping } from "./typed";
import { MIN_GOLD_FOR_EVACUATION } from "./constant";
import { ObjectCategory } from "@common/constants";

export class AIPlayer {
    public playerName: string;
    public serverAddress: string;
    public gameStarted = false;
    public gameOver = false;
    public playerDied = false;
    public isWinner = false;
    private lastInputTime = 0;
    private inputInterval = 150; // Send input every 150ms to mimic human players
    private lastActionTime = 0;
    private actionInterval = 1000; // Perform actions every 1000ms on average
    public playerPosition: Vector = { x: 0, y: 0 };
    public gameMap: { width: number; height: number } | null = null;
    public playerId: number | null = null;
    public playerHealth: number = 100;
    public playerAlive: boolean = true;
    public lastRotation: number = 0;
    public targetPosition: Vector | null = null;
    public aliveCount: number = 0;
    private emoteInterval: number = 10000; // Send emote every 10 seconds on average
    private lastReloadTime: number = 0;
    private reloadInterval: number = 15000; // Reload every 15 seconds on average
    private isAttacking: boolean = false;
    private attackStartTime: number = 0;
    private attackDuration: number = 0;
    public hasWeapon: boolean = false;
    public currentWeapon: string | null = null;
    public inventory: any = null; // Store the player's inventory data
    public inventoryItems: any = null; // Store the player's items (ammo, meds, etc)
    private lastWeaponCheck: number = 0;
    private weaponCheckInterval: number = 2000; // Check for better weapons every 2 seconds
    public isForceStop: boolean = false; // New: prevents movement during critical actions like looting
    private configPath: string | undefined;

    public lootedItems: Map<number, number> = new Map();
    public droppedItems: { weaponId: string, position: Vector, timestamp: number }[] = [];
    public ignoredLootZones: { position: Vector, radius: number, expiry: number }[] = [];
    public explicitTargetId: number | null = null;
    private postDropCooldownUntil = 0;
    private lastTargetSetTime: number = 0;

    // Network Sync for Movement
    public lastMoveTimestamp: number = 0;
    public lastPlayerPositionUpdateTs: number = 0;
    public lastInputWasEmpty: boolean = false;
    public lastInteractLootTimestamp: number | undefined;

    // Stuck Detection
    private lastPosition: Vector | null = null;
    private lastPositionCheckTime: number = 0;

    // Desire System
    public desires: Desire[] = [];

    activePlayerID = -1;
    public playerAdrenaline = 0;
    teamID = -1;

    isTeamMode = false;
    public apiKey: string | null = null;
    readonly objects = new ObjectPool<ObjectMapping>();
    public lootManager: LootManager;
    public networkManager: NetworkManager;
    public combatManager: CombatManager;
    public desireManager: DesireManager;

    get activePlayer(): Player | undefined {
        return this.objects.get(this.activePlayerID) as Player;
    }

    get playerInventory(): any {
        return this.inventory;
    }

    public getGoldCount(): number {
        return this.inventoryItems?.items?.["gold"] || 0;
    }

    private _lastUpdateTime = 0;
    get lastUpdateTime(): number { return this._lastUpdateTime; }
    public setLastUpdateTime(value: number): void { this._lastUpdateTime = value; }

    /**
     * Otherwise known as "time since last update", in milliseconds
     */
    private _serverDt = 0;
    /**
     * Otherwise known as "time since last update", in milliseconds
     */
    get serverDt(): number { return this._serverDt; }
    public setServerDt(value: number): void { this._serverDt = value; }

    public lastServerTime: number | undefined;

    public get serverTime(): number {
        if (this.lastServerTime === undefined) return Date.now();
        return this.lastServerTime + (Date.now() - this.lastUpdateTime);
    }

    // Index signature to satisfy the Agent interface
    [propertyName: string]: any;

    constructor(serverAddress: string, playerName: string = "AI_Player", configPath?: string) {
        this.serverAddress = serverAddress;
        this.playerName = playerName;
        this.configPath = configPath;
        this.lootManager = new LootManager(this);
        this.networkManager = new NetworkManager(this);
        this.combatManager = new CombatManager(this);
        this.desireManager = new DesireManager(this);
    }

    // --- State Variables ---
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
            : path.resolve(process.cwd(), 'data/config.json');

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

        this.networkManager.connect(this.serverAddress);
        await this.runGameLoop();
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
            this.desireManager.evaluateDesires();

            // 2. Process the highest priority desire
            if (this.desires.length > 0) {
                await this.desireManager.processDesires();
            } else {
                // Idle / Wander if no desires
                // Ensure we aren't force stopped from a previous action
                this.isForceStop = false;
                this.ensureWanderTarget();
                this.UpdateMovement();
            }

            await delay(50);
        }
    }

    // Combat Manager Delegations
    public InCombat(): boolean {
        return this.combatManager.InCombat();
    }

    public CanReviveTeammate(): boolean {
        return this.combatManager.CanReviveTeammate();
    }

    public ReviveTeammate(): State {
        return this.combatManager.ReviveTeammate();
    }

    public PerformHealing(): State {
        return this.combatManager.PerformHealing();
    }

    public TacticalCombat(): State {
        return this.combatManager.TacticalCombat();
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
    
    public sendAction(action: any): void {
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

    public HandleGameOver(): State {
        console.log(`Game over. AI player rank: ${this.isWinner ? '1 (Winner!)' : 'Not winner'}`);
        
        // Reset game state
        this.gameOver = false;
        this.gameStarted = false;
        this.playerDied = false;
        
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

    public constrainMovement(movement: { up: boolean, down: boolean, left: boolean, right: boolean }): void {
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

    public ensureWanderTarget(): void {
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

             // Repulsion from winner gate if gold is low
             if (this.getGoldCount() < MIN_GOLD_FOR_EVACUATION) {
                for (const obj of this.objects) {
                    if (obj.type === ObjectCategory.Building) {
                        const b = obj as Building;
                        if (b.definition.idString === "winner_gate") {
                            const d = Geometry.distance(pos, b.position);
                            if (d < 40) score -= 5000;
                        }
                    }
                }
             }

             if (score > bestScore) {
                 bestScore = score;
                 bestPos = pos;
             }
        }
        return bestPos;
    }

    public isInSafeZone(point: Vector): boolean {
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

    // --- End New Methods ---
    public sendPacket(packet: PacketDataIn): void {
        if (packet.type === 2) { // PacketType.Input
            const data = packet as any;
            const isMoving = data.movement && (data.movement.up || data.movement.down || data.movement.left || data.movement.right);
            const hasActions = data.actions && data.actions.length > 0;
            const isEmpty = !isMoving && !hasActions && !data.attacking;

            if (isEmpty) {
                if (this.lastInputWasEmpty) {
                    return; // Skip redundant empty packet
                }
                this.lastInputWasEmpty = true;
            } else {
                this.lastInputWasEmpty = false;
            }

            if (isMoving) {
                this.lastMoveTimestamp = this.serverTime;
            }
        }
        this.networkManager.sendPacket(packet);
    }

    private isLocationDeadLock(): boolean {
        const now = Date.now();

        // If we are healing, we are intentionally stationary.
        // Update the timer and position to prevent false deadlock detection.
        if (this.combatManager.healingState !== 'none') {
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
