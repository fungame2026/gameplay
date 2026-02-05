import { WebSocket } from "ws";
import * as fs from "fs";
import { AIPlayer } from "../AIPlayer";
import { delay } from "../utility";

// Enum from common/typings.ts
const CustomTeamMessages = {
    Join: 0,
    Update: 1,
    Settings: 2,
    KickPlayer: 3,
    Start: 4,
    Started: 5
};

async function main() {
    const mainPort = 9186;
    const mainAddress = `http://127.0.0.1:${mainPort}`;

    const playerName = `AI_Player_${Math.floor(Math.random() * 1000)}`;
    const wsAddress = `ws://127.0.0.1:${mainPort}/team?name=${playerName}&skin=boxer`;

    console.log(`Connecting to Team Server at ${wsAddress}...`);
    const ws = new WebSocket(wsAddress);

    let teamID: string | null = null;
    let gameStarted = false;

    ws.on('open', () => {
        //clearTimeout(connectionTimeout);
        console.log("Connected to Team WebSocket.");
    });

    ws.on('message', async (data) => {
        const msg = JSON.parse(data.toString());
        
        switch (msg.type) {
            case CustomTeamMessages.Join:
                teamID = msg.teamID;
                console.log(`Created Team ID: ${teamID}`);
                fs.writeFileSync("teamID.json", JSON.stringify({ teamID }));
                console.log("Saved teamID to teamID.json");

                ws.send(JSON.stringify({ type: CustomTeamMessages.Settings, forceStart: true }));    
                ws.send(JSON.stringify({ type: CustomTeamMessages.Start }));

                break;

            case CustomTeamMessages.Update:
                console.log(`Team Update: ${msg.players.length} players.`);
                
                // If we have more than 1 player (Leader + Member), start the game.
                if (msg.players.length > 1 && msg.isLeader && !gameStarted) {
                    console.log("Player joined. Starting game in 2 seconds...");
                    gameStarted = true; // Prevent multiple starts
                    setTimeout(() => {
                        console.log("Sending Start command...");
                        ws.send(JSON.stringify({ type: CustomTeamMessages.Start }));
                    }, 2000);
                }
                break;

            case CustomTeamMessages.Started:
                console.log("Game Started message received! Fetching Game ID...");
                if (!teamID) return;
                
                try {
                    const response = await fetch(`${mainAddress}/api/getGame?teamID=${teamID}`);
                    const json = await response.json() as any;
                    
                    if (json.success) {
                        const gameID = json.gameID;
                        // Assuming standard port offset logic used in this project
                        const gamePort = mainPort + gameID + 1;
                        const gameWsUrl = `ws://127.0.0.1:${gamePort}/play?teamID=${teamID}`;
                        
                        console.log(`Connecting to Game at ${gameWsUrl}`);
                        
                        // Close team socket
                        //ws.close();
                        
                        // Start AI
                        const ai = new AIPlayer(gameWsUrl, "AI_Leader");
                        await ai.start();
                    } else {
                        console.error("Failed to find game:", json);
                    }
                } catch (e) {
                    console.error("Error fetching game info:", e);
                }
                break;
        }
    });

    ws.on('error', (err) => {
        //clearTimeout(connectionTimeout);
        console.error("WebSocket error:", err);
    });

    ws.on('close', () => {
        console.log("Team WebSocket closed.");
    });

    while (true) {
        await delay(1000);
    }
}

main().catch(console.error);