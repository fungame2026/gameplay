import { AIPlayer } from "../AIPlayer";
import { Desire } from "../typed";
import { Projectile } from "../objects/projectile";
import { Explosions } from "@common/definitions/explosions";
import { Geometry } from "@common/utils/math";
import { GasManager } from "../gasManager";

export class DesireManager {
    constructor(private ai: AIPlayer) {}

    public evaluateDesires(): void {
        const now = Date.now();

        // -0.5 Avoid Grenades (Highest Priority)
        for (const obj of this.ai.objects) {
            if (obj instanceof Projectile && !obj.destroyed) {
                const def = obj.definition;
                if (!def.detonation?.explosion) continue; // No explosion (e.g. smoke)

                const explosionId = def.detonation.explosion;
                const explosionDef = Explosions.definitions.find(e => e.idString === explosionId);
                
                if (explosionDef && explosionDef.damage > 0) {
                     const dist = Geometry.distance(this.ai.playerPosition, obj.position);
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
        if (this.ai.IsDangerGas()) {
            let safeCenter = GasManager.position;
             if (!safeCenter || (safeCenter.x === 0 && safeCenter.y === 0)) {
                safeCenter = { x: this.ai.gameMap!.width / 2, y: this.ai.gameMap!.height / 2 };
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
        const enemy = this.ai.combatManager.findClosestEnemy();
        if (enemy && Geometry.distance(this.ai.playerPosition, enemy.position) < 80) {
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
        const hasHealthMeds = this.ai.lootManager.hasMedicalItem(true);
        const hasAnyMeds = this.ai.lootManager.hasMedicalItem(false);

        if ((this.ai.playerHealth < 95 && hasHealthMeds) || (this.ai.playerHealth < 100 && hasAnyMeds)) {
            let prio = 2;
            if (this.ai.playerHealth < 30) {
                prio = 0;
            } else if (this.ai.playerHealth < 40) {
                prio = 0.5;
            }
            const existing = this.ai.desires.find(d => d.type === 'heal');
            if (!existing || existing.priority > prio) {
                this.addDesire({
                    type: 'heal',
                    targetName: 'Self',
                    targetPosition: this.ai.playerPosition,
                    isResolved: false,
                    status: 'pending',
                    priority: prio,
                    creationTime: now
                });
            }
        }

        // 2.1 Boost Adrenaline (High Priority if combat imminent or just to keep high)
        // Keep adrenaline > 80 if we have boosters.
        const bestBooster = this.ai.lootManager.getBestMedicalItem(false, true);
        if (bestBooster && this.ai.playerAdrenaline < 80) {
            // If enemy is within 150 units, consider it imminent combat
            const closeEnemy = this.ai.combatManager.findClosestEnemy();
            const distToEnemy = closeEnemy ? Geometry.distance(this.ai.playerPosition, closeEnemy.position) : Infinity;
            
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
            
            const existing = this.ai.desires.find(d => d.type === 'heal');
            // If no existing heal, OR existing is lower priority (higher value) than this boost
            if (!existing || existing.priority > boostPrio) {
                 this.addDesire({
                    type: 'heal',
                    targetName: 'Boost',
                    targetPosition: this.ai.playerPosition,
                    isResolved: false,
                    status: 'pending',
                    priority: boostPrio,
                    creationTime: now
                });
            }
        }

        // 2.5 Reloading (Priority 1.5) - Between Combat and Looting
        if (this.ai.inventory?.weapons && this.ai.inventoryItems?.items) {
            for (let i = 0; i < 2; i++) {
                const w = this.ai.inventory.weapons[i];
                if (w && w.definition.idString !== 'fists' && (w.count ?? 0) < w.definition.capacity) {
                    const ammoType = w.definition.ammoType;
                    const reserve = this.ai.inventoryItems.items[ammoType] || 0;
                    if (reserve > 0) {
                        this.addDesire({
                            type: 'reload',
                            targetName: w.definition.idString,
                            targetPosition: this.ai.playerPosition,
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
        const potentialLoots = this.ai.lootManager.scanForLoots();
        for (const desire of potentialLoots) {
            this.addDesire(desire);
        }
    }

    public addDesire(newDesire: Desire): void {
        // Check if desire already exists
        const existingIndex = this.ai.desires.findIndex(d => 
            d.type === newDesire.type && 
            (d.targetId === newDesire.targetId || (newDesire.targetId === undefined && d.targetName === newDesire.targetName))
        );

        if (existingIndex !== -1) {
            // Update existing desire
            const existing = this.ai.desires[existingIndex];
            existing.targetPosition = newDesire.targetPosition; // Update pos (e.g. moving enemy)
            
            // Only update priority if it became MORE urgent
            if (newDesire.priority < existing.priority) {
                existing.priority = newDesire.priority;
                // Re-sort needed
                this.ai.desires.sort((a, b) => a.priority - b.priority);
            }
            return;
        }
        
        // Insert based on priority
        let insertIndex = this.ai.desires.length;
        for(let i=0; i<this.ai.desires.length; i++) {
            if(newDesire.priority < this.ai.desires[i].priority) {
                insertIndex = i;
                break;
            }
        }
        this.ai.desires.splice(insertIndex, 0, newDesire);
    }

    public async processDesires() {
        if (this.ai.desires.length === 0) return;

        // Sort: Priority (Ascending) -> Distance to Player (Ascending)
        // This ensures that among equal priority tasks, we pick the closest one.
        this.ai.desires.sort((a, b) => {
            if (a.priority !== b.priority) {
                return a.priority - b.priority;
            }
            const distA = Geometry.distance(this.ai.playerPosition, a.targetPosition);
            const distB = Geometry.distance(this.ai.playerPosition, b.targetPosition);
            return distA - distB;
        });

        const currentDesire = this.ai.desires[0];
        currentDesire.status = 'doing';

        // Validate
        if (!this.isDesireValid(currentDesire)) {
            // console.log(`Desire ${currentDesire.type} became invalid. Removing.`);
            this.ai.desires.shift(); 
            this.ai.isForceStop = false; // Reset force stop if we were doing something
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
                await this.ai.combatManager.handleKillEnemy(currentDesire);
                break;
            case 'pickupGun':
            case 'pickupMelee':
            case 'pickupThrowable':
            case 'pickupLoot':
                await this.ai.lootManager.handlePickupLoot(currentDesire);
                break;
            case 'heal':
                await this.ai.lootManager.handleHeal(currentDesire);
                break;
            case 'reload':
                await this.ai.lootManager.handleReload(currentDesire);
                break;
            case 'moveToLocation':
                await this.handleMoveToLocation(currentDesire);
                break;
        }

        // Check Completion
        if (this.ai.lootManager.checkDesireCompletion(currentDesire)) {
             currentDesire.isResolved = true;
             console.log(`Desire ${currentDesire.type} completed.`);
             this.ai.desires.shift();
             this.ai.isForceStop = false;
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
                if (this.ai.lootManager.checkDesireCompletion(desire)) return true;

                // Check if loot object still exists
                if (desire.targetId) {
                    const obj = this.ai.objects.get(desire.targetId);
                    if (!obj || obj.destroyed) return false;

                    // Specific validation for lootable items
                    if (this.ai.lootManager.isLoot(obj)) {
                        if (!this.ai.lootManager.isLootDesireStillValid(desire, obj)) return false;
                    }
                }
                break;
            case 'avoidGrenade':
                if (desire.targetId) {
                    const obj = this.ai.objects.get(desire.targetId);
                    if (!obj || obj.destroyed) return false; // Grenade gone, no need to avoid
                }
                break;
            case 'killEnemy':
                // If enemy is dead, it's valid (will be completed)
                if (desire.targetId) {
                    const enemy = this.ai.objects.get(desire.targetId);
                    //console.log("enemy: ", enemy)
                    if (enemy && enemy.dead) return true; // Will be handled by completion
                    if (!enemy || enemy.destroyed) return false;
                }
                break;
            case 'reload':
                if (this.ai.inventory?.weapons && desire.targetSlot !== undefined) {
                    const w = this.ai.inventory.weapons[desire.targetSlot];
                    if (!w || w.definition.idString !== desire.targetName) return false;
                    const reserve = this.ai.inventoryItems?.items?.[w.definition.ammoType] || 0;
                    if (reserve <= 0) return false;
                }
                break;
        }
        return true;
    }

    private handleAvoidGas(desire: Desire): void {
        this.ai.targetPosition = desire.targetPosition;
        this.ai.isForceStop = false;
        this.ai.UpdateMovement();
    }

    private handleAvoidGrenade(desire: Desire): void {
        this.ai.isForceStop = false;
        
        let grenadePos = desire.targetPosition;
        // If grenade moved (e.g. rolling), update if possible.
        if (desire.targetId) {
             const obj = this.ai.objects.get(desire.targetId);
             if (obj) grenadePos = obj.position;
        }

        const dx = this.ai.playerPosition.x - grenadePos.x;
        const dy = this.ai.playerPosition.y - grenadePos.y;
        const angle = Math.atan2(dy, dx); // Angle AWAY from grenade
        
        // Project a point far away (e.g. 50 units)
        const dist = 50;
        const target = {
            x: this.ai.playerPosition.x + Math.cos(angle) * dist,
            y: this.ai.playerPosition.y + Math.sin(angle) * dist
        };
        
        this.ai.targetPosition = target;
        this.ai.UpdateMovement();
    }

    private async handleMoveToLocation(desire: Desire): Promise<void> {
        this.ai.isForceStop = false;
        this.ai.targetPosition = desire.targetPosition;
        this.ai.UpdateMovement();
        
        // Check if we arrived
        const dist = Geometry.distance(this.ai.playerPosition, desire.targetPosition);
        if (dist < 5) {
            desire.isResolved = true; // Mark as done so we can remove it
        }
    }
}
