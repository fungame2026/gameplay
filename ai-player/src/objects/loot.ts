import { GameConstants, ObjectCategory } from "@common/constants";
import { type LootDefinition } from "@common/definitions/loots";
import { CircleHitbox } from "@common/utils/hitbox";
import { DefinitionType } from "@common/utils/objectDefinitions";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";
import { GameObject } from "./gameObject";
import { type Player } from "./player";

export class Loot extends GameObject.derive(ObjectCategory.Loot) {
    definition!: LootDefinition;

    private _count = 0;
    get count(): number { return this._count; }

    hitbox!: CircleHitbox;

    constructor(id: number, data: ObjectsNetData[ObjectCategory.Loot]) {
        super(id);
        this.updateFromData(data, true);
    }

    override updateFromData(data: ObjectsNetData[ObjectCategory.Loot], isNew = false): void {
        if (data.full) {
            const definition = this.definition = data.full.definition;
            const idString = definition.idString;
            const defType = definition.defType;
            
            this.position = data.position;
            this.layer = data.layer;

            this.hitbox = new CircleHitbox(GameConstants.lootRadius[defType]);

            this._count = data.full.count || Infinity;
        }

        this.position = data.position;
        if (this.layer !== data.layer) {
            this.layer = data.layer;
        }
        this.hitbox.position = this.position;
    }

    canInteract(player: Player): boolean {
        if (player.dead || player.downed) return false;

        const definition = this.definition;

        switch (definition.defType) {
            case DefinitionType.Gun: {
                return true; // AI evaluator will decide if it's better
            }
            case DefinitionType.Melee: {
                return true;
            }
            case DefinitionType.HealingItem:
            case DefinitionType.Ammo:
            case DefinitionType.Throwable:
            case DefinitionType.Gold: {
                return true; 
            }
            case DefinitionType.Armor: {
                const armorDef = definition as any;
                if (armorDef.armorType === 0) { // Helmet
                    return armorDef.level > (player.equipment.helmet?.level ?? 0);
                } else { // Vest
                    return armorDef.level > (player.equipment.vest?.level ?? 0);
                }
            }
            case DefinitionType.Backpack: {
                return (definition as any).level > (player.equipment.backpack?.level ?? 0);
            }
            case DefinitionType.Scope: {
                return true; 
            }
        }
        return true;
    }

    //TODO 
    static getBackgroundAndScale(definition: LootDefinition): { backgroundTexture: string | undefined, scale: number } {
        let backgroundTexture: string | undefined;
        let scale = 0.5;

        switch (definition.defType) {
            case DefinitionType.Gun:
                if (definition.isDual) {
                    backgroundTexture = "loot_background_dual";
                } else {
                    backgroundTexture = "loot_background_gun";
                }
                scale = 0.4;
                break;
            case DefinitionType.HealingItem:
                backgroundTexture = "loot_background_healing";
                scale = 0.5;
                break;
            case DefinitionType.Ammo:
                backgroundTexture = "loot_background_ammo";
                scale = 0.45;
                break;
            case DefinitionType.Armor:
                backgroundTexture = "loot_background_armor";
                scale = 0.5;
                break;
            case DefinitionType.Backpack:
                backgroundTexture = "loot_background_backpack";
                scale = 0.5;
                break;
            case DefinitionType.Scope:
                backgroundTexture = "loot_background_scope";
                scale = 0.45;
                break;
            case DefinitionType.Skin:
                backgroundTexture = "loot_background_skin";
                scale = 0.5;
                break;
            case DefinitionType.Gold:
                backgroundTexture = "loot_background_skin";
                scale = 0.85;
                break;
            case DefinitionType.Perk:
                backgroundTexture = "loot_background_perk";
                scale = 0.5;
                break;
            case DefinitionType.Melee:
                backgroundTexture = "loot_background_melee";
                scale = 0.5;
                break;
            case DefinitionType.Throwable:
                backgroundTexture = "loot_background_throwable";
                scale = 0.5;
                break;
        }

        return { backgroundTexture, scale };
    }

    override updateDebugGraphics(): void {
        // No debug graphics for AI
    }

    override update(): void {
    }

    override updateInterpolation(): void { /* bleh */ }
}