import { AIPlayer } from "../AIPlayer";
import { Loot } from "../objects/loot";
import { DefinitionType } from "@common/utils/objectDefinitions";
import { Geometry } from "@common/utils/math";
import { MeleeEvaluator } from "../meleeEvaluator";
import { WeaponEvaluator } from "../weaponEvaluator";
import { ObjectCategory, InputActions, PlayerActions } from "@common/constants";
import { GameObject } from "../objects/gameObject";
import { Obstacle } from "../objects/obstacle";
import { Player } from "../objects/player";
import { CircleHitbox } from "@common/utils/hitbox";
import { Desire, ObjectClassMapping } from "../typed";
import { delay } from "../utility";
import { InputPacket } from "@common/packets/inputPacket";
import { HealingItems } from "@common/definitions/items/healingItems";
import { Explosions } from "@common/definitions/explosions";
import { Projectile } from "../objects/projectile";

export class LootManager {
    constructor(private ai: AIPlayer) {}

    public scanForLoots(): Desire[] {
        if (this.ai.lastInteractLootTimestamp !== undefined && this.ai.lastServerTime !== undefined && this.ai.lastServerTime <= this.ai.lastInteractLootTimestamp) {
            return [];
        }
        const results: Desire[] = [];
        const nearbyLoots = this.findNearbyLoots();
        
        nearbyLoots.sort((a, b) => a.distance - b.distance);
        
        const hasPendingDesire = (id: number) => this.ai.desires.some(d => d.targetId === id && !d.isResolved);
        
        const now = Date.now();
        this.ai.droppedItems = this.ai.droppedItems.filter(d => now - d.timestamp < 50000);

        const expectAmmoTypes = new Set<string>();
        for (const item of nearbyLoots) {
            const loot = item.loot as Loot;
            const def = loot.definition;
            
            if (hasPendingDesire(loot.id)) continue;

            if (def.defType === DefinitionType.Gun) {
                const isRecentlyDropped = this.ai.droppedItems.some(d => 
                    d.weaponId === def.idString && 
                    Geometry.distance(loot.position, d.position) < 50
                );
                if (isRecentlyDropped) continue;
            }
            
            const baseDesire: Desire = {
                type: 'pickupLoot', // Default
                targetName: def.idString,
                targetPosition: loot.position,
                targetId: loot.id,
                isResolved: false,
                status: 'pending',
                priority: 3,
                creationTime: now
            };

            switch (def.defType) {
                case DefinitionType.HealingItem: {
                    const healId = def.idString;
                    const current = this.ai.inventoryItems?.items?.[healId] || 0;
                    const backpack = this.ai.activePlayer?.equipment?.backpack;
                    // @ts-ignore
                    const maxCapacity = backpack?.maxCapacity?.[healId] ?? 5;
                    
                    if (current < maxCapacity) {
                         if (current === 0 && this.ai.playerHealth < 100) baseDesire.priority = 2;
                         results.push({ ...baseDesire, type: 'pickupLoot' });
                    }
                    break;
                }
                case DefinitionType.Gold: {
                    const goldId = def.idString;
                    const current = this.ai.inventoryItems?.items?.[goldId] || 0;
                    const backpack = this.ai.activePlayer?.equipment?.backpack;
                    // @ts-ignore
                    const maxCapacity = backpack?.maxCapacity?.[goldId] ?? 10000;
                    
                    if (current < maxCapacity) {
                         results.push({ ...baseDesire, type: 'pickupLoot' });
                    }
                    break;
                }
                case DefinitionType.Armor: {
                    const armorDef = def as any;
                    if (!this.ai.activePlayer) break;
                    
                    if (armorDef.armorType === 0) {
                        const currentLevel = this.ai.activePlayer.equipment.helmet?.level ?? 0;
                        if (armorDef.level > currentLevel) {
                            const priority = armorDef.level >= 3 ? 1 : 3;
                            results.push({ ...baseDesire, type: 'pickupLoot', priority });
                        }
                    } else {
                        const currentLevel = this.ai.activePlayer.equipment.vest?.level ?? 0;
                        if (armorDef.level > currentLevel) {
                            const priority = armorDef.level >= 3 ? 1 : 3;
                            results.push({ ...baseDesire, type: 'pickupLoot', priority });
                        }
                    }
                    break;
                }
                case DefinitionType.Backpack: {
                    const backpackDef = def as any;
                    if (!this.ai.activePlayer) break;
                    const currentLevel = this.ai.activePlayer.equipment.backpack?.level ?? 0;
                    if (backpackDef.level > currentLevel) {
                        const priority = backpackDef.level >= 3 ? 1 : 3;
                        results.push({ ...baseDesire, type: 'pickupLoot', priority });
                    }
                    break;
                }
                case DefinitionType.Scope: {
                    const scopeDef = def as any;
                    const currentScope = this.ai.inventoryItems?.scope;
                    if (!currentScope) {
                        results.push({ ...baseDesire, type: 'pickupLoot' });
                    } else if (scopeDef.zoomLevel > currentScope.zoomLevel) {
                        if (scopeDef.zoomLevel >= 160) {
                            results.push({ ...baseDesire, type: 'pickupLoot', priority: 1 });
                        } else {
                            results.push({ ...baseDesire, type: 'pickupLoot' });
                        }
                    }
                    break;
                }
                case DefinitionType.Melee: {
                    if (this.ai.inventory && this.ai.inventory.weapons) {
                        const currentMelee = this.ai.inventory.weapons[2];
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
                    if (this.ai.inventory && this.ai.inventory.weapons) {
                        const currentThrowable = this.ai.inventory.weapons[3];
                        const groundId = def.idString;

                        if (groundId == "frag_grenade") {
                            if (!currentThrowable) {
                                results.push({ ...baseDesire, type: 'pickupThrowable', priority: 1 });
                            }
                        }
                    } else if (def.idString === 'frag_grenade' || def.idString === 'smoke_grenade') {
                        results.push({ ...baseDesire, type: 'pickupThrowable', priority: 3 });
                    }
                    break;
                }
                case DefinitionType.Gun: {
                    if (this.ai.inventory && this.ai.inventory.weapons) {
                        const slot1Gun = this.ai.inventory.weapons[0];
                        const slot2Gun = this.ai.inventory.weapons[1];
                        const groundId = def.idString;
                        const groundInfo = WeaponEvaluator.getWeaponInfo(groundId);
                        
                        let slot1Better = false;
                        if (!slot1Gun || slot1Gun.definition.idString === 'fists') {
                            slot1Better = true;
                        } else {
                            const s1Info = WeaponEvaluator.getWeaponInfo(slot1Gun.definition.idString);
                            if (groundInfo.score > s1Info.score + 5) slot1Better = true;
                        }
                        
                        if (slot1Better) {
                             const hasAnyGun1 = (slot1Gun && slot1Gun.definition.idString !== 'fists') || 
                                               (slot2Gun && slot2Gun.definition.idString !== 'fists');
                             const hasAnyGun = hasAnyGun1 || (expectAmmoTypes.size > 0);
                             results.push({ ...baseDesire, type: 'pickupGun', priority: hasAnyGun ? 3 : 0, targetSlot: 0 });
                             expectAmmoTypes.add(def.ammoType);
                             continue;
                        }

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
                        results.push({ ...baseDesire, type: 'pickupGun', priority: 2, targetSlot: 0 });
                        expectAmmoTypes.add(def.ammoType);
                    }
                    break;
                }
            }
        }
        
        if (this.ai.inventory && this.ai.inventory.weapons) {
            const slot1Gun = this.ai.inventory.weapons[0];
            const slot2Gun = this.ai.inventory.weapons[1];
            if ((slot1Gun && slot1Gun.definition.idString !== 'fists') || (slot2Gun && slot2Gun.definition.idString !== 'fists')) {
                for (const desire of this.ai.desires) {
                    if (desire.type === 'pickupGun' && desire.status !== 'doing') {
                        desire.priority = 2;
                    }
                }
            }
        }

        for (const item of nearbyLoots) {
            const loot = item.loot as Loot;
            const def = loot.definition;
            
            if (hasPendingDesire(loot.id)) continue;

            const baseDesire: Desire = {
                type: 'pickupLoot',
                targetName: def.idString,
                targetPosition: loot.position,
                targetId: loot.id,
                isResolved: false,
                status: 'pending',
                priority: 3,
                creationTime: now
            };

            if (def.defType == DefinitionType.Ammo) {
                const ammoId = def.idString;
                const current = this.ai.inventoryItems?.items?.[ammoId] || 0;
                const backpack = this.ai.activePlayer?.equipment?.backpack;
                // @ts-ignore
                const maxCapacity = backpack?.maxCapacity?.[ammoId] ?? 999;
                    
                if (current < maxCapacity) {
                    let isMatch = false;
                    if (expectAmmoTypes.has(ammoId)) {
                        isMatch = true;
                    } else if (this.ai.inventory?.weapons) {
                        for (const w of this.ai.inventory.weapons) {
                            if (w && w.definition.idString !== 'fists' && w.definition.ammoType === ammoId) {
                                isMatch = true;
                                break;
                            }
                        }
                    }

                    let p = 3;
                    if (isMatch) {
                        const dist = Geometry.distance(this.ai.playerPosition, loot.position);
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

    public findNearbyLoots(): any[] {
        const lootItems = [];
        const now = Date.now();
        
        this.ai.ignoredLootZones = this.ai.ignoredLootZones.filter(z => z.expiry > now);
        for (const [id, expiry] of this.ai.lootedItems) {
            if (expiry < now) this.ai.lootedItems.delete(id);
        }
        
        const zoom = this.ai.inventory?.scope?.zoomLevel ?? 100;
        const maxDistance = zoom * 2;

        if (!this.ai.gameMap) return [];

        const marginX = this.ai.gameMap.width * 0.05;
        const marginY = this.ai.gameMap.height * 0.05;

        for (const obj of this.ai.objects) {
            if (obj instanceof (ObjectClassMapping[ObjectCategory.Loot] as any)) {
                const loot = obj as InstanceType<typeof ObjectClassMapping[ObjectCategory.Loot]>;
                
                if (this.ai.lootedItems.has(loot.id)) continue;

                let inIgnoreZone = false;
                for (const zone of this.ai.ignoredLootZones) {
                    if (Geometry.distance(loot.position, zone.position) < zone.radius) {
                        if (this.ai.explicitTargetId !== loot.id) {
                            if (loot.definition.defType === DefinitionType.Gun) {
                                inIgnoreZone = true;
                                break;
                            }
                        }
                    }
                }
                if (inIgnoreZone) continue;
                
                if (loot.position.x < marginX || loot.position.x > this.ai.gameMap.width - marginX ||
                    loot.position.y < marginY || loot.position.y > this.ai.gameMap.height - marginY ||
                    !this.ai.isInSafeZone(loot.position)) {
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
                    
                    if (loot.definition.defType === DefinitionType.HealingItem || 
                        loot.definition.defType === DefinitionType.Ammo ||
                        loot.definition.defType === DefinitionType.Gold) {
                        const id = loot.definition.idString;
                        if (this.ai.activePlayer && this.ai.inventoryItems && this.ai.inventoryItems.items) {
                            const currentCount = this.ai.inventoryItems.items[id] || 0;
                            const backpack = this.ai.activePlayer.equipment.backpack;
                            const maxCapacity = (backpack.maxCapacity as any)[id];
                            if (maxCapacity !== undefined && currentCount >= maxCapacity) {
                                continue;
                            }
                        }
                    }

                    const distance = Geometry.distance(this.ai.playerPosition, loot.position);
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
        return lootItems;
    }

    public isLootDesireStillValid(desire: Desire, loot: Loot): boolean {
        if (!loot || loot.destroyed || !this.ai.objects.hasId(loot.id)) {
            return false;
        }

        const def = loot.definition;

        if (def.defType === DefinitionType.Ammo || 
            def.defType === DefinitionType.HealingItem || 
            def.defType === DefinitionType.Gold) {
            const id = def.idString;
            const current = this.ai.inventoryItems?.items?.[id] || 0;
            const backpack = this.ai.activePlayer?.equipment?.backpack;
            if (backpack) {
                const maxCapacity = (backpack.maxCapacity as any)[id];
                if (maxCapacity !== undefined && current >= maxCapacity) return false;
            }
        }

        if (!this.ai.activePlayer) return true;

        switch (def.defType) {
            case DefinitionType.Armor: {
                const armorDef = def as any;
                if (armorDef.armorType === 0) {
                    const currentLevel = this.ai.activePlayer.equipment.helmet?.level ?? 0;
                    return armorDef.level > currentLevel;
                } else {
                    const currentLevel = this.ai.activePlayer.equipment.vest?.level ?? 0;
                    return armorDef.level > currentLevel;
                }
            }
            case DefinitionType.Backpack: {
                const backpackDef = def as any;
                const currentLevel = this.ai.activePlayer.equipment.backpack?.level ?? 0;
                return backpackDef.level > currentLevel;
            }
            case DefinitionType.Scope: {
                const scopeDef = def as any;
                const currentScope = this.ai.inventoryItems?.scope;
                if (!currentScope) return true;
                return scopeDef.zoomLevel > currentScope.zoomLevel;
            }
            case DefinitionType.Melee: {
                if (this.ai.inventory && this.ai.inventory.weapons) {
                    const currentMelee = this.ai.inventory.weapons[2];
                    const groundId = def.idString;
                    return MeleeEvaluator.shouldSwap(currentMelee?.definition.idString ?? null, groundId);
                }
                break;
            }
            case DefinitionType.Throwable: {
                if (this.ai.inventory && this.ai.inventory.weapons) {
                    const currentThrowable = this.ai.inventory.weapons[3];
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
                if (desire.targetSlot !== undefined && this.ai.inventory?.weapons) {
                    const currentGun = this.ai.inventory.weapons[desire.targetSlot];
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

    public checkDesireCompletion(desire: Desire): boolean {
        switch (desire.type) {
            case 'pickupGun':
                 if (this.ai.inventory && this.ai.inventory.weapons && desire.targetSlot !== undefined) {
                     const w = this.ai.inventory.weapons[desire.targetSlot];
                     const hasIt = w && w.definition.idString === desire.targetName;
                     const isHoldingIt = this.ai.inventory.activeWeaponIndex === desire.targetSlot;
                     return !!(hasIt && isHoldingIt);
                 }
                 return false;
            
            case 'pickupMelee':
                 if (this.ai.inventory && this.ai.inventory.weapons) {
                     const w = this.ai.inventory.weapons[2];
                     const hasIt = w && w.definition.idString === desire.targetName;
                     return !!hasIt;
                 }
                 return false;

            case 'pickupThrowable':
                if (this.ai.inventory && this.ai.inventory.weapons) {
                    const w = this.ai.inventory.weapons[3];
                    const hasIt = w && w.definition.idString === desire.targetName;
                    return !!hasIt;
                }
                return false;

            case 'pickupLoot':
                 if (this.ai.inventoryItems && this.ai.inventoryItems.items && desire.targetName) {
                     const count = this.ai.inventoryItems.items[desire.targetName] || 0;
                     if (count > 0 && desire.targetId && !this.ai.objects.hasId(desire.targetId)) {
                         return true;
                     }
                 }
                 return false;

            case 'killEnemy':
                 if (desire.targetId) {
                    const enemy = this.ai.objects.get(desire.targetId);
                    if (enemy && (enemy as Player).dead) return true;
                 }
                 return false;
            
            case 'avoidGas':
                return this.ai.isInSafeZone(this.ai.playerPosition);

            case 'avoidGrenade':
                if (desire.targetId) {
                    const obj = this.ai.objects.get(desire.targetId);
                    if (!obj || obj.destroyed) return true;
                    
                    if (obj instanceof Projectile) {
                        const def = obj.definition;
                        const explosionId = def.detonation?.explosion;
                        const explosionDef = Explosions.definitions.find(e => e.idString === explosionId);
                        const safeDist = (explosionDef?.radius.max ?? 25) + 5;
                        
                        if (Geometry.distance(this.ai.playerPosition, obj.position) > safeDist) return true;
                    }
                }
                return false;
            
            case 'heal':
                return this.ai.playerHealth >= 100 || !this.hasMedicalItem();
            
            case 'reload':
                if (this.ai.inventory?.weapons && desire.targetSlot !== undefined) {
                    const w = this.ai.inventory.weapons[desire.targetSlot];
                    return !!(w && (w.count ?? 0) >= w.definition.capacity);
                }
                return true;

            case 'moveToLocation':
                return Geometry.distance(this.ai.playerPosition, desire.targetPosition) < 5;
        }
        return false;
    }

    public isDesireLootInteractable(targetId: number): boolean {
        const object: GameObject | undefined = this.ai.objects.get(targetId);
        if (!object) return false;
        
        const player = this.ai.activePlayer;
        if (!player) return false;
        
        const isLoot = object instanceof Loot;
        const isObstacle = object instanceof Obstacle;
        const isPlayer = object instanceof Player;
        if (!isLoot && !isObstacle && !isPlayer) return false;

        // @ts-ignore
        const canInteract = typeof object.canInteract === 'function' ? object.canInteract(player) : isLoot;
        const sizeMod = (player as any).sizeMod ?? 1;
        const detectionHitbox = new CircleHitbox(3 * sizeMod, this.ai.playerPosition);
        if (canInteract && object.hitbox.collidesWith(detectionHitbox)) {
            return true;
        }
        return false;
    }

    public getClosestInteractable(): GameObject | undefined {
        const player = this.ai.activePlayer;
        if (!player) return undefined;

        const sizeMod = (player as any).sizeMod ?? 1;
        const detectionHitbox = new CircleHitbox(3 * sizeMod, this.ai.playerPosition);

        let closestObject: GameObject | undefined;
        let minDistanceSq = Infinity;

        for (const object of this.ai.objects) {
            if (object.id === this.ai.playerId) continue;

            const isLoot = object instanceof Loot;
            const isObstacle = object instanceof Obstacle;
            const isPlayer = object instanceof Player;

            if (!isLoot && !isObstacle && !isPlayer) continue;

            // @ts-ignore
            const canInteract = typeof object.canInteract === 'function' ? object.canInteract(player) : isLoot;

            if (canInteract && object.hitbox.collidesWith(detectionHitbox)) {
                const distSq = Geometry.distanceSquared(this.ai.playerPosition, object.position);
                if (distSq < minDistanceSq) {
                    minDistanceSq = distSq;
                    closestObject = object;
                }
            }
        }

        return closestObject;
    }

    public async handlePickupLoot(desire: Desire): Promise<void> {
        this.ai.targetPosition = desire.targetPosition;
        this.ai.isForceStop = true;

        if (desire.type === 'pickupMelee') {
            if (this.ai.inventory?.activeWeaponIndex !== 2) {
                this.ai.sendAction({ type: InputActions.EquipItem, slot: 2 });
                await delay(200);
                return;
            }
        } else if (desire.type === 'pickupThrowable') {
            const w = this.ai.inventory?.weapons?.[3];
            if (w && this.ai.inventory?.activeWeaponIndex !== 3) {
                this.ai.sendAction({ type: InputActions.EquipItem, slot: 3 });
                await delay(200);
                return;
            }
        } else if (desire.type === 'pickupGun') {
            if (desire.targetSlot == 1) {
                const w = this.ai.inventory?.weapons?.[1];
                if (w && this.ai.inventory.activeWeaponIndex !== desire.targetSlot) {
                    this.ai.sendAction({ type: InputActions.EquipItem, slot: 1 });
                    await delay(200);
                    return; 
                }
            } else {
                const w = this.ai.inventory?.weapons?.[0];
                if (w && this.ai.inventory.activeWeaponIndex !== desire.targetSlot) {
                    this.ai.sendAction({ type: InputActions.EquipItem, slot: 0 });
                    await delay(200);
                    return; 
                }
            }
        }

        if (desire.type !== 'pickupGun') {
            const w = this.ai.inventory?.weapons?.[1];
            if (w && w.definition.defType === DefinitionType.Gun && w.definition.idString !== 'fists') {
                if ((w.count ?? 0) > 0) {
                    if (this.ai.inventory.activeWeaponIndex == 1) {
                        this.ai.sendAction({ type: InputActions.EquipItem, slot: 0 });
                        //console.log("delay aaa 200...")
                        await delay(200);
                    }
                } else {
                   if (this.ai.inventory.activeWeaponIndex == 0) {
                        this.ai.sendAction({ type: InputActions.EquipItem, slot: 1 });
                        //console.log("delay bbb 200...")
                        await delay(200);
                    }
                }
            }
        }

        const dist = Geometry.distance(this.ai.playerPosition, desire.targetPosition);
        const dx = desire.targetPosition.x - this.ai.playerPosition.x;
        const dy = desire.targetPosition.y - this.ai.playerPosition.y;
        const angle = Math.atan2(dy, dx);
        
        const interactionRange = 2.5;
        const movement = {
            up: Math.abs(dy) > interactionRange && dy < 0,
            down: Math.abs(dy) > interactionRange && dy > 0,
            left: Math.abs(dx) > interactionRange && dx < 0,
            right: Math.abs(dx) > interactionRange && dx > 0
        };

        // Lock-step movement optimization:
        // When close to the target, we must ensure we don't send overlapping move commands.
        if (dist < 20.0) {
            // If we have a pending move that hasn't been reflected in a position update,
            // we force the current movement to false (Stop).
            if (this.ai.lastPlayerPositionUpdateTs < this.ai.lastMoveTimestamp) {
                movement.up = false;
                movement.down = false;
                movement.left = false;
                movement.right = false;
            }
        }

        this.ai.constrainMovement(movement);
        
        let actions = [];
        const isInteractable = this.isDesireLootInteractable(desire.targetId!);
        if (isInteractable) {
            if (desire.type !== 'pickupGun' && desire.type !== 'pickupMelee' && desire.type !== 'pickupThrowable') {
                actions.push({ type: InputActions.Interact });
            } else if (desire.type === 'pickupMelee') {
                if (this.ai.inventory?.activeWeaponIndex === 2) {
                    actions.push({ type: InputActions.Interact });
                }
            } else if (desire.type === 'pickupThrowable') {
                const w = this.ai.inventory?.weapons?.[3];
                if (!w || this.ai.inventory?.activeWeaponIndex === 3) {
                    actions.push({ type: InputActions.Interact });
                }
            } else if (desire.type === 'pickupGun') {
                if (desire.targetSlot == 0 || desire.targetSlot == 1) {
                    const w = this.ai.inventory?.weapons?.[desire.targetSlot];
                    if (!w || this.ai.inventory?.activeWeaponIndex === desire.targetSlot) {
                        actions.push({ type: InputActions.Interact });
                    }
                }
            }
            
            // Stop movement if we are close enough to interact to avoid overshooting
            movement.up = false;
            movement.down = false;
            movement.left = false;
            movement.right = false;
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
        this.ai.sendPacket(inputPacket);

        if (isInteractable) {
            this.ai.lastInteractLootTimestamp = this.ai.lastServerTime;
            for (let i=0; i < 5; ++i) {
                if (this.checkDesireCompletion(desire)) {
                    break;
                } else {
                    await delay(100);
                }
            }
        }

        if (desire.type === 'pickupGun') {
            const w = this.ai.inventory?.weapons?.[desire.targetSlot!];
            const alreadyHasGun = w && w.definition.idString === desire.targetName;

            if (alreadyHasGun) {
                if (this.ai.inventory.activeWeaponIndex !== desire.targetSlot) {
                    this.ai.sendAction({ type: InputActions.EquipItem, slot: desire.targetSlot });
                    await delay(200);
                }
                return;
            }
        }
    }

    public async handleHeal(desire: Desire): Promise<void> {
        this.ai.isForceStop = false;
        
        if (this.ai.IsDangerGas()) {
            this.ai.AvoidGas();
        } else if (!this.ai.targetPosition) {
            this.ai.ensureWanderTarget();
        }

        this.ai.combatManager.PerformHealing();
        this.ai.UpdateMovement();
    }

    public async handleReload(desire: Desire): Promise<void> {
        if (!this.ai.inventory || desire.targetSlot === undefined) return;

        if (this.ai.inventory.activeWeaponIndex !== desire.targetSlot) {
            this.ai.sendAction({ type: InputActions.EquipItem, slot: desire.targetSlot });
            return;
        }

        const player = this.ai.activePlayer;
        if (player && player.action.type === PlayerActions.None) {
            this.ai.sendAction({ type: InputActions.Reload });
        }
    }

    public hasMedicalItem(onlyHealth: boolean = false): boolean {
        return !!this.getBestMedicalItem(onlyHealth);
    }

    public isLoot(obj: any): obj is Loot {
        return obj instanceof Loot;
    }

    public getBestMedicalItem(onlyHealth: boolean = false, preferBooster: boolean = false): { index: number, def: any } | null {
        if (!this.ai.inventoryItems || !this.ai.inventoryItems.items) return null;
        
        const healthPriorities = ["medikit", "gauze"];
        const boosterPriorities = ["tablets", "cola"];

        if (preferBooster) {
            for (const id of boosterPriorities) {
                const count = this.ai.inventoryItems.items[id] ?? 0;
                if (count > 0) {
                    const def = HealingItems.definitions.find(d => d.idString === id);
                    if (def) return { index: -1, def };
                }
            }
        }

        if (this.ai.playerHealth < 100) {
            const preferredHealth = this.ai.playerHealth < 50 ? ["medikit", "gauze"] : ["gauze", "medikit"];
            for (const id of preferredHealth) {
                const count = this.ai.inventoryItems.items[id] ?? 0;
                if (count > 0) {
                    const def = HealingItems.definitions.find(d => d.idString === id);
                    if (def) return { index: -1, def };
                }
            }
        }

        if (onlyHealth) return null;

        if (!preferBooster) {
            for (const id of boosterPriorities) {
                const count = this.ai.inventoryItems.items[id] ?? 0;
                if (count > 0) {
                    const def = HealingItems.definitions.find(d => d.idString === id);
                    if (def) return { index: -1, def };
                }
            }
        }

        return null;
    }
}
