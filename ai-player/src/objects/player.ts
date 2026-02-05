import { AnimationType, GameConstants, InputActions, Layer, ObjectCategory, PlayerActions } from "@common/constants";
import { type EmoteDefinition } from "@common/definitions/emotes";
import { ArmorType, type ArmorDefinition } from "@common/definitions/items/armors";
import { type BackpackDefinition } from "@common/definitions/items/backpacks";
import { type GunDefinition, type SingleGunNarrowing } from "@common/definitions/items/guns";
import { HealType, type HealingItemDefinition } from "@common/definitions/items/healingItems";
import { DEFAULT_HAND_RIGGING, type MeleeDefinition } from "@common/definitions/items/melees";
import { PerkData, PerkIds } from "@common/definitions/items/perks";
import { type SkinDefinition } from "@common/definitions/items/skins";
import { Loots, type WeaponDefinition } from "@common/definitions/loots";
import { type ObstacleDefinition } from "@common/definitions/obstacles";
import { CircleHitbox } from "@common/utils/hitbox";
import { adjacentOrEqualLayer, adjacentOrEquivLayer } from "@common/utils/layer";
import { Angle, EaseFunctions, Geometry, Numeric } from "@common/utils/math";
import { type Timeout } from "@common/utils/misc";
import { DefinitionType, type ReferenceTo } from "@common/utils/objectDefinitions";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { pickRandomInArray, random, randomBoolean, randomFloat, randomPointInsideCircle, randomRotation, randomSign, randomVector } from "@common/utils/random";
import { FloorNames } from "@common/utils/terrain";
import { Vec, type Vector } from "@common/utils/vector";
import { GameObject } from "./gameObject";
import type { Building } from "./building";
import { Loot } from "./loot";
import { Obstacle } from "./obstacle";
import type { Projectile } from "./projectile";
import { MapManager } from "../mapManager";

export const BULLET_WHIZ_SCALE = 5;

export class Player extends GameObject.derive(ObjectCategory.Player) {
    teamID!: number;

    activeItem: WeaponDefinition = Loots.fromString("fists");

    // for common code
    get activeItemDefinition(): WeaponDefinition {
        return this.activeItem;
    }

    private _meleeSoundTimeoutID?: number;

    meleeStopSound?: any;
    meleeAttackCounter = 0;

    bushID?: number;

    backEquippedMelee?: MeleeDefinition;

    private activeDisguise?: ObstacleDefinition;
    halloweenThrowableSkin = false;

    infected = false;

    hasBubble = false;

    activeOverdrive = false;
    overdriveCooldown?: Timeout;

    private _oldItem = this.activeItem;

    equipment: {
        helmet?: ArmorDefinition
        vest?: ArmorDefinition
        backpack: BackpackDefinition
    } = {
        backpack: Loots.fromString("bag")
    };

    distTraveled = 0;

    get isActivePlayer(): boolean {
        // For AI player, this will always be false since we're not the active player
        return false;
    }

    footstepSound?: any;
    actionSound?: any;

    action = {
        type: PlayerActions.None,
        item: undefined as undefined | HealingItemDefinition
    };

    animation = AnimationType.None;
    animationChangeTime = 0;

    damageable = true;

    hideEquipment = false;

    downed = false;
    beingRevived = false;
    bleedEffectInterval?: NodeJS.Timeout;

    private _skin: ReferenceTo<SkinDefinition> = "";

    private _lastParticleTrail = Date.now();

    distSinceLastFootstep = 0;

    helmetLevel = NaN;
    vestLevel = NaN;
    backpackLevel = NaN;

    private _hitbox = new CircleHitbox(GameConstants.player.radius);
    get hitbox(): CircleHitbox { return this._hitbox; }

    private readonly _bulletWhizHitbox = new CircleHitbox(GameConstants.player.radius * BULLET_WHIZ_SCALE);
    get bulletWhizHitbox(): CircleHitbox { return this._bulletWhizHitbox; }

    floorType: FloorNames = FloorNames.Grass;

    sizeMod = 1;

    reloadMod = 1;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.Player]) {
        super(id);
        this.updateFromData(data, true);
    }

    override updateContainerPosition(): void {
        super.updateContainerPosition();
    }

    override update(): void { /* bleh */ }

    override updateInterpolation(): void {
        this.updateContainerPosition();
    }

    spawnCasingParticles(filterBy: "fire" | "reload", altFire = false): void {
        // Simplified implementation for AI - no particle effects needed
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Player], isNew = false): void {
        // Position and rotation
        const oldPosition = Vec.clone(this.position);
        this.position = data.position;
        this._hitbox.position = this.position;
        this._bulletWhizHitbox.position = this.position;

        this.rotation = data.rotation;

        if (this.isActivePlayer) {
            MapManager.setPosition(this.position);
        }

        const floorType = MapManager.terrain.getFloor(this.position, this.layer);
        this.floorType = floorType;

        if (!isNew) {
            const dist = Geometry.distance(oldPosition, this.position);
            this.distSinceLastFootstep += dist;
            this.distTraveled += dist;

            if (this.distTraveled > 8 && this.downed) {
                this.playAnimation(AnimationType.Downed);
                this.distTraveled = 0;
            }
            if (this.distSinceLastFootstep > 10) {
                this.distSinceLastFootstep = 0;
            }
        }

        if (data.animation !== undefined) {
            this.animation = data.animation;
            this.animationChangeTime = Date.now();
            this.playAnimation(data.animation);
        }

        if (data.full) {
            const {
                full: {
                    layer,
                    dead,
                    downed,
                    beingRevived,
                    teamID,
                    invulnerable,
                    activeItem,
                    sizeMod,
                    reloadMod,
                    skin,
                    helmet,
                    vest,
                    backpack,
                    halloweenThrowableSkin,
                    activeDisguise,
                    infected,
                    backEquippedMelee,
                    hasBubble,
                    activeOverdrive
                }
            } = data;

            const layerChanged = layer !== this.layer;
            let oldLayer: Layer | undefined;
            if (layerChanged) {
                oldLayer = this.layer;
                this.layer = layer;
            }

            this.backEquippedMelee = backEquippedMelee;
            this.dead = dead;
            this.teamID = teamID;

            if (this.downed !== downed) {
                this.downed = downed;
                this.updateFistsPosition(false);
                this.updateWeapon(isNew);
                this.updateEquipment();
            }

            if (this.beingRevived !== beingRevived) {
                this.beingRevived = beingRevived;
            }

            if (this.downed && !this.beingRevived && !this.bleedEffectInterval) {
                // No bleed effects for AI
            }

            if (this.dead || this.beingRevived) {
                clearInterval(this.bleedEffectInterval);
                this.bleedEffectInterval = undefined;
            }

            this._oldItem = this.activeItem;
            const itemDirty = this.activeItem !== activeItem;
            this.activeItem = activeItem;

            const skinID = skin.idString;
            this._skin = skinID;
            const skinDef = Loots.fromString<SkinDefinition>(skinID);

            if (sizeMod !== undefined && this.sizeMod !== sizeMod) {
                this.sizeMod = GameConstants.player.defaultModifiers().size;
                this._hitbox = new CircleHitbox(GameConstants.player.radius * this.sizeMod, this._hitbox.position);
            }

            if (reloadMod !== undefined && this.reloadMod !== reloadMod) this.reloadMod = reloadMod;

            const { hideEquipment, helmetLevel, vestLevel, backpackLevel } = this;

            this.hideEquipment = skinDef.hideEquipment ?? false;

            this.helmetLevel = (this.equipment.helmet = helmet)?.level ?? 0;
            this.vestLevel = (this.equipment.vest = vest)?.level ?? 0;
            this.backpackLevel = (this.equipment.backpack = backpack).level;

            if (
                hideEquipment !== this.hideEquipment
                || helmetLevel !== this.helmetLevel
                || vestLevel !== this.vestLevel
                || backpackLevel !== this.backpackLevel
            ) {
                this.updateEquipment();
            }

            if (itemDirty) {
                this.updateFistsPosition(true);
                this.updateWeapon(isNew);
            }

            if (this.activeDisguise !== activeDisguise) {
                this.activeDisguise = activeDisguise;
            }

            if (infected !== this.infected) {
                this.infected = infected;
            }

            // Shield
            if (hasBubble !== this.hasBubble) {
                this.hasBubble = hasBubble;
            }

            // Pan Image Display
            const backMelee = this.backEquippedMelee;

            // Overdrive
            if (activeOverdrive !== this.activeOverdrive) {
                this.activeOverdrive = activeOverdrive;
            }
        }

        if (data.action !== undefined) {
            const action = data.action;

            this.actionSound = undefined;

            switch (action.type) {
                case PlayerActions.None: {
                    this.updateFistsPosition(false);
                    this.updateWeapon(true);
                    break;
                }
                case PlayerActions.Reload: {
                    const weaponDef = this.activeItem as GunDefinition;
                    // Simplified for AI
                    break;
                }
                case PlayerActions.UseItem: {
                    // Simplified for AI
                    break;
                }
                case PlayerActions.Revive: {
                    // Simplified for AI
                    break;
                }
            }

            // @ts-expect-error 'item' not existing is okay
            this.action = action;
        }
    }

    override updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    private _getItemReference(): SingleGunNarrowing | Exclude<WeaponDefinition, GunDefinition> {
        const weaponDef = this.activeItem;

        return weaponDef.defType === DefinitionType.Gun && weaponDef.isDual
            ? Loots.fromString<SingleGunNarrowing>(weaponDef.singleVariant)
            : weaponDef as SingleGunNarrowing | Exclude<WeaponDefinition, GunDefinition>;
    }

    private _getOffset(): number {
        const weaponDef = this.activeItem;

        return weaponDef.defType === DefinitionType.Gun && weaponDef.isDual
            ? weaponDef.leftRightOffset
            : 0;
    }

    updateFistsPosition(anim: boolean): void {
        // Simplified for AI - no visual updates needed
    }

    updateWeapon(isNew = false): void {
        // Simplified for AI - no visual updates needed
    }

    updateEquipment(): void {
        // Simplified for AI - no visual updates needed
    }

    updateEquipmentWorldImage(type: "helmet" | "vest" | "backpack"): void {
        // Simplified for AI - no visual updates needed
    }

    canInteract(player: Player): boolean {
        // Simplified interaction logic for AI
        return false;
    }

    showEmote(emote: EmoteDefinition): void {
        // No emotes for AI
    }

    playAnimation(anim: AnimationType): void {
        // Simplified animation logic for AI
        switch (anim) {
            case AnimationType.None: {
                this.updateFistsPosition(true);
                this.updateWeapon();
                break;
            }
            case AnimationType.Melee: {
                // Simplified for AI
                break;
            }
            case AnimationType.Downed: {
                // Simplified for AI
                break;
            }
            case AnimationType.GunFire:
            case AnimationType.GunFireAlt: {
                // Simplified for AI
                break;
            }
            case AnimationType.GunClick: {
                // Simplified for AI
                break;
            }
            case AnimationType.ThrowableCook: {
                // Simplified for AI
                break;
            }
        }
    }
}