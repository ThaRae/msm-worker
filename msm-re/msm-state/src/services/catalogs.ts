/**
 * Content catalogs fetched from the server (see fetch-catalogs.mjs) and
 * cached as JSON on disk: db_monster, db_structure, db_island_v2. These
 * give the id -> name mappings and structure kinds the dashboard shows.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** A catalog row; only the fields we use are typed. */
type CatalogRow = Record<string, unknown>;

export type FoodInfo = {
  id: number;
  name: string;
  /** Coin price per batch. */
  cost: number;
  /** Bake duration in ms (catalog `time` is seconds). */
  timeMs: number;
  /** Treats produced per batch. */
  food: number;
  /** False for seasonal/event-only recipes the bakery offers temporarily. */
  alwaysAvail: boolean;
};

/** One milestone of a reward track (encore / clubbox hype progress). */
export type RewardTrackLevel = {
  level: number;
  /** Points the milestone costs; the track's levels ascend by these. */
  points: number;
  /** Human note from the catalog ("5 Clubbox Ticket", ...). */
  note: string;
};

export type RewardTrackInfo = {
  id: number;
  name: string;
  levels: RewardTrackLevel[];
};

/** A Clubbox "act" (collab stage); its name comes from the linked hype track. */
export type ClubboxActInfo = {
  id: number;
  rewardTrackId: number;
};

/** One sticker of a card album (db_cards): rarity 1..5 stars. */
export type CardInfo = {
  id: number;
  rarity: number;
};

/** One album page (db_card_albums pages[]): ten cards plus a reward. */
export type CardAlbumPageInfo = {
  id: number;
  /** Localization key (CARD_ALBUM_2_PAGE_1). */
  name: string;
  /** db_cards ids on this page. */
  cardIds: number[];
  /** JSON-encoded rewards ([{"type":"DIAMONDS","amount":25}]). */
  rewards: string;
};

/** A sticker book (db_card_albums): pages of cards to collect. */
export type CardAlbumInfo = {
  id: number;
  pages: CardAlbumPageInfo[];
};

/** A purchasable sticker pack (db_card_album_store_items). */
export type CardPackStoreItem = {
  id: number;
  /** Localization key (CARD_ALBUM_STORE_ITEM_01). */
  name: string;
  /** Cost in the album's card currency. */
  cost: number;
  /** Contents: [{type:"CARD_PACK", id, amount}] — pack type + count. */
  contents: string;
};

export type Catalogs = {
  /** monster_id -> display name ("Rare Wubbox Air Island"). */
  monsters: Map<number, string>;
  /** monster_id -> portrait graphic name (monster_portrait_square_a...). */
  monsterPortraits: Map<number, string>;
  /** structure_id -> catalog metadata. */
  structures: Map<number, {
    name: string;
    prettyName: string;
    /** "breeding" | "nursery" | "mine" | "castle" | ... as shipped by db_structure. */
    structureType: string;
    /** Footprint in island grid cells (drawn by the island map). */
    sizeX: number;
    sizeY: number;
    /** Mine fill window in ms (extra.time minutes); 0 for non-mines. */
    mineFillMs: number;
    /** graphic.file: the xml_bin descriptor naming the structure's sprites. */
    graphicFile: string;
    /** graphic.anim: the body animation, whose name usually matches the body sprite. */
    anim: string;
    /** Catalog y_offset; the game lifts the sprite this many pixels above the cell. */
    yOffset: number;
    /** Store fields (the in-game market's own data): coin/diamond/eth costs. */
    costCoins: number;
    costDiamonds: number;
    costEthCurrency: number;
    /** Player level required before the market sells it. */
    level: number;
    /** 1 when the market lists this row. */
    viewInMarket: boolean;
    sellable: boolean;
    /** Global entity id; requirements reference these (upgrade chains). */
    entityId: number;
    /** Next tier's structure id (castle/structure upgrades), 0 when final. */
    upgradesTo: number;
    /** Build time in ms; the structure needs gs_finish_structure after it. */
    buildTimeMs: number;
    /** Prerequisite entity ids (own these before buying — upgrade tiers). */
    requirements: number[];
    /**
     * Island variant ids this row's market lists it on, or null when the
     * market sells it on every island (the base decorations).
     */
    allowedOnIslands: number[] | null;
  }>;
  /** island variant id (player state `island` field) -> display info. */
  islands: Map<number, IslandInfo>;
  /** island variant id -> the art files the island scene is drawn from. */
  islandGraphics: Map<number, IslandGraphic>;
  /** Per-variant MIDI and entity instrument descriptors. Optional for older fixtures. */
  islandSongs?: Map<number, IslandSongCatalog>;
  /** monster_id -> animation file and footprint, for drawing it on its island. */
  monsterGraphics: Map<number, MonsterGraphic>;
  /** food_option_id -> bakery recipe, bake-time ascending. */
  foods: FoodInfo[];
  /** reward_track_id -> encore/clubbox-hype track ("Encore Baking", ...). */
  rewardTracks: Map<number, RewardTrackInfo>;
  /** clubbox act id -> catalog act (name resolves via its hype track). */
  clubboxActs: Map<number, ClubboxActInfo>;
  /** card id -> sticker (db_cards; empty until fetch-store-catalogs.mjs runs). */
  cards: Map<number, CardInfo>;
  /** card album id -> sticker book definition (db_card_albums). */
  cardAlbums: Map<number, CardAlbumInfo>;
  /** Sticker packs for sale (db_card_album_store_items). */
  cardPackItems: CardPackStoreItem[];
  /**
   * monster_id -> fill-window length in ms from db_monster time_to_fill_sec.
   * Only rows with a positive window are stored; -1/0 means the statue
   * does not expire (common Wublins after the inventory timer was retired).
   */
  timeToFillMs: Map<number, number>;
  /**
   * monster_id -> db_monster row. Covers every monster, not just the
   * always-in-market ones: limited-time offers (Amber Island vessels,
   * seasonal entities) are gated by EntityStoreAvailability timed
   * events instead of view_in_market, and the store view needs their
   * cost rows to price them.
   */
  marketMonsters: Map<number, MonsterMarketInfo>;
};

/** A db_monster row the in-game market can sell (egg or vessel). */
export type MonsterMarketInfo = {
  /** Catalog monster_id; also what gs_buy_egg wants. */
  id: number;
  name: string;
  costCoins: number;
  costDiamonds: number;
  costKeys: number;
  costRelics: number;
  costStarpower: number;
  costEthCurrency: number;
  costMedals: number;
  /** Player level the market requires. */
  level: number;
  /** Egg hatch time in ms. */
  buildTimeMs: number;
  /** Castle beds the hatched monster takes. */
  beds: number;
  /** Global entity id; EntityStoreAvailability events reference these. */
  entityId: number;
  /** 1 when the market lists this row unconditionally. */
  viewInMarket: boolean;
  /**
   * Availability bitmask (255 = always; other values are limited-time
   * windows like seasonal sales). Kept as a hint only — the server
   * refuses out-of-window buys.
   */
  timeAvailability: number;
};

/** Families the dashboard groups islands into, in the order it lists them. */
export const ISLAND_GROUPS = ['natural', 'mirror', 'fire', 'magical', 'ethereal', 'special'] as const;
export type IslandGroup = (typeof ISLAND_GROUPS)[number];

export type IslandInfo = {
  name: string;
  group: IslandGroup;
  /** Monster ids this island's market lists (db_island_v2 monsters rows). */
  marketMonsterIds: number[];
};

/** db_island_v2 graphic fields; all names are relative to the game's data dir. */
export type IslandGraphic = {
  /** xml_bin scene animation drawn over the ground (edges, props, clouds). */
  sceneFile: string;
  /** xml_bin tileset naming the ground tile texture file. */
  tilesetFile: string;
  /** xml_bin grid: island size, tile size and which cell uses which tile. */
  gridFile: string;
  /** gfx background ("sky18" -> gfx/sky18.avif). */
  sky: string;
};

export type IslandSongCatalog = {
  midi: string;
  monsters: Map<number, string>;
  structures: Map<number, string>;
};

export type MonsterGraphic = {
  /** xml_bin animation file (graphic.file). */
  file: string;
  /** Optional explicit animation name (graphic.anim); "Idle" otherwise. */
  anim: string;
  sizeX: number;
  sizeY: number;
};

const catalogRow = (row: unknown): CatalogRow => (typeof row === 'object' && row !== null ? row as CatalogRow : {});

/**
 * db_structure ships allowed_on_island as a JSON-encoded string
 * ("[1,2,3]"); missing or empty means every island sells the row.
 */
const parseAllowedOnIslands = (value: unknown): number[] | null => {
  const list = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(list)) return null;
  const ids = list.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  return ids.length === 0 ? null : ids;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberField = (row: CatalogRow, key: string): number => {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const stringField = (row: CatalogRow, key: string): string => {
  const value = row[key];
  return typeof value === 'string' ? value : '';
};

/** Turn catalog keys like BREEDING_STRUCTURE into "Breeding Structure". */
export function prettifyKey(name: string): string {
  const spaced = name.toLowerCase().replaceAll('_', ' ');
  return spaced
    .split(' ')
    .map((word) => (word.length > 0 ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word))
    .join(' ');
}

/**
 * db_island_v2 only ships localization keys (ISLAND_18, ISLAND_UNDERLING...).
 * Names are the game's own English strings (data/text/en.utf8), matched to
 * ids by each island's resident monsters plus its torch/castle art (e.g.
 * id 18 uses tiki_Light, id 25's castle is STRUCTURE_NUCLEUS = "Nexus
 * Nucleus"). Keyed by island_type so variants share their base island.
 */
const ISLAND_TYPES: ReadonlyMap<number, Omit<IslandInfo, 'marketMonsterIds'>> = new Map<number, Omit<IslandInfo, 'marketMonsterIds'>>([
  [1, { name: 'Plant Island', group: 'natural' }],
  [2, { name: 'Cold Island', group: 'natural' }],
  [3, { name: 'Air Island', group: 'natural' }],
  [4, { name: 'Water Island', group: 'natural' }],
  [5, { name: 'Earth Island', group: 'natural' }],
  [6, { name: 'Gold Island', group: 'special' }],
  [7, { name: 'Ethereal Island', group: 'ethereal' }],
  [8, { name: 'Shugabush Island', group: 'natural' }],
  [9, { name: 'Tribal Island', group: 'special' }],
  [10, { name: 'Wublin Island', group: 'special' }],
  [11, { name: 'Composer Island', group: 'special' }],
  [12, { name: 'Celestial Island', group: 'special' }],
  [13, { name: 'Fire Haven', group: 'fire' }],
  [14, { name: 'Fire Oasis', group: 'fire' }],
  [15, { name: 'Psychic Island', group: 'magical' }],
  [16, { name: 'Faerie Island', group: 'magical' }],
  [17, { name: 'Bone Island', group: 'magical' }],
  [18, { name: 'Light Island', group: 'magical' }],
  [19, { name: 'Magical Sanctum', group: 'magical' }],
  [20, { name: 'The Colossingum', group: 'special' }],
  [21, { name: 'Seasonal Shanty', group: 'special' }],
  [22, { name: 'Amber Island', group: 'fire' }],
  [23, { name: 'Mythical Island', group: 'special' }],
  [24, { name: 'Ethereal Workshop', group: 'ethereal' }],
  [25, { name: 'Magical Nexus', group: 'magical' }],
  [26, { name: 'Plasma Islet', group: 'ethereal' }],
  [27, { name: 'Mech Islet', group: 'ethereal' }],
  [28, { name: 'Shadow Islet', group: 'ethereal' }],
  [29, { name: 'Crystal Islet', group: 'ethereal' }],
  [31, { name: 'Paironormal Carnival', group: 'special' }],
  [32, { name: 'bbli$zard Island', group: 'special' }],
]);

/**
 * Resolve an island variant to its in-game name. Mirror variants (catalog
 * name ends in _MIRROR, e.g. id 118 = ISLAND_18_MIRROR) are named the way
 * the game does ("Mirror Light Island"); other variants such as the extra
 * Composer slots (106-109) reuse their base island's name. Unknown future
 * ids fall back to the prettified key rather than a guessed name.
 */
export function describeIsland(catalogName: string, islandId: number, islandTypeId: number): IslandInfo {
  const isMirror = catalogName.endsWith('_MIRROR');
  const base = ISLAND_TYPES.get(islandTypeId) ?? ISLAND_TYPES.get(islandId);
  if (base === undefined) {
    return {
      name: prettifyKey(catalogName === '' ? `ISLAND_${String(islandId)}` : catalogName),
      group: isMirror ? 'mirror' : 'special',
      marketMonsterIds: [],
    };
  }
  return isMirror
    ? { name: `Mirror ${base.name}`, group: 'mirror', marketMonsterIds: [] }
    : { ...base, marketMonsterIds: [] };
}

function loadRows(catalogsDir: string, file: string): CatalogRow[] {
  const path = join(catalogsDir, file);
  if (!existsSync(path)) {
    throw new Error(
      `missing catalog ${path} — run "node fetch-catalogs.mjs" first`,
    );
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? parsed.map(catalogRow) : [];
}

/** Newer optional catalogs must not break setups that haven't fetched them. */
function loadOptionalRows(catalogsDir: string, file: string): CatalogRow[] {
  return existsSync(join(catalogsDir, file)) ? loadRows(catalogsDir, file) : [];
}

/**
 * db_card_albums/db_card_album_store_items ship localization keys
 * (CARD_ALBUM_3_PAGE_1, CARD_ALBUM_STORE_ITEM_02) instead of display
 * names; the trailing number is the label the dashboard shows.
 */
const catalogKeyLabel = (key: string, fallbackPrefix: string, fallbackId: number): string => {
  const match = /(\d+)$/.exec(key);
  return match === null ? `${fallbackPrefix} ${String(fallbackId)}` : `${fallbackPrefix} ${match[1]}`;
};

export function loadCatalogs(catalogsDir: string): Catalogs {
  const monsters = new Map<number, string>();
  const monsterPortraits = new Map<number, string>();
  const monsterGraphics = new Map<number, MonsterGraphic>();
  const marketMonsters = new Map<number, MonsterMarketInfo>();
  const timeToFillMs = new Map<number, number>();
  for (const row of loadRows(catalogsDir, 'db_monster.json')) {
    const monsterId = numberField(row, 'monster_id');
    monsters.set(monsterId, stringField(row, 'common_name') || stringField(row, 'name'));
    const portrait = stringField(row, 'portrait_graphic');
    if (portrait !== '') {
      monsterPortraits.set(monsterId, portrait);
    }
    const fillSec = numberField(row, 'time_to_fill_sec');
    if (fillSec > 0) timeToFillMs.set(monsterId, fillSec * 1000);
    // Every row is kept, not just view_in_market=1: Amber Island vessels
    // and other limited-time offers are db_monster rows the market only
    // lists while an EntityStoreAvailability event covers their entity.
    marketMonsters.set(monsterId, {
      id: monsterId,
      name: stringField(row, 'common_name') || stringField(row, 'name'),
      costCoins: numberField(row, 'cost_coins'),
      costDiamonds: numberField(row, 'cost_diamonds'),
      costKeys: numberField(row, 'cost_keys'),
      costRelics: numberField(row, 'cost_relics'),
      costStarpower: numberField(row, 'cost_starpower'),
      costEthCurrency: numberField(row, 'cost_eth_currency'),
      costMedals: numberField(row, 'cost_medals'),
      level: numberField(row, 'level'),
      buildTimeMs: numberField(row, 'build_time') * 1000,
      beds: numberField(row, 'beds'),
      entityId: numberField(row, 'entity_id'),
      viewInMarket: numberField(row, 'view_in_market') === 1,
      timeAvailability: numberField(row, 'time_availability'),
    });
    const graphic = catalogRow(row.graphic);
    monsterGraphics.set(monsterId, {
      file: stringField(graphic, 'file'),
      anim: stringField(graphic, 'anim'),
      sizeX: numberField(row, 'size_x') || 1,
      sizeY: numberField(row, 'size_y') || 1,
    });
  }

  const structures = new Map<number, {
    name: string;
    prettyName: string;
    structureType: string;
    /** Footprint in island grid cells (drawn by the island map). */
    sizeX: number;
    sizeY: number;
    /** Mine fill window in ms, from the catalog's extra.time (minutes):
     *  the regular Mine is 720 min (12h), the Mini Mine 1380 min (23h).
     *  0 for anything that is not a mine. */
    mineFillMs: number;
    /** Graphic descriptor (xml_bin/*.bin) + body animation name, used to
     * resolve the structure's sprite for the island map. */
    graphicFile: string;
    anim: string;
    yOffset: number;
    /** Store fields (the in-game market's own data): coin/diamond/eth costs. */
    costCoins: number;
    costDiamonds: number;
    costEthCurrency: number;
    /** Player level required before the market sells it. */
    level: number;
    /** 1 when the market lists this row. */
    viewInMarket: boolean;
    sellable: boolean;
    /** Global entity id; requirements reference these (upgrade chains). */
    entityId: number;
    /** Next tier's structure id (castle/structure upgrades), 0 when final. */
    upgradesTo: number;
    /** Build time in ms; the structure needs gs_finish_structure after it. */
    buildTimeMs: number;
    /** Prerequisite entity ids (own these before buying — upgrade tiers). */
    requirements: number[];
    allowedOnIslands: number[] | null;
  }>();
  for (const row of loadRows(catalogsDir, 'db_structure.json')) {
    const name = stringField(row, 'name');
    const extra = typeof row.extra === 'object' && row.extra !== null ? row.extra as CatalogRow : {};
    const graphic = typeof row.graphic === 'object' && row.graphic !== null ? row.graphic as CatalogRow : {};
    structures.set(numberField(row, 'structure_id'), {
      name,
      prettyName: prettifyKey(name === '' ? 'unknown structure' : name),
      structureType: stringField(row, 'structure_type'),
      sizeX: numberField(row, 'size_x') || 1,
      sizeY: numberField(row, 'size_y') || 1,
      mineFillMs: numberField(extra, 'time') * 60 * 1000,
      graphicFile: stringField(graphic, 'file'),
      anim: stringField(graphic, 'anim'),
      yOffset: numberField(row, 'y_offset'),
      costCoins: numberField(row, 'cost_coins'),
      costDiamonds: numberField(row, 'cost_diamonds'),
      costEthCurrency: numberField(row, 'cost_eth_currency'),
      level: numberField(row, 'level'),
      viewInMarket: numberField(row, 'view_in_market') === 1,
      sellable: numberField(row, 'sellable') === 1,
      entityId: numberField(row, 'entity_id'),
      upgradesTo: numberField(row, 'upgrades_to'),
      buildTimeMs: numberField(row, 'build_time') * 1000,
      requirements: (Array.isArray(row.requirements) ? row.requirements : [])
        .map(catalogRow)
        .map((req) => numberField(req, 'entity'))
        .filter((entity) => entity > 0),
      // allowed_on_island is a JSON-encoded id array; rows without it (the
      // base decorations) are sold on every island.
      allowedOnIslands: parseAllowedOnIslands(row.allowed_on_island),
    });
  }

  const islands = new Map<number, IslandInfo>();
  const islandGraphics = new Map<number, IslandGraphic>();
  const islandSongs = new Map<number, IslandSongCatalog>();
  for (const row of loadRows(catalogsDir, 'db_island_v2.json')) {
    const islandId = numberField(row, 'island_id');
    // db_island_v2 repeats rows (it ignores chunk cursors), so keep the first.
    if (!islands.has(islandId)) {
      const islandTypeId = numberField(row, 'island_type') || islandId;
      const info = describeIsland(stringField(row, 'name'), islandId, islandTypeId);
      // The per-island monster list is what the market's Monster tab sells
      // there (common/rare/epic rows for that island, in game order).
      info.marketMonsterIds = (Array.isArray(row.monsters) ? row.monsters : [])
        .map(catalogRow)
        .map((entry) => numberField(entry, 'monster'))
        .filter((id) => id > 0);
      islands.set(islandId, info);
      const instrumentMap = (entries: unknown, key: string) => new Map(
        (Array.isArray(entries) ? entries : []).map(catalogRow)
          .map((entry): [number, string] => [numberField(entry, key), stringField(entry, 'instrument')])
          .filter(([id, file]) => id > 0 && file !== ''),
      );
      islandSongs.set(islandId, { midi: stringField(row, 'midi'),
        monsters: instrumentMap(row.monsters, 'monster'), structures: instrumentMap(row.structures, 'structure') });
      const graphic = catalogRow(row.graphic);
      islandGraphics.set(islandId, {
        sceneFile: stringField(graphic, 'file'),
        tilesetFile: stringField(graphic, 'tileset'),
        gridFile: stringField(row, 'grid'),
        sky: stringField(graphic, 'bg'),
      });
    }
  }

  const foods: FoodInfo[] = loadRows(catalogsDir, 'db_bakery_foods.json')
    .map((row): FoodInfo => {
      const label = stringField(row, 'label');
      return {
        id: numberField(row, 'id'),
        // BAKING_CUPCAKES -> "Cupcakes"; seasonal tiers keep their suffix.
        name: prettifyKey(label.replace(/^BAKING_/, '').replace(/_\d+$/, '')),
        cost: numberField(row, 'cost'),
        timeMs: numberField(row, 'time') * 1000,
        food: numberField(row, 'food'),
        alwaysAvail: numberField(row, 'always_avail') === 1,
      };
    })
    .sort((a, b) => a.timeMs - b.timeMs || a.cost - b.cost);

  // db_reward_tracks drives the encore/clubbox-hype progress bars; a track's
  // name says which activity it rewards ("Encore Baking", "Clubbox Hype ...").
  const rewardTracks = new Map<number, RewardTrackInfo>();
  for (const row of loadOptionalRows(catalogsDir, 'db_reward_tracks.json')) {
    rewardTracks.set(numberField(row, 'id'), {
      id: numberField(row, 'id'),
      name: stringField(row, 'name'),
      levels: (Array.isArray(row.levels) ? row.levels : [])
        .map(catalogRow)
        .map((level): RewardTrackLevel => ({
          level: numberField(level, 'level'),
          points: numberField(level, 'points'),
          note: stringField(level, 'note'),
        }))
        .sort((a, b) => a.level - b.level),
    });
  }

  const clubboxActs = new Map<number, ClubboxActInfo>();
  for (const row of loadOptionalRows(catalogsDir, 'db_clubbox_acts.json')) {
    const data = typeof row.data === 'object' && row.data !== null ? row.data as CatalogRow : {};
    clubboxActs.set(numberField(row, 'id'), {
      id: numberField(row, 'id'),
      rewardTrackId: numberField(data, 'reward_track_id'),
    });
  }

  // Sticker-book catalogs (db_cards / db_card_albums /
  // db_card_album_store_items, all optional until fetch-store-catalogs.mjs
  // runs). Cards carry only rarity client-side; page card lists and pack
  // contents arrive as JSON-encoded id arrays.
  const cards = new Map<number, CardInfo>();
  for (const row of loadOptionalRows(catalogsDir, 'db_cards.json')) {
    cards.set(numberField(row, 'id'), {
      id: numberField(row, 'id'),
      rarity: numberField(row, 'rarity'),
    });
  }

  const cardAlbums = new Map<number, CardAlbumInfo>();
  for (const row of loadOptionalRows(catalogsDir, 'db_card_albums.json')) {
    const pages = (Array.isArray(row.pages) ? row.pages : [])
      .map(catalogRow)
      .map((page): CardAlbumPageInfo => {
        const data = typeof page.data === 'string' ? page.data : '{}';
        let key = '';
        try {
          const parsed: unknown = JSON.parse(data);
          key = isRecord(parsed) && typeof parsed.name === 'string' ? parsed.name : '';
        } catch {
          key = '';
        }
        const cardList: unknown = typeof page.cards === 'string' ? JSON.parse(page.cards) : [];
        return {
          id: numberField(page, 'id'),
          // Page ids are global across albums (34..51 for album 3); the
          // key's trailing number is the page number the game shows.
          name: catalogKeyLabel(key, 'Page', numberField(page, 'id')),
          cardIds: Array.isArray(cardList) ? cardList.filter((id): id is number => typeof id === 'number') : [],
          rewards: stringField(page, 'rewards'),
        };
      })
      // localeCompare with numeric:true keeps Page 2 before Page 10.
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    cardAlbums.set(numberField(row, 'id'), { id: numberField(row, 'id'), pages });
  }

  const cardPackItems: CardPackStoreItem[] = loadOptionalRows(catalogsDir, 'db_card_album_store_items.json')
    .map((row): CardPackStoreItem => {
      const data = stringField(row, 'data');
      let key = '';
      try {
        const parsed: unknown = JSON.parse(data === '' ? '{}' : data);
        key = isRecord(parsed) && typeof parsed.name === 'string' ? parsed.name : '';
      } catch {
        key = '';
      }
      return {
        id: numberField(row, 'id'),
        name: catalogKeyLabel(key, 'Pack', numberField(row, 'id')),
        cost: numberField(row, 'cost'),
        contents: stringField(row, 'contents'),
      };
    })
    .sort((a, b) => a.cost - b.cost);

  return {
    monsters,
    monsterPortraits,
    monsterGraphics,
    structures,
    islands,
    islandGraphics,
    islandSongs,
    foods,
    rewardTracks,
    clubboxActs,
    cards,
    cardAlbums,
    cardPackItems,
    marketMonsters,
    timeToFillMs,
  };
}

/** Default catalog dir next to the msm-state package (../../catalogs from
 * this compiled file: dist/services -> dist -> msm-state -> msm-re). */
export function defaultCatalogsDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', '..', '..', 'catalogs');
}