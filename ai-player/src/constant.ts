import { Region, ConfigType} from "./typed";

export const IS_DEV_MODE: boolean = true;

export const Config = {
    defaultRegion: "dev",
    regions: {
        dev: {
            name: "Local Server",
            mainAddress: "http://192.168.1.2:9186",
            gameAddress: "ws://192.168.1.2:<gameID>",
            offset: 9187
        },
        na: {
            name: "North America",
            flag: "🏆 ",
            mainAddress: "https://us.lobmoney.org",
            gameAddress: "wss://us.lobmoney.org/game/<gameID>",
            offset: 9187
        },
        as: {
            name: "Asia",
            flag: "🇻🇳 ",
            mainAddress: "https://as.lobmoney.org",
            gameAddress: "wss://as.lobmoney.org/game/<gameID>",
            offset: 9187
        },
    }
} satisfies ConfigType as ConfigType;

export const MIN_GOLD_FOR_EVACUATION = 100;
