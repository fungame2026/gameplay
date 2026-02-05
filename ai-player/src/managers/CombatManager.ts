import { AIPlayer } from "../AIPlayer";
import { State } from "../mistreevous";
import { Player } from "../objects/player";
import { Geometry } from "@common/utils/math";
import { Vector } from "@common/utils/vector";
import { InputActions, PlayerActions } from "@common/constants";
import { InputPacket } from "@common/packets/inputPacket";
import { DefinitionType } from "@common/utils/objectDefinitions";
import { Desire } from "../typed";
import { GasManager } from "../gasManager";

export class CombatManager {
    private grenadeState: 'none' | 'equipping' | 'cooking' | 'throwing' | 'recovering' = 'none';
    private grenadeTimer: number = 0;
    private _healingState: 'none' | 'equipping' | 'using' | 'recovering' = 'none';
    private healingTimer: number = 0;
    private strafeDirection: number = 1;
    private lastStrafeSwitch: number = 0;
    private lastTargetPos: Vector | null = null; // For velocity calculation

    constructor(private ai: AIPlayer) {}

    get healingState(): string {
        return this._healingState;
    }

    public InCombat(): boolean {
        // Check if enemies are nearby
        const enemy = this.findClosestEnemy();
        return enemy !== null && Geometry.distance(this.ai.playerPosition, enemy.position) < 80; // 80 units combat range
    }

    public async handleKillEnemy(desire: Desire): Promise<void> {
        this.ai.isForceStop = false;
        // Reuse TacticalCombat logic but directed at specific target
        // We need to set target for movement
        this.ai.targetPosition = desire.targetPosition; 
        
        // TacticalCombat finds closest enemy. We should ensure it targets OUR desire enemy.
        // For now, calling TacticalCombat is acceptable as it likely targets the same enemy.
        this.TacticalCombat();
    }

    public ReviveTeammate(): State {
        const teammate = this.findDownedTeammate();
        if (!teammate) return State.FAILED;

        const dist = Geometry.distance(this.ai.playerPosition, teammate.position);
        const angle = Math.atan2(teammate.position.y - this.ai.playerPosition.y, teammate.position.x - this.ai.playerPosition.x);

        if (dist < 3) {
            // Interact to revive if teammate is the closest interactable
            let actions = [];
            const closest = this.ai.lootManager.getClosestInteractable();
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
            this.ai.sendPacket(inputPacket);
        } else {
            // Move to teammate
             const movement = {
                up: Math.abs(teammate.position.y - this.ai.playerPosition.y) > 2.0 && (teammate.position.y < this.ai.playerPosition.y),
                down: Math.abs(teammate.position.y - this.ai.playerPosition.y) > 2.0 && (teammate.position.y > this.ai.playerPosition.y),
                left: Math.abs(teammate.position.x - this.ai.playerPosition.x) > 2.0 && (teammate.position.x < this.ai.playerPosition.x),
                right: Math.abs(teammate.position.x - this.ai.playerPosition.x) > 2.0 && (teammate.position.x > this.ai.playerPosition.x)
            };
            this.ai.constrainMovement(movement);
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
            this.ai.sendPacket(inputPacket);
        }
        return State.SUCCEEDED;
    }

    public PerformHealing(): State {
        const now = Date.now();
        // Prefer booster if health is decent (>50) and adrenaline is not high (<80)
        const preferBooster = this.ai.playerHealth > 50 && this.ai.playerAdrenaline < 80;
        const bestMeds = this.ai.lootManager.getBestMedicalItem(false, preferBooster);
        
        if (!bestMeds) {
            this._healingState = 'none';
            return State.FAILED;
        }

        const player = this.ai.activePlayer;
        if (!player) return State.FAILED;

        // State Machine for Healing
        switch (this._healingState) {
            case 'none':
                // Start using the item
                this._healingState = 'using';
                this.healingTimer = now;
                this.ai.sendAction({ type: InputActions.UseItem, item: bestMeds.def });
                break;
                
            case 'using':
                // Check if the action is finished on the server
                if (player.action.type === PlayerActions.None) {
                    this._healingState = 'none';
                    return State.SUCCEEDED;
                }

                // Timeout safety (max 10 seconds for medikit)
                if (now - this.healingTimer > 10000) {
                    this._healingState = 'none';
                    return State.FAILED;
                }

                // Allow Movement
                const enemy = this.findClosestEnemy();
                let movement = { up: false, down: false, left: false, right: false };
                let rotation = 0;
                let distToMouse = 10;

                if (enemy) {
                    const dist = Geometry.distance(this.ai.playerPosition, enemy.position);
                    rotation = Math.atan2(enemy.position.y - this.ai.playerPosition.y, enemy.position.x - this.ai.playerPosition.x);
                    distToMouse = dist;
                    // Use combat movement logic
                    if (this.ai.playerHealth < 40) {
                        movement = this.calculateRetreatMovement(enemy);
                    } else {
                        movement = this.calculateCombatMovement(enemy, dist);
                    }
                } else {
                    // Non-combat movement: Follow other desires (e.g. SafeZone) or Wander
                    const moveDesire = this.ai.desires.find(d => d.type === 'avoidGas' || d.type === 'moveToLocation');
                    if (moveDesire) {
                        const dx = moveDesire.targetPosition.x - this.ai.playerPosition.x;
                        const dy = moveDesire.targetPosition.y - this.ai.playerPosition.y;
                        rotation = Math.atan2(dy, dx);
                        movement = {
                            up: Math.abs(dy) > 2.0 && dy < 0,
                            down: Math.abs(dy) > 2.0 && dy > 0,
                            left: Math.abs(dx) > 2.0 && dx < 0,
                            right: Math.abs(dx) > 2.0 && dx > 0
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

                this.ai.constrainMovement(movement);

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
                this.ai.sendPacket(inputPacket);
                break;

            case 'equipping':
            case 'recovering':
                 this._healingState = 'none';
                 return State.SUCCEEDED;
        }

        return State.RUNNING;
    }

    public TacticalCombat(): State {
        const enemy = this.findClosestEnemy();
        if (!enemy) return State.FAILED;

        const dist = Geometry.distance(this.ai.playerPosition, enemy.position);
        
        // 1. Grenade Logic
        if (this.grenadeState !== 'none' || this.shouldThrowGrenade(dist)) {
            return this.performGrenadeThrow(enemy, dist);
        }

        // 2. Weapon Logic
        this.manageWeapon(dist);

        // 3. Movement (Strafing or Retreating)
        const isUsingMelee = this.ai.inventory?.activeWeaponIndex === 2;
        const currentWep = this.ai.inventory?.weapons[this.ai.inventory.activeWeaponIndex];
        const hasAmmoInCurrentWep = currentWep && currentWep.definition.defType === DefinitionType.Gun && (currentWep.count ?? 0) > 0;
        const hasAnyAmmo = this.hasAnyAmmoInClip();
        
        let move;
        if (this.ai.playerHealth < 40) {
            move = this.calculateRetreatMovement(enemy);
        } else if (isUsingMelee) {
            // Aggressively move towards enemy for melee
            move = this.calculateMeleeMovement(enemy, dist);
        } else if (hasAmmoInCurrentWep || hasAnyAmmo) {
            move = this.calculateCombatMovement(enemy, dist);
        } else {
            move = this.calculateRetreatMovement(enemy);
        }
        this.ai.constrainMovement(move);

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
        this.ai.sendPacket(inputPacket);

        return State.SUCCEEDED;
    }

    public findClosestEnemy(): Player | null {
        let closest: Player | null = null;
        let minDst = Infinity;
        for (const obj of this.ai.objects) {
            if (obj instanceof Player && obj.id !== this.ai.playerId && !obj.dead) {
                if (obj.teamID == undefined) {
                    //observe
                    continue;
                }
                 if (this.ai.teamID !== -1 && obj.teamID === this.ai.teamID) continue;
                 
                 // Ignore enemies inside the gas (don't chase them to death)
                 if (!this.ai.isInSafeZone(obj.position)) continue;

                 const d = Geometry.distance(this.ai.playerPosition, obj.position);
                 if (d < minDst) { minDst = d; closest = obj; }
            }
        }
        return closest;
    }

    public findDownedTeammate(): Player | null {
        for (const obj of this.ai.objects) {
            if (obj instanceof Player && obj.id !== this.ai.playerId && obj.teamID === this.ai.teamID && obj.dead) {
                return obj;
            }
        }
        return null;
    }

    private hasAnyAmmoInClip(): boolean {
        if (!this.ai.inventory?.weapons) return false;
        for (let i = 0; i < 2; i++) {
            const w = this.ai.inventory.weapons[i];
            if (w && w.definition.defType === DefinitionType.Gun && w.definition.idString !== 'fists') {
                if ((w.count ?? 0) > 0) return true;
            }
        }
        return false;
    }

    public shouldThrowGrenade(dist: number): boolean {
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
         if (this.ai.inventory && this.ai.inventory.weapons) {
            for (let i = 0; i < this.ai.inventory.weapons.length; i++) {
                const w = this.ai.inventory.weapons[i];
                if (w && w.definition && w.definition.defType === DefinitionType.Throwable) {
                    return i;
                }
            }
        }
        return -1;
    }

    public performGrenadeThrow(enemy: Player, dist: number): State {
        const now = Date.now();
        const slot = this.getGrenadeSlot();
        
        if (slot === -1) {
             this.grenadeState = 'none';
             return State.FAILED;
        }

        const throwable = this.ai.inventory.weapons[slot];
        const isCookable = throwable?.definition?.cookable;

        switch (this.grenadeState) {
            case 'none':
                this.grenadeState = 'equipping';
                this.grenadeTimer = now;
                this.ai.sendAction({ type: InputActions.EquipItem, slot: slot });
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
                this.ai.sendPacket(inputPacket);

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
                this.ai.sendPacket(inputPacket2);
                
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
                    rotation: this.ai.lastRotation,
                    distanceToMouse: 0,
                    isMobile: false
                });
                this.ai.sendPacket(inputPacket3);

                if (now - this.grenadeTimer > 500) {
                    this.equipBestGun();
                    this.grenadeState = 'none';
                    return State.SUCCEEDED;
                }
                break;
        }
        return State.RUNNING;
    }

    public manageWeapon(dist: number): void {
        // Logic to switch weapons based on distance or ammo
        if (!this.ai.inventory || !this.ai.inventory.weapons) return;
        
        const currentWep = this.ai.inventory.weapons[this.ai.inventory.activeWeaponIndex];
        const isUsingMelee = this.ai.inventory.activeWeaponIndex === 2;

        // 1. Close Range Melee Switch (approx 2~6 body lengths)
        // If dist < 10 units and we have a melee weapon, consider switching
        if (dist < 10) {
            const meleeWep = this.ai.inventory.weapons[2];
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
                    this.ai.sendAction({ type: InputActions.EquipItem, slot: 2 });
                    return;
                }
            }
        }

        // 2. Switch back to gun if enemy is far away
        if (isUsingMelee && dist > 18) {
            const w0 = this.ai.inventory.weapons[0];
            const w1 = this.ai.inventory.weapons[1];
            if (w0 && w0.definition.defType === DefinitionType.Gun && (w0.count ?? 0) > 0) {
                this.ai.sendAction({ type: InputActions.EquipItem, slot: 0 });
                return;
            } else if (w1 && w1.definition.defType === DefinitionType.Gun && (w1.count ?? 0) > 0) {
                this.ai.sendAction({ type: InputActions.EquipItem, slot: 1 });
                return;
            }
        }

        // Simple logic: Close range (< 20) prefer shotgun/smg. Long range (> 40) prefer rifle/sniper.
        // Also check ammo.
        
        // TODO: Detailed weapon type checking requires definition analysis. 
        // For now, reload if empty.
        
        console.log("manageWeapon, activeWeaponIndex:", this.ai.inventory.activeWeaponIndex);
        
        // If current weapon is a gun and empty
        if (currentWep && currentWep.definition.defType === DefinitionType.Gun && (currentWep.count ?? 0) === 0) {
             const ammoType = currentWep.definition.ammoType;
             const reserveAmmo = this.ai.inventoryItems?.items?.[ammoType] || 0;
             
             if (reserveAmmo > 0) {
                 this.ai.sendAction({ type: InputActions.Reload });
             } else {
                 // No ammo for current gun, try other gun
                 const otherSlot = (this.ai.inventory.activeWeaponIndex + 1) % 2; 
                 const otherWep = this.ai.inventory.weapons[otherSlot];
                 if (otherWep && otherWep.definition.defType === DefinitionType.Gun && (otherWep.count ?? 0) > 0) {
                     this.ai.sendAction({ type: InputActions.EquipItem, slot: otherSlot });
                 } else {
                     // Both guns dry, switch to melee
                     if (this.ai.inventory.activeWeaponIndex !== 2) {
                         this.ai.sendAction({ type: InputActions.EquipItem, slot: 2 });
                     }
                 }
             }
        } else if (!currentWep || currentWep.definition.idString === 'fists') {
            // If we are holding fists, check if we have guns with ammo
            const w0 = this.ai.inventory.weapons[0];
            const w1 = this.ai.inventory.weapons[1];
            const w2 = this.ai.inventory.weapons[2]; // Melee slot

            if (w0 && w0.definition.defType === DefinitionType.Gun && (w0.count ?? 0) > 0) {
                this.ai.sendAction({ type: InputActions.EquipItem, slot: 0 });
            } else if (w1 && w1.definition.defType === DefinitionType.Gun && (w1.count ?? 0) > 0) {
                this.ai.sendAction({ type: InputActions.EquipItem, slot: 1 });
            } else if (w2 && w2.definition.idString !== 'fists' && this.ai.inventory.activeWeaponIndex !== 2) {
                // If we have a better melee weapon and aren't holding it, and have no guns with ammo
                this.ai.sendAction({ type: InputActions.EquipItem, slot: 2 });
            }
        }
    }

    public equipBestGun(): void {
        // Equip slot 0 or 1
        this.ai.sendAction({ type: InputActions.EquipItem, slot: 0 });
    }

    public calculateMeleeMovement(enemy: Player, dist: number): any {
        const now = Date.now();
        const dx = enemy.position.x - this.ai.playerPosition.x;
        const dy = enemy.position.y - this.ai.playerPosition.y;
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

    public calculateCombatMovement(enemy: Player, dist: number): any {
        const now = Date.now();
        // Strafing logic
        if (now - this.lastStrafeSwitch > 1000 + Math.random() * 1000) {
            this.strafeDirection *= -1;
            this.lastStrafeSwitch = now;
        }

        const dx = enemy.position.x - this.ai.playerPosition.x;
        const dy = enemy.position.y - this.ai.playerPosition.y;
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

    public calculateLeadAim(enemy: Player): number {
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

        return Math.atan2(targetY - this.ai.playerPosition.y, targetX - this.ai.playerPosition.x);
    }

    public calculateRetreatMovement(enemy: Player): any {
        const dx = enemy.position.x - this.ai.playerPosition.x;
        const dy = enemy.position.y - this.ai.playerPosition.y;
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

    public CanReviveTeammate(): boolean {
        if (this.ai.teamID === -1 || !this.ai.playerPosition) return false;
        
        for (const obj of this.ai.objects) {
            if (obj instanceof Player && 
                obj.id !== this.ai.playerId && 
                obj.teamID === this.ai.teamID && 
                obj.dead) { // 'dead' usually implies downed in this codebase context if they are still an object
                return true;
            }
        }
        return false;
    }
}
