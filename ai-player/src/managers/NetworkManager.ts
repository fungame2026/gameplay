import { AIPlayer } from "../AIPlayer";
import { PacketStream } from "@common/packets/packetStream";
import { PacketType, type PacketDataIn, type PacketDataOut } from "@common/packets/packet";
import { type JoinedData } from "@common/packets/joinedPacket";
import { JoinPacket } from "@common/packets/joinPacket";
import { type MapData } from "@common/packets/mapPacket";
import { type UpdateDataOut } from "@common/packets/updatePacket";
import { type GameOverData } from "@common/packets/gameOverPacket";
import { type KillData } from "@common/packets/killPacket";
import { Skins } from "@common/definitions/items/skins";
import { GameConstants, ObjectCategory } from "@common/constants";
import { Badges } from "@common/definitions/badges";
import { Emotes } from "@common/definitions/emotes";
import { MapManager } from "../mapManager";
import { GasManager } from "../gasManager";
import { GameObject } from "../objects/gameObject";
import { Player } from "../objects/player";
import { ObjectClassMapping } from "../typed";
import { type ObjectsNetData } from "@common/utils/objectsSerializations";

export class NetworkManager {
    private _socket: WebSocket | null = null;

    constructor(private ai: AIPlayer) {}

    public connect(serverAddress: string): void {
        console.log(`Connecting to server at ${serverAddress}`);
        if (this.ai.gameStarted) return;

        this._socket = new WebSocket(serverAddress);
        this._socket.binaryType = "arraybuffer";

        this._socket.onopen = (): void => {
            console.log('Connected to server');
            this.ai.gameStarted = false;   //here must be false!
            this.ai.gameOver = false;
            this.ai.playerDied = false;
            
            // Send join packet immediately after connection
            this.sendJoinPacket();
        };

        this._socket.onmessage = (message: MessageEvent<ArrayBuffer>): void => {
            this.handleMessage(message.data);
        };

        this._socket.onclose = (): void => {
            console.log('Disconnected from server');
            this.ai.gameStarted = false;
            process.exit(0);
        };

        this._socket.onerror = (error): void => {
            console.error('WebSocket error:', error);
            process.exit(1);
        };
    }

    public sendPacket(packet: PacketDataIn): void {
        if (this._socket?.readyState === WebSocket.OPEN) {
            try {
                const stream = new PacketStream(new ArrayBuffer(1024));
                stream.stream.index = 0;
                stream.serialize(packet);
                const buffer = stream.getBuffer();
                this._socket.send(buffer);
            } catch (error) {
                console.error('Error sending packet:', error);
            }
        }
    }

    private handleMessage(data: ArrayBuffer): void {
        try {
            const stream = new PacketStream(data);
            let iterationCount = 0;
            const splits: [number, number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0, 0];
            while (true) {
                if (++iterationCount === 1e3) {
                    console.warn("1000 iterations of packet reading; possible infinite loop");
                }
                const packet = stream.deserialize(splits);
                if (packet === undefined) break;
                this.onPacket(packet);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    private onPacket(packet: PacketDataOut): void {
        switch (packet.type) {
            case PacketType.Joined:
                this.handleJoinedPacket(packet as JoinedData);
                break;
            case PacketType.Map:
                this.handleMapPacket(packet as MapData);
                break;
            case PacketType.Update:
                this.handleUpdatePacket(packet as UpdateDataOut);
                break;
            case PacketType.GameOver:
                this.handleGameOverPacket(packet as GameOverData);
                break;
            case PacketType.Kill:
                this.handleKillPacket(packet as KillData);
                break;
        }
    }

    private handleJoinedPacket(packet: JoinedData): void {
        console.log('Joined game successfully');
        this.ai.gameStarted = true;
        this.ai.gameMap = {
            width: 1924, // Updated for Hunted map size
            height: 1924
        };
        // Set initial position to center of map
        this.ai.playerPosition = {
            x: this.ai.gameMap.width / 2,
            y: this.ai.gameMap.height / 2
        };
    }

    private handleUpdatePacket(updateData: UpdateDataOut): void {
        const now = Date.now();
        const playerData = updateData.playerData;
        const serverTime = (playerData && playerData.timestamp) ?? now;
        this.ai.setServerDt(serverTime - (this.ai.lastServerTime ?? serverTime));
        this.ai.lastServerTime = serverTime;
        this.ai.setLastUpdateTime(now);
    
        if (playerData) {
            if (playerData.teamID !== undefined) {
                this.ai.teamID = playerData.teamID;
            }

            // Update current player ID and weapon if available
            if (playerData.id !== undefined) {
                this.ai.playerId = playerData.id.id;
                this.ai.activePlayerID = playerData.id.id;
            }

            if (playerData.health !== undefined) {
                this.ai.playerHealth = playerData.health * 100;
            }
            if (playerData.adrenaline !== undefined) {
                this.ai.playerAdrenaline = playerData.adrenaline * 100;
            }
            
            // Update current weapon if player data contains active item info
            if (playerData.inventory) {
                // Initialize inventory if null
                if (!this.ai.inventory) {
                    this.ai.inventory = {
                        activeWeaponIndex: 0,
                        weapons: [undefined, undefined, undefined, undefined]
                    };
                }

                // Update Active Index
                this.ai.inventory.activeWeaponIndex = playerData.inventory.activeWeaponIndex;

                if (playerData.inventory.weapons) {
                    for (let i = 0; i < 4; i++) {
                        const newWep = playerData.inventory.weapons[i];
                        const oldWep = this.ai.inventory.weapons[i];
                        
                        // Detect Drop: Old existed, New is different or empty
                        if (oldWep && oldWep.definition.idString !== 'fists') {
                            if (!newWep || newWep.definition.idString !== oldWep.definition.idString) {
                                console.log(`Detected weapon drop/swap: ${oldWep.definition.idString} -> ${newWep ? newWep.definition.idString : 'Empty'}`);
                                this.ai.droppedItems.push({
                                    weaponId: oldWep.definition.idString,
                                    position: { ...this.ai.playerPosition },
                                    timestamp: serverTime
                                });
                            }
                        }
                        
                        // Update local inventory (Full Overwrite)
                        this.ai.inventory.weapons[i] = newWep;
                    }
                }
                
                // Update helpers
                const weaponUsing = this.ai.inventory.weapons[this.ai.inventory.activeWeaponIndex];
                if (weaponUsing) {
                    this.ai.currentWeapon = weaponUsing.definition.idString;
                    this.ai.hasWeapon = this.ai.currentWeapon !== "fists";
                } else {
                    this.ai.currentWeapon = null;
                    this.ai.hasWeapon = false; 
                }
            }

            if (playerData.items) {
                this.ai.inventoryItems = playerData.items;
            }
        }

        for (const { id, type, data } of updateData.fullDirtyObjects ?? []) {
            const object: GameObject | undefined = this.ai.objects.get(id);

            if (object === undefined || object.destroyed) {
                type K = typeof type;

                const _object = new (
                    ObjectClassMapping[type] as new (id: number, data: ObjectsNetData[K]) => InstanceType<ObjectClassMapping[K]>
                )(id, data);
                this.ai.objects.add(_object);
            } else {
                object.updateFromData(data, false);
            }
            
            // Check if this is our player and update weapon info
            if (type === ObjectCategory.Player && this.ai.playerId !== null && id === this.ai.playerId) {
                const player = this.ai.objects.get(id) as Player;
                if (player) {
                    this.ai.currentWeapon = player.activeItem.idString;
                    this.ai.hasWeapon = player.activeItem.idString !== "fists";
                }
            }
        }

        for (const { id, data } of updateData.partialDirtyObjects ?? []) {
            const object = this.ai.objects.get(id);
            if (object === undefined) {
                console.warn(`Trying to partially update non-existant object with ID ${id}`);
                continue;
            }

            (object as GameObject).updateFromData(data, false);
        }

        for (const id of updateData.deletedObjects ?? []) {
            const object = this.ai.objects.get(id);
            if (object === undefined) {
                console.warn(`Trying to delete unknown object with ID ${id}`);
                continue;
            }

            object.destroy();
            this.ai.objects.delete(object);
        }

        GasManager.updateFrom(updateData);

        // Update alive count
        if (updateData.aliveCount !== undefined) {
            this.ai.aliveCount = updateData.aliveCount;
        }

        const player = this.ai.activePlayer;
        if (!player) return;
        this.ai.playerPosition = player.position;
        this.ai.lastPlayerPositionUpdateTs = serverTime;
        //console.log("agent position updated: ", player.position);
    }

    private handleGameOverPacket(packet: GameOverData): void {
        console.log(`Game over. Rank: ${packet.rank}`);
        this.ai.gameOver = true;
        this.ai.isWinner = packet.rank === 1;
        this.ai.gameStarted = false;
    }

    private handleKillPacket(packet: KillData): void {
        // Check if this AI player was killed
        if (packet.victimId === this.ai.playerId) {
            console.log('Player was killed');
            this.ai.playerDied = true;
            this.ai.playerAlive = false;
        }
    }

    private handleMapPacket(packet: MapData): void {
        // Update map data using our MapManager
        MapManager.updateFromPacket(packet);
        
        // Update our game map dimensions
        if (this.ai.gameMap) {
            this.ai.gameMap.width = packet.width;
            this.ai.gameMap.height = packet.height;
        } else {
            this.ai.gameMap = {
                width: packet.width,
                height: packet.height
            };
        }
    }

    private sendJoinPacket(): void {
        try {
            // Create a proper join packet using the common library
            const joinPacket: PacketDataIn = JoinPacket.create({
                isMobile: false,
                isAgent: true,
                name: this.ai.playerName,
                boost: 1,
                basicEntryFeePerRound: 0.5,
                skin: Skins.fromStringSafe(GameConstants.player.defaultSkin) || Skins.definitions[0],
                badge: Badges.fromStringSafe("bdg_suroi_logo"),
                emotes: [
                    Emotes.fromStringSafe("happy_face"),
                    Emotes.fromStringSafe("thumbs_up"),
                    Emotes.fromStringSafe("wave"),
                    Emotes.fromStringSafe("suroi_logo"),
                    Emotes.fromStringSafe("fire"),
                    Emotes.fromStringSafe("gg"),
                    Emotes.fromStringSafe("troll_face"),
                    Emotes.fromStringSafe("skull")
                ],
                accessToken: this.ai.apiKey ?? ""
            });

            this.sendPacket(joinPacket);
            console.log('Join packet sent');
        } catch (error) {
            console.error('Error sending join packet:', error);
        }
    }
}
