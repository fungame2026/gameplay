import { AIPlayer } from "./AIPlayer";

async function main() {
    // Get config path and server address from command line arguments
    let configPath: string | undefined = process.argv[2];
    let serverAddress: string | undefined = process.argv[3];

    // If the first argument looks like a server address, swap them for backward compatibility
    if (configPath && (configPath.startsWith('ws://') || configPath.startsWith('http://'))) {
        serverAddress = configPath;
        configPath = undefined;
    }
    
    // If no server address provided, try to find one via the API
    if (!serverAddress) {
        const mainAddress = 'http://127.0.0.1:9186';
        console.log(`Finding game via API at ${mainAddress}...`);
        try {
            const response = await fetch(`${mainAddress}/api/getGame`);
            if (response.ok) {
                const data = await response.json() as any;
                if (data.success) {
                    const gameID = data.gameID;
                    // Deriving the port from the main port (9186) + gameID + 1
                    serverAddress = `ws://127.0.0.1:${9186 + gameID + 1}/play`;
                    console.log(`Found game ID ${gameID}, using address: ${serverAddress}`);
                }
            } else {
                console.warn(`API returned ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.error('Error fetching game via API:', error);
        }
    }

    // Default fallback
    serverAddress = serverAddress || 'ws://127.0.0.1:9187/play';

    console.log('Starting AI Player...');
    console.log(`Server address: ${serverAddress}`);

    // Create AI player with a unique name
    const playerName = `AI_Player_${Math.floor(Math.random() * 1000)}`;
    const aiPlayer = new AIPlayer(serverAddress, playerName, configPath);
    await aiPlayer.start();
    process.exit(0);
}

main()
	.then(() => console.log('AI Player process started'))
	.catch(error => {
		console.error('Error starting AI Player:', error)
		process.exit(1)
	})
