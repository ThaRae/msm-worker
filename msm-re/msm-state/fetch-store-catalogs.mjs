/**
 * One-off: fetch the card-album ("sticker book") catalogs and dump the rows.
 *
 * db_cards / db_card_albums / db_card_album_store_items power the sticker
 * book: cards are the collectible stickers, albums group them per event,
 * and store items are the packs bought with card currency. The response
 * data keys were located in the client's catalog-download handler
 * (sub_CAE520 registration): card_data, card_album_data,
 * card_album_store_item_data.
 */

import { writeFileSync } from 'node:fs';
import { defaultTokenCachePath } from './dist/services/auth.js';
import { acquireToken } from './dist/services/auth.js';
import { fetchPregameSetup, parseGameServer } from './dist/services/pregame.js';
import { GameServerConnection } from './dist/services/gameServer.js';
import { newSfsObject } from './dist/lib/sfs.js';
import { sfsToJson } from './dist/lib/packet.js';

const acquired = await acquireToken({ tokenCacheFile: defaultTokenCachePath() });
const pregame = await fetchPregameSetup(acquired.token.access_token);
const endpoint = parseGameServer(pregame.serverIp);

const connection = new GameServerConnection(endpoint, { onPacket: () => undefined });
await connection.opened();
await connection.login(acquired.token.user_game_id[0], acquired.token.access_token);

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

const cards = await fetchCatalog('db_cards', 'card_data', 'id');
if (cards.length > 0) {
  console.log('first card:', JSON.stringify(cards[0]).slice(0, 500));
  writeFileSync('../catalogs/db_cards.json', JSON.stringify(cards));
}

const albums = await fetchCatalog('db_card_albums', 'card_album_data', 'id');
if (albums.length > 0) {
  console.log('first album:', JSON.stringify(albums[0]).slice(0, 500));
  writeFileSync('../catalogs/db_card_albums.json', JSON.stringify(albums));
}

const packItems = await fetchCatalog('db_card_album_store_items', 'card_album_store_item_data', 'id');
if (packItems.length > 0) {
  console.log('first pack item:', JSON.stringify(packItems[0]).slice(0, 500));
  writeFileSync('../catalogs/db_card_album_store_items.json', JSON.stringify(packItems));
}

connection.close();
process.exit(0);