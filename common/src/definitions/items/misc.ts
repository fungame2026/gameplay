import { DefinitionType, ObjectDefinitions, type ItemDefinition } from "../../utils/objectDefinitions";

export interface GoldDefinition extends ItemDefinition {
    readonly defType: DefinitionType.Gold
}

export const Miscs = new ObjectDefinitions<GoldDefinition>([
    {
        idString: "gold",
        name: "GOLD",
        defType: DefinitionType.Gold,
        noDrop: true,
        mapIndicator: "gold"
    }
]);
