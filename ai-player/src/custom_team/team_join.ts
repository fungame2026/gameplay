import * as fs from "fs";
import { AIPlayer } from "../AIPlayer";

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    const mainPort = 9186;
    const mainAddress = `http://127.0.0.1:${mainPort}`;
    
    // 1. Read teamID from file
    let teamID = "";
    // Retry reading file for a few seconds in case Leader is slow to write it
    for (let i = 0; i < 10; i++) {
        try {
            if (fs.existsSync("teamID.json")) {
                const data = JSON.parse(fs.readFileSync("teamID.json", "utf-8"));
                teamID = data.teamID;
                if (teamID) break;
            }
        } catch (e) {
            // ignore
        }
        await delay(1000);
    }

    if (!teamID) {
        console.error("No teamID found in teamID.json. Run team_main.ts first.");
        process.exit(1);
    }

    console.log(`Found TeamID: ${teamID}`);
    console.log("Attempting to find active game for this team...");

    // 2. Poll API to find the game (Wait for Leader to start it)
    let gameWsUrl = "";
    
    // Try for 30 seconds
    for (let i = 0; i < 15; i++) {
        try {
            // Check if there is an active game for this team
            const response = await fetch(`${mainAddress}/api/getGame?teamID=${teamID}`);
            console.log("response: ", response);
            if (response.ok) {
                const json = await response.json() as any;
                if (json.success) {
                    const gameID = json.gameID;
                    const gamePort = mainPort + gameID + 1;
                    gameWsUrl = `ws://127.0.0.1:${gamePort}/play?teamID=${teamID}`;
                    console.log(`Found Active Game! ID: ${gameID}`);
                    break;
                } else {
                    console.log("Game not started yet... waiting");
                }
            }
        } catch (e) {
            console.error("Error fetching game info:", e);
        }
        await delay(2000);
    }

    if (!gameWsUrl) {
        console.error("Timeout: Could not find an active game for this team. Did the leader start it?");
        process.exit(1);
    }

    // 3. Connect directly to Game Server
    console.log(`Connecting Member directly to Game at ${gameWsUrl}`);
    
    const ai = new AIPlayer(gameWsUrl, "AI_Member");
    await ai.start();
}

main().catch(console.error);
