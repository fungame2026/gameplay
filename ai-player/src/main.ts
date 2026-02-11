import { AIPlayer } from "./AIPlayer";
import { Config } from "./constant";

function printHelp() {
    console.log("Usage: npm start [region]");
    console.log("Regions:");
    console.log("  na   - North America (default)");
    console.log("  as   - Asia");
    console.log("  dev  - Local Development Server");
    console.log("\nOptions:");
    console.log("  --help  Show this help message");
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-help")) {
        printHelp();
        return;
    }

    let regionKey = args[0] || "na";
    if (!["na", "as", "dev"].includes(regionKey)) {
        if (args[0]) {
            console.warn(`Invalid region "${regionKey}", defaulting to "na"`);
        }
        regionKey = "na";
    }

    const regionConfig = Config.regions[regionKey as keyof typeof Config.regions];
    let serverAddress: string | undefined;

    console.log(`Region: ${regionConfig.name}`);
    console.log(`Finding game via API at ${regionConfig.mainAddress}...`);

    try {
        const response = await fetch(`${regionConfig.mainAddress}/api/getGame`);
        if (response.ok) {
            const data = await response.json() as any;
            if (data.success) {
                const gameID = data.gameID;
                serverAddress = regionConfig.gameAddress.replace("<gameID>", (gameID + regionConfig.offset).toString());
                if (!serverAddress.endsWith("/play")) {
                    serverAddress += "/play";
                }
                console.log(`Found game ID ${gameID}, using address: ${serverAddress}`);
            } else {
                console.warn("API returned success: false");
            }
        } else {
            console.warn(`API returned ${response.status}: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error fetching game via API:", error);
    }

    // Default fallback if API fails
    if (!serverAddress) {
        serverAddress = regionConfig.gameAddress.replace("<gameID>", regionConfig.offset.toString());
        if (!serverAddress.endsWith("/play")) {
            serverAddress += "/play";
        }
        console.warn(`Failed to find game via API, using default fallback: ${serverAddress}`);
    }

    console.log("Starting AI Player...");
    console.log(`Server address: ${serverAddress}`);

    // Create AI player with a unique name
    const playerName = `AI_Player_${Math.floor(Math.random() * 1000)}`;
    const aiPlayer = new AIPlayer(serverAddress, playerName, null as any);
    await aiPlayer.start();

    process.exit(0);
}

main()
    .then(() => console.log("AI Player process started"))
    .catch(error => {
        console.error("Error starting AI Player:", error);
        process.exit(1);
    });
