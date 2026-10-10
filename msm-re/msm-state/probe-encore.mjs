/** One-off: request gs_player_encore_state and dump the response. */

import { mintSteamTicket } from './dist/lib/ticket.js';
import { fetchAccessToken } from './dist/services/authApi.js';
import { fetchPregameSetup, parseGameServer } from './dist/services/pregame.js';
import { GameServerConnection } from './dist/services/gameServer.js';
import { newSfsObject } from './dist/lib/sfs.js';
import { sfsToJson } from './dist/lib/packet.js';

const { ticket, steamId } = mintSteamTicket();
const token = await fetchAccessToken(steamId, ticket);
const pregame = await fetchPregameSetup(token.access_token);
const endpoint = parseGameServer(pregame.serverIp);

const connection = new GameServerConnection(endpoint, { onPacket: () => undefined });
await connection.opened();
await connection.login(token.user_game_id[0], token.access_token);

const reply = await connection.request('gs_player_encore_state', newSfsObject(), 60_000);
console.log(JSON.stringify(sfsToJson(reply.data ?? newSfsObject()), null, 2).slice(0, 8000));

connection.close();
process.exit(0);