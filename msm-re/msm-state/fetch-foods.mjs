/** One-off: fetch db_bakery_foods and print/dump the rows. */

import { writeFileSync } from 'node:fs';
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

const rows = [];
const dataKey = 'bakery_data';
const fullFetch = newSfsObject();
fullFetch.entries.set('last_updated', 0n);
const seen = new Set();
for (let i = 0; i < 100; i++) {
  const reply = await connection.request('db_bakery_foods', fullFetch, 60_000);
  const json = sfsToJson(reply.data ?? newSfsObject());
  const data = json[dataKey];
  if (!Array.isArray(data) || data.length === 0) {
    console.log('response keys:', Object.keys(json).join(', '));
    break;
  }
  // No chunk cursor on this catalog: repeated requests return the same
  // rows, so stop when nothing new arrives.
  const fresh = data.filter((row) => !seen.has(row.food_id));
  if (fresh.length === 0) break;
  for (const row of fresh) seen.add(row.food_id);
  rows.push(...fresh);
  console.log(`reply: ${String(data.length)} rows, ${String(fresh.length)} new (total ${String(rows.length)})`);
}

if (rows.length > 0) {
  console.log('first row:', JSON.stringify(rows[0]).slice(0, 600));
  console.log('row keys:', Object.keys(rows[0]).join(', '));
  writeFileSync('../catalogs/db_bakery_foods.json', JSON.stringify(rows));
  console.log(`saved ${String(rows.length)} rows to ../catalogs/db_bakery_foods.json`);
}
connection.close();
process.exit(0);