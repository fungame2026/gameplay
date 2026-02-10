import { GameConstants } from "../constants";
import { Badges, type BadgeDefinition } from "../definitions/badges";
import { Emotes, type EmoteDefinition } from "../definitions/emotes";
import { type SkinDefinition } from "../definitions/items/skins";
import { Loots } from "../definitions/loots";
import { Packet, PacketType } from "./packet";

export interface JoinData {
    readonly type: PacketType.Join
    readonly protocolVersion: number
    readonly name: string
    readonly isMobile: boolean
    readonly isAgent: boolean

    readonly boost: number

    readonly skin: SkinDefinition
    readonly badge?: BadgeDefinition

    readonly emotes: ReadonlyArray<EmoteDefinition | undefined>
    readonly accessToken?: string
}

// protocol version is automatically set; use this type when
// creating an object for use by a JoinPacket
export type JoinPacketCreation = Omit<JoinData, "protocolVersion">;

export const JoinPacket = new Packet<JoinPacketCreation, JoinData>(PacketType.Join, {
    serialize(stream, data) {
        const emotes = data.emotes;
        const hasBadge = data.badge !== undefined;
        const hasToken = data.accessToken !== undefined;
        stream.writeBooleanGroup2(
            data.isMobile,
            data.isAgent,
            hasBadge,
            hasToken,
            emotes[0] !== undefined,
            emotes[1] !== undefined,
            emotes[2] !== undefined,
            emotes[3] !== undefined,
            emotes[4] !== undefined,
            emotes[5] !== undefined,
            emotes[6] !== undefined,
            emotes[7] !== undefined
        );

        stream.writeUint16(GameConstants.protocolVersion);
        stream.writePlayerName(data.name);

        stream.writeUint16(data.boost);

        Loots.writeToStream(stream, data.skin);

        if (hasBadge) {
            Badges.writeToStream(stream, data.badge);
        }

        if (hasToken) {
            stream.writeString(2048, data.accessToken);
        }

        for (let i = 0; i < 8; i++) {
            const emote = emotes[i];
            if (emote === undefined) continue;
            Emotes.writeToStream(stream, emote);
        }
    },

    deserialize(stream, data) {
        const [
            isMobile,
            isAgent,
            hasBadge,
            hasToken,
            ...emotes
        ] = stream.readBooleanGroup2();
        data.isMobile = isMobile;
        data.isAgent = isAgent;

        data.protocolVersion = stream.readUint16();
        data.name = stream.readPlayerName().split(/<[^>]+>/g).join("").trim(); // Regex strips out HTML

        data.boost = stream.readUint16();

        data.skin = Loots.readFromStream(stream);

        if (hasBadge) {
            data.badge = Badges.readFromStream(stream);
        }

        if (hasToken) {
            data.accessToken = stream.readString(2048);
        }

        data.emotes = new Array(8);
        for (let i = 0; i < 8; i++) {
            if (!emotes[i]) continue;
            data.emotes[i] = Emotes.readFromStream(stream);
        }
    }
});
