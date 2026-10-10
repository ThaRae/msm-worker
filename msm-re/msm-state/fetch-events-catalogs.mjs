/** One-off: fetch db_reward_tracks and db_clubbox_acts and dump the rows. */

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

// Both catalogs were located in the client's login flow (sub_CAE520):
// db_reward_tracks -> reward_tracks_data, db_clubbox_acts -> clubbox_act_data.
const fetchCatalog = async (name, dataKey, rowKey) => {
  const rows = [];
  const fullFetch = newSfsObject();
  fullFetch.entries.set('last_updated', 0n);
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const reply = await connection.request(name, fullFetch, 60_000);
    const json = sfsToJson(reply.data ?? newSfsObject());
    const data = json[dataKey];
    if (!Array.isArray(data) || data.length === 0) {
      console.log(name, 'response keys:', Object.keys(json).join(', '));
      break;
    }
    const fresh = data.filter((row) => !seen.has(row[rowKey]));
    if (fresh.length === 0) break;
    for (const row of fresh) seen.add(row[rowKey]);
    rows.push(...fresh);
    console.log(`${name}: ${String(data.length)} rows, ${String(fresh.length)} new (total ${String(rows.length)})`);
  }
  return rows;
};

const tracks = await fetchCatalog('db_reward_tracks', 'reward_tracks_data', 'id');
if (tracks.length > 0) {
  console.log('first track:', JSON.stringify(tracks[0]).slice(0, 800));
  console.log('track ids:', tracks.map((t) => t.id).join(', '));
  writeFileSync('../catalogs/db_reward_tracks.json', JSON.stringify(tracks));
}

const acts = await fetchCatalog('db_clubbox_acts', 'clubbox_act_data', 'id');
if (acts.length > 0) {
  console.log('first act:', JSON.stringify(acts[0]).slice(0, 800));
  writeFileSync('../catalogs/db_clubbox_acts.json', JSON.stringify(acts));
}

connection.close();
process.exit(0);