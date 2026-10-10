/**
 * Fetch the game's content catalogs (db_monster, db_structure, db_island_v2)
 * from the live server and cache them as JSON for the dashboard's
 * id -> name mappings.
 *
 * Usage: node fetch-catalogs.mjs [outDir]
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { mintSteamTicket } from './dist/lib/ticket.js';
import { fetchAccessToken } from './dist/services/authApi.js';
import { fetchPregameSetup, parseGameServer } from './dist/services/pregame.js';
import { GameServerConnection } from './dist/services/gameServer.js';
import { newSfsObject } from './dist/lib/sfs.js';
import { sfsToJson } from './dist/lib/packet.js';

const CATALOGS = ['db_monster', 'db_structure', 'db_island_v2'];
const outDir = process.argv[2] ?? '../catalogs';
mkdirSync(outDir, { recursive: true });

const { ticket, steamId } = mintSteamTicket();
const token = await fetchAccessToken(steamId, ticket);
const pregame = await fetchPregameSetup(token.access_token);
const endpoint = parseGameServer(pregame.serverIp);

const connection = new GameServerConnection(endpoint, {
  onPacket: () => undefined,
});
await connection.opened();
await connection.login(token.user_game_id[0], token.access_token);

for (const cmd of CATALOGS) {
  // Catalogs arrive via a per-connection cursor: repeating the same
  // request advances the chunk (response carries chunk/numChunks).
  const rows = [];
  const dataKey = cmd === 'db_island_v2' ? 'islands_data' : cmd === 'db_structure' ? 'structures_data' : 'monsters_data';
  const fullFetch = newSfsObject();
  fullFetch.entries.set('last_updated', 0n);
  for (let i = 0; i < 100; i++) {
    const reply = await connection.request(cmd, fullFetch, 60_000);
    const json = sfsToJson(reply.data ?? newSfsObject());
    const data = json[dataKey];
    if (!Array.isArray(data) || data.length === 0) {
      break;
    }
    rows.push(...data);
    const total = Number(json.numChunks);
    console.log(`${cmd} chunk ${String(json.chunk)}/${String(total)}: ${String(data.length)} rows (total ${String(rows.length)})`);
    if (Number.isInteger(total) && Number(json.chunk) >= total) {
      break;
    }
  }
  const file = `${outDir}/${cmd}.json`;
  writeFileSync(file, JSON.stringify(rows));
  console.log(`${cmd} -> ${file} (${String(rows.length)} rows)`);
}
connection.close();
process.exit(0);