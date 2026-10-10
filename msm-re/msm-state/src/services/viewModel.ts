/**
 * Builds the JSON the dashboard renders from the last gs_player payload
 * plus the content catalogs. All server epoch values are ms strings (SFS
 * longs); all countdown math happens against the server clock so client
 * clock skew never shows false "ready" states.
 */

import { ISLAND_GROUPS, type Catalogs, type FoodInfo, type IslandGroup, prettifyKey } from './catalogs.js';

/** A gs_player payload after sfsToJson: nested JSON primitives only. */
export type PlayerJson = Record<string, unknown>;

export type MonsterView = {
  userMonsterId: string;
  name: string;
  monsterName: string;
  monsterId: number;
  level: number;
  happiness: number;
  posX: number;
  posY: number;
  sizeX: number;
  sizeY: number;
  /** Per-instance scale the player set (1 unless resized by an event). */
  scale: number;
  inHotel: boolean;
  muted: boolean;
  flip: boolean;
  /** ms since the monster was last collected, or null if never. */
  sinceLastCollectionMs: number | null;
  /**
   * Present only for zap statues (Wublins, Celestials, Amber vessels):
   * the eggs the statue still accepts, grouped by monster id. Empty or
   * missing means it takes no eggs right now (awake Wublin, filled
   * Celestial phase, ...); the server still refuses gracefully if we
   * misjudge, so this is a UI hint, not a gate.
   *
   * On dormant Wublins and Amber vessels, gs_player does not ship fill,
   * so this list is the whole requirement set (not "still open" slots).
   */
  boxNeeds?: Array<{ monsterId: number; count: number; name: string }>;
  /** Present on statues: the zap lifecycle phase. */
  statueState?: StatueState;
  /** Present on statues: eggs the current phase requires in total. */
  boxTotal?: number;
  /**
   * Eggs already inside the statue, when gs_player reports them.
   * Omitted on dormant Wublins and Amber vessels: boxed_eggs is always
   * empty there even after zaps, so a 0 would be a lie.
   */
  boxFilled?: number;
  /**
   * False when fill is server-side only (dormant Wublins, Amber vessels).
   * Do not treat a missing boxFilled as "zero zapped".
   */
  boxFillKnown?: boolean;
  /**
   * Catalog fill-window length in ms (db_monster time_to_fill_sec).
   * Omitted when the species has no expiry (time_to_fill_sec <= 0).
   */
  boxFillMs?: number;
  /** Server epoch ms when the current fill period started (egg_timer_start). */
  eggTimerStartMs?: number;
  /** Server epoch ms when the current fill period ends, when both start and window are known. */
  boxExpiresAtMs?: number;
  /** ms remaining on the fill timer; 0 when expired. */
  boxExpiresInMs?: number;
  /** True when the fill timer has elapsed and zapped eggs will be refunded. */
  boxExpired?: boolean;
  /** Present on statues: the full grouped requirement list of the current phase. */
  boxRequirements?: Array<{ monsterId: number; count: number; name: string }>;
  /** True on Wublin statues: gs_box_add_egg needs underling=true for them. */
  isUnderling?: boolean;
  /**
   * Paironormal pairs only: the Major and Minor component monsters the
   * Multimodal entry fuses. Each is a full monster (own level, happiness,
   * hotel/mute state), tracked separately by the server under its own
   * user_monster_id.
   */
  modes?: MonsterModeView[];
};

/** Zap statue lifecycle: dormant (taking wake-up eggs), awake (collected at least once), evolving (evolution eggs). */
export type StatueState = 'dormant' | 'awake' | 'evolving';

export type MonsterModeView = {
  userMonsterId: string;
  monsterId: number;
  /** Catalog name, ending in "(Major)" or "(Minor)". */
  name: string;
  level: number;
  happiness: number;
  inHotel: boolean;
  muted: boolean;
  /**
   * The raw `a` flag: the component has been obtained. It is NOT the
   * displayed form — the server never echoes the island's mirror mode in
   * gs_player (the game client tracks it locally), and both components
   * of a complete pair carry a=1 at the same time.
   */
  active: boolean;
  /** False while the pair's second component has not been obtained yet. */
  placed: boolean;
};

export type StructureView = {
  userStructureId: string;
  structureId: number;
  name: string;
  structureType: string;
  isMine: boolean;
  isBreeding: boolean;
  isNursery: boolean;
  isBakery: boolean;
  isUpgrading: boolean;
  /** A breeding structure with a breeding in progress (or awaiting finish). */
  isOccupied: boolean;
  /** Mines only: whether the structure's fill window has elapsed. */
  mineReady: boolean;
  /** Mines only: ms until the mine can be collected (0 when ready). */
  mineFillsInMs: number;
  /** Mines only: this structure's fill window (12h Mine, 23h Mini Mine). */
  mineFillMs: number;
  /** Footprint in island grid cells, for the island map. */
  sizeX: number;
  sizeY: number;
  posX: number;
  posY: number;
  /** Per-instance scale the player set (1 unless resized by an event). */
  scale: number;
  /** Stored in the warehouse: positioned but not drawn on the island. */
  inWarehouse: boolean;
  flip: boolean;
  sinceLastCollectionMs: number | null;
};

export type BreedingView = {
  userBreedingId: string;
  /** The breeding structure this pair occupies. */
  userStructureId: string;
  monster1Name: string;
  monster2Name: string;
  newMonsterName: string;
  /** Catalog id of the expected egg; used to match zap statues. */
  newMonsterId: number;
  startedOnMs: number;
  completeOnMs: number;
  done: boolean;
  remainingMs: number;
};

export type EggView = {
  userEggId: string;
  monsterName: string;
  /** Catalog monster id; used to match this egg against zap statues. */
  monsterId: number;
  previousName: string | null;
  costumeEq: number;
  hatchesOnMs: number;
  laidOnMs: number;
  done: boolean;
  remainingMs: number;
};

export type BakingView = {
  userBakingId: string;
  /** The bakery structure this batch is baking in. */
  userStructureId: string;
  foodId: number;
  foodName: string;
  /** Treats this batch yields when collected. */
  foodCount: number;
  startedOnMs: number;
  completeOnMs: number;
  done: boolean;
  remainingMs: number;
};

export type IslandView = {
  userIslandId: string;
  islandVariantId: number;
  islandTypeId: number;
  name: string;
  group: IslandGroup;
  /** Paironormal Island: has the Major/Minor mirror toggle. */
  isPaironormal: boolean;
  /** The market as this island sees it (per-island stock + monsters). */
  store: StoreView;
  monsters: MonsterView[];
  structures: StructureView[];
  breeding: BreedingView[];
  eggs: EggView[];
  baking: BakingView[];
  likes: number;
};

export type PlayerSummaryView = {
  name: string;
  level: number;
  xp: number;
  coins: number;
  diamonds: number;
  food: number;
  keys: number;
  relics: number;
  starpower: number;
  etherealCurrency: number;
  eggWildcards: number;
  clubboxTokens: number;
  minigameTokens: number;
};

export type SummaryCounts = {
  islands: number;
  monsters: number;
  monstersCollectable: number;
  eggsReady: number;
  eggsTotal: number;
  breedingsReady: number;
  breedingsActive: number;
  mines: number;
  minesReady: number;
  bakingsReady: number;
  bakingsActive: number;
};

export type FoodOptionView = {
  id: number;
  name: string;
  cost: number;
  timeMs: number;
  food: number;
  alwaysAvail: boolean;
};

/**
 * The encore event currently running (weekend activity bonus). Progress
 * arrives as a fraction (current_encore_state.total_points, echoed by
 * action responses as encore_event.current_points) — the same value the
 * client's bar shows, so it is passed through unconverted.
 */
export type EncoreView = {
  /** Global timed-event id (matches current_encore_state.event_id). */
  eventId: number;
  /** Server-provided label ("Encore - Baking"). */
  name: string;
  /** 0..1 progress toward the next reward. */
  progress: number;
  rewardTrackId: number;
  rewardTrackName: string;
  /** True when the track restarts from level 1 after completing. */
  rollsOver: boolean;
  startOnMs: number;
  endsOnMs: number;
};

/** One Clubbox the player owns, with its accumulated hype. */
export type ClubboxView = {
  /** Catalog act id (db_clubbox_acts); -1 rows are "no clubbox" slots. */
  actId: number;
  /** Act name from the hype reward track ("Clubbox Hype (TPain)"), if known. */
  actName: string;
  /** Island the clubbox sits on, by name. */
  islandName: string | null;
  /** Current hype points. */
  hype: number;
  /** Best hype this clubbox reached. */
  topHype: number;
  startedOnMs: number | null;
};

/** A global timed event worth showing (encore, sales, seasonal events...). */
export type TimedEventView = {
  id: number;
  eventType: string;
  label: string;
  startOnMs: number;
  endsOnMs: number;
  active: boolean;
};

/** One purchasable row of the in-game market (db_structure view_in_market=1). */
export type StoreItemView = {
  structureId: number;
  name: string;
  structureType: string;
  /** True for the decorations section; false for functional structures. */
  isDecoration: boolean;
  sizeX: number;
  sizeY: number;
  costCoins: number;
  costDiamonds: number;
  /** Shard price (ethereal islands price things in this instead of coins). */
  costEthCurrency: number;
  /** Player level the market requires; the server enforces it too. */
  level: number;
  buildTimeMs: number;
  /** Prerequisite structure entity ids (upgrade-tier chains). */
  requirements: number[];
  levelOk: boolean;
  requirementsOk: boolean;
  /**
   * End of the EntityStoreAvailability window currently selling this
   * row (limited-time decorations); undefined when the row is a plain
   * view_in_market=1 item.
   */
  offerEndsMs?: number | undefined;
};

export type StoreView = {
  /** Structures and decorations this island's market sells. */
  items: StoreItemView[];
  /** Monsters this island's market sells (gs_buy_egg → nursery). */
  monsters: MonsterStoreItemView[];
};

/** One purchasable monster (db_monster view_in_market=1 for this island). */
export type MonsterStoreItemView = {
  monsterId: number;
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
  levelOk: boolean;
  /** Egg hatch time in ms. */
  buildTimeMs: number;
  /** Castle beds the hatched monster takes. */
  beds: number;
  /** True when time_availability is a limited window (e.g. seasonal). */
  limited: boolean;
  /**
   * End of the EntityStoreAvailability window currently selling this
   * monster (Amber Island vessels); undefined for always-available
   * market rows.
   */
  offerEndsMs?: number | undefined;
};

/** One album page's collection progress (a page of ten stickers). */
export type CardPageView = {
  pageId: number;
  name: string;
  /** Sticker ids this page wants. */
  cardIds: number[];
  /** How many of them the player owns. */
  collected: number;
  /** True when the page reward was already collected. */
  rewardClaimed: boolean;
  canClaim: boolean;
  /** JSON-encoded rewards ([{"type":"DIAMONDS","amount":25}]). */
  rewards: string;
};

/** A sticker pack instance waiting to be opened (gs_open_card_packs). */
export type PendingPackView = {
  /** Pack instance id — what gs_open_card_packs wants (NOT the type id). */
  id: number;
  /** Pack type 1..5 (common..legendary), for the rarity label. */
  type: number;
  /** Stickers the pack will reveal. */
  cards: number[];
};

/** The sticker book: account-wide, so it lives on the overview page. */
export type CardAlbumView = {
  albumId: number;
  /** Card currency the packs in the album's store cost. */
  currency: number;
  /** Card ids the player owns at least once. */
  collectedCardIds: number[];
  /** Total stickers owned beyond the first copy (pack fodder). */
  duplicates: number;
  pages: CardPageView[];
  /** True when every page is complete (album reward becomes claimable). */
  complete: boolean;
  /** Pack instances granted but not yet opened (buys or events). */
  pendingPacks: PendingPackView[];
  /** Sticker packs the album's store sells. */
  packs: Array<{ id: number; name: string; cost: number; contents: string }>;
};

export type EventsView = {
  encore: EncoreView | null;
  clubboxTokens: number;
  clubboxes: ClubboxView[];
  minigameTokens: number;
  /** Non-noise timed events, soonest-ending first. */
  timedEvents: TimedEventView[];
};

export type ApiState = {
  player: PlayerSummaryView | null;
  islands: IslandView[];
  /** Bakery recipes the dashboard offers, bake-time ascending. */
  foods: FoodOptionView[];
  /** Encore, clubbox, currencies and the global event schedule. */
  events: EventsView;
  /** Sticker book progress for the current card album, if any. */
  cardAlbum: CardAlbumView | null;
  summary: SummaryCounts;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Mines refill on a per-structure window that lives in the catalog's
 * extra.time: the regular Mine is 12h, the premium Plant Island variant
 * 12h too, and the Mini Mine 23h. The client's Mine class only exposes
 * elapsed time via the mineTime script call (sub_846E50/sub_C9CB50), so
 * this fallback only covers catalogs that lack the field.
 */
const MINE_FILL_FALLBACK_MS = 23 * 60 * 60 * 1000;

/** Wublin Island: its statues are "underlings" in the client's code. */
const ISLAND_TYPE_WUBLIN = 10;

/** Paironormal Island: each pair is a Multimodal with Major/Minor modes. */
const ISLAND_TYPE_PAIRONORMAL = 31;

/** Amber Island: its statues are vessels, bought as limited-time offers. */
const ISLAND_TYPE_AMBER = 22;

/**
 * Statue requirement fields usually arrive as JSON-encoded id arrays
 * (strings) even though every other collection in gs_player is a real
 * SFS array, because the server stores them as opaque strings. After a
 * zap the same field can instead be a typed SFS int-array, which
 * sfsToJson already turned into a JS number array — treat both shapes
 * as the same list so fill does not vanish on the next refresh.
 */
const parseIdEntry = (entry: unknown): number | undefined => {
  if (typeof entry === 'number' && Number.isInteger(entry)) return entry;
  if (typeof entry === 'string' && /^-?\d+$/.test(entry.trim())) return Number(entry);
  if (isRecord(entry)) {
    return parseIdEntry(entry.monster ?? entry.monster_id ?? entry.id);
  }
  return undefined;
};

const parseIdList = (value: unknown): number[] => {
  if (value === undefined || value === null) return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (value.trim() === '') return [];
    parsed = JSON.parse(value);
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry) => {
    const id = parseIdEntry(entry);
    return id === undefined ? [] : [id];
  });
};

/** boxed_eggs is present (dormant) regardless of string vs array encoding. */
const hasBoxedEggsField = (value: unknown): boolean => value !== undefined && value !== null;

/**
 * Eggs a statue still accepts, for the island types whose statues take
 * zapped eggs via gs_box_add_egg: Wublin Island (type 10, underlings),
 * Celestial Island (12) and Amber Island (22, vessels). Wubboxes placed
 * on regular islands also carry box_requirements, but those want boxed
 * adult monsters (gs_box_add_monster), so they are not zap targets here.
 *
 * Statue lifecycle, verified against live data: a Wublin/Celestial statue
 * that is still taking eggs carries boxed_eggs — even completely
 * untouched ones (Dwumrohl ships "[]") — and once it wakes up the
 * server drops the field entirely. The absence of boxed_eggs is
 * therefore the awake mark. last_collection must NOT be used for it:
 * dormant statues produce shards/coins on their own timer
 * (collection_type + random_underling_collection_min), so it is set on
 * both dormant and woken statues. Evolving statues (has_evolve_reqs)
 * are woken ones taking a second round of eggs; their phase list is
 * the evolution requirement.
 *
 * Fill contents are not the same across families. Celestials ship the
 * zapped ids in boxed_eggs (JSON string or, after a zap, a typed
 * int-array). Dormant Wublins ship boxed_eggs as an empty list even
 * after zaps — treating that empty list as "0 filled" or treating a
 * typed array as "awake" (field isn't a string) made queried fill
 * jump to none. Amber vessels never ship boxed_eggs at all, so every
 * box_requirements entry counts as still open, and a vessel drops
 * box_requirements the moment it completes (it becomes a regular
 * monster row named after the monster). The server refused live
 * egg-zaps into vessels with "Failed attempted egg replacement" even
 * for required species, so the dashboard offers the zap but the
 * server remains the gatekeeper.
 */
const ZAP_STATUE_ISLAND_TYPES: ReadonlySet<number> = new Set([10, 12, 22]);

type StatueInfo = {
  state: StatueState;
  /** Eggs the statue still accepts, grouped by monster id. */
  needs: Array<{ monsterId: number; count: number }>;
  /** Total eggs the current phase (wake-up or evolution) requires. */
  total: number;
  /** Eggs already inside the statue when fillKnown is true. */
  filled: number;
  /** False when gs_player does not report boxed contents for this family. */
  fillKnown: boolean;
  /** The full grouped requirement list of the current phase. */
  requirements: Array<{ monsterId: number; count: number }>;
};

const groupIds = (ids: number[]): Array<{ monsterId: number; count: number }> =>
  [...ids.reduce((acc, id) => acc.set(id, (acc.get(id) ?? 0) + 1), new Map<number, number>())]
    .map(([monsterId, count]) => ({ monsterId, count }));

const namedBoxCounts = (
  entries: Array<{ monsterId: number; count: number }>,
  catalogs: Catalogs,
): Array<{ monsterId: number; count: number; name: string }> =>
  entries.map((entry) => ({
    ...entry,
    name: catalogs.monsters.get(entry.monsterId) ?? `monster ${String(entry.monsterId)}`,
  }));

function statueNeeds(raw: Record<string, unknown>, islandTypeId: number): StatueInfo | undefined {
  if (!ZAP_STATUE_ISLAND_TYPES.has(islandTypeId)) return undefined;
  const requirements = parseIdList(raw.box_requirements);
  const evolveReqs = parseIdList(raw.has_evolve_reqs);
  if (requirements.length === 0 && evolveReqs.length === 0) return undefined;

  const evolving = evolveReqs.length > 0;
  const phase = evolving ? evolveReqs : requirements;
  // boxed_eggs presence = dormant (see the doc above); woken statues have
  // no box left, so their whole phase counts as filled. Presence is the
  // field itself, not "is a JSON string" — a typed int-array is still a box.
  const hasBox = hasBoxedEggsField(raw.boxed_eggs);
  const boxed = parseIdList(raw.boxed_eggs);
  let accepted: number[];
  if (islandTypeId === ISLAND_TYPE_AMBER) {
    // Vessels keep their fill server-side: no boxed_eggs is ever sent,
    // so every requirement stays open until the vessel completes and
    // the field disappears. Evolving (Crucible) phases are just as
    // invisible, so the same rule covers both phases.
    accepted = [...phase];
  } else if (!evolving && !hasBox) {
    accepted = [];
  } else {
    accepted = [...phase];
    for (const id of boxed) {
      const index = accepted.indexOf(id);
      if (index !== -1) accepted.splice(index, 1);
    }
  }

  const total = phase.length;
  const filled = total - accepted.length;
  // Wublin boxed_eggs stays "[]" (or []) even after zaps, so an empty box
  // is "fill unknown", not "zero zapped". Celestials do ship the ids.
  const fillKnown =
    islandTypeId === ISLAND_TYPE_AMBER
      ? false
      : islandTypeId === ISLAND_TYPE_WUBLIN
        ? boxed.length > 0 || (!hasBox && !evolving)
        : true;
  return {
    state: evolving ? 'evolving' : accepted.length === 0 && fillKnown ? 'awake' : 'dormant',
    needs: groupIds(accepted).filter((entry) => entry.count > 0),
    total,
    filled,
    fillKnown,
    requirements: groupIds(phase),
  };
}

/**
 * True for a Wublin/Celestial/vessel statue that is still taking eggs.
 * Collecting coins from those rows can reset boxed fill, so collect
 * batches skip them until they wake (boxed_eggs dropped) or the vessel
 * completes (box_requirements dropped).
 */
export function isDormantZapStatue(raw: Record<string, unknown>, islandTypeId: number): boolean {
  if (islandTypeId === ISLAND_TYPE_AMBER) {
    return parseIdList(raw.box_requirements).length > 0;
  }
  if (!ZAP_STATUE_ISLAND_TYPES.has(islandTypeId)) return false;
  if (hasBoxedEggsField(raw.boxed_eggs)) return true;
  return parseIdList(raw.has_evolve_reqs).length > 0;
}

/** Placed monsters that are safe to gs_collect_monster. */
export function isCollectableMonster(monster: MonsterView): boolean {
  return !monster.inHotel && monster.statueState !== 'dormant' && monster.statueState !== 'evolving';
}

/** SFS ints arrive as JSON numbers, longs as strings; accept both. */
const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const asBool = (value: unknown): boolean =>
  value === true || value === 1 || value === '1';

const numberOr = (value: unknown, fallback: number): number => asNumber(value) ?? fallback;

const epochMs = (value: unknown): number | null => {
  const parsed = asNumber(value);
  return parsed === null || parsed <= 0 ? null : parsed;
};

function statueTimer(
  raw: Record<string, unknown>,
  catalogs: Catalogs,
  monsterId: number,
  serverNowMs: number,
  state: StatueState,
): {
  boxFillMs?: number;
  eggTimerStartMs?: number;
  boxExpiresAtMs?: number;
  boxExpiresInMs?: number;
  boxExpired?: boolean;
} {
  if (state === 'awake') return {};
  const fillMs = catalogs.timeToFillMs.get(monsterId) ?? 0;
  const started = epochMs(raw.egg_timer_start);
  return {
    ...(fillMs > 0 ? { boxFillMs: fillMs } : {}),
    ...(started === null ? {} : { eggTimerStartMs: started }),
    ...(fillMs > 0 && started !== null
      ? {
          boxExpiresAtMs: started + fillMs,
          boxExpiresInMs: Math.max(0, started + fillMs - serverNowMs),
          boxExpired: serverNowMs >= started + fillMs,
        }
      : {}),
  };
}

function monsterView(
  raw: Record<string, unknown>,
  catalogs: Catalogs,
  serverNowMs: number,
  islandTypeId: number,
): MonsterView {
  const monsterId = numberOr(raw.monster, 0);
  const lastCollection = epochMs(raw.last_collection);
  const statue = statueNeeds(raw, islandTypeId);
  const modes = monsterModeViews(raw.modes, catalogs, monsterId);
  return {
    userMonsterId: asString(raw.user_monster_id) ?? '?',
    name: asString(raw.name) ?? '',
    monsterName: catalogs.monsters.get(monsterId) ?? `monster ${String(monsterId)}`,
    monsterId,
    level: numberOr(raw.level, 0),
    happiness: numberOr(raw.happiness, 0),
    posX: numberOr(raw.pos_x, 0),
    posY: numberOr(raw.pos_y, 0),
    sizeX: catalogs.monsterGraphics.get(monsterId)?.sizeX ?? 1,
    sizeY: catalogs.monsterGraphics.get(monsterId)?.sizeY ?? 1,
    scale: numberOr(raw.scale, 1) || 1,
    inHotel: asBool(raw.in_hotel),
    muted: asBool(raw.muted),
    flip: asBool(raw.flip),
    sinceLastCollectionMs: lastCollection === null ? null : Math.max(0, serverNowMs - lastCollection),
    ...(statue === undefined
      ? {}
      : {
          boxNeeds: namedBoxCounts(statue.needs, catalogs),
          statueState: statue.state,
          boxTotal: statue.total,
          boxFillKnown: statue.fillKnown,
          ...(statue.fillKnown ? { boxFilled: statue.filled } : {}),
          boxRequirements: namedBoxCounts(statue.requirements, catalogs),
          ...statueTimer(raw, catalogs, monsterId, serverNowMs, statue.state),
        }),
    ...(islandTypeId === ISLAND_TYPE_WUBLIN ? { isUnderling: true } : {}),
    ...(modes === undefined ? {} : { modes }),
  };
}

/**
 * Paironormal Multimodal rows carry their Major/Minor components in a
 * `modes` array; each entry is a user-monster record for one component
 * (index 0 = Major, 1 = Minor, matching the catalog's extra.modes order).
 * A component the player has not obtained yet arrives as a stub like
 * {"a":0} — kept with placed=false so the dashboard can say so.
 */
function monsterModeViews(
  rawModes: unknown,
  catalogs: Catalogs,
  parentMonsterId: number,
): MonsterModeView[] | undefined {
  const rows = Array.isArray(rawModes) ? rawModes : [];
  if (rows.length === 0) return undefined;
  const parentName = catalogs.monsters.get(parentMonsterId) ?? '';
  const baseName = parentName.replace(/\s*\(multi?modal\)$/i, '');
  return rows.map((raw, index): MonsterModeView => {
    const record = (raw ?? {}) as Record<string, unknown>;
    const modeMonsterId = numberOr(record.monster, 0);
    const slotName = index === 0 ? `${baseName} (Major)` : `${baseName} (Minor)`;
    return {
      userMonsterId: asString(record.user_monster_id) ?? '?',
      monsterId: modeMonsterId,
      name: modeMonsterId === 0 ? slotName : catalogs.monsters.get(modeMonsterId) ?? slotName,
      level: numberOr(record.level, 0),
      happiness: numberOr(record.happiness, 0),
      inHotel: asBool(record.in_hotel),
      muted: asBool(record.muted),
      active: asBool(record.a),
      placed: modeMonsterId !== 0,
    };
  });
}

function structureView(
  raw: Record<string, unknown>,
  catalogs: Catalogs,
  serverNowMs: number,
  occupiedStructureIds: ReadonlySet<string>,
): StructureView {
  const structureId = numberOr(raw.structure, 0);
  const catalog = catalogs.structures.get(structureId);
  const structureType = catalog?.structureType ?? 'unknown';
  const lastCollection = epochMs(raw.last_collection);
  const userStructureId = asString(raw.user_structure_id) ?? '?';
  const isMine = structureType === 'mine' || /mine/i.test(catalog?.name ?? '');
  const sinceLastCollectionMs = lastCollection === null ? null : Math.max(0, serverNowMs - lastCollection);
  // Fill window is per structure: Plant Island's Mine is 12h, the Mini
  // Mine elsewhere is 23h (both from db_structure extra.time).
  const mineFillMs = isMine ? (catalog?.mineFillMs ?? 0) || MINE_FILL_FALLBACK_MS : 0;
  return {
    userStructureId,
    structureId,
    name: catalog?.prettyName ?? `structure ${String(structureId)}`,
    structureType,
    isMine,
    isBreeding: structureType === 'breeding',
    isNursery: structureType === 'nursery',
    isBakery: structureType === 'bakery' || /bakery/i.test(catalog?.name ?? ''),
    isUpgrading: asBool(raw.is_upgrading),
    isOccupied: occupiedStructureIds.has(userStructureId),
    mineReady: isMine && (sinceLastCollectionMs === null || sinceLastCollectionMs >= mineFillMs),
    mineFillsInMs: isMine
      ? Math.max(0, mineFillMs - (sinceLastCollectionMs ?? mineFillMs))
      : 0,
    mineFillMs,
    sizeX: catalog?.sizeX ?? 1,
    sizeY: catalog?.sizeY ?? 1,
    posX: numberOr(raw.pos_x, 0),
    posY: numberOr(raw.pos_y, 0),
    scale: numberOr(raw.scale, 1) || 1,
    inWarehouse: asBool(raw.in_warehouse),
    flip: asBool(raw.flip),
    sinceLastCollectionMs,
  };
}

function breedingView(raw: Record<string, unknown>, catalogs: Catalogs, serverNowMs: number): BreedingView {
  const completeOn = numberOr(raw.complete_on, serverNowMs);
  const monsterName = (id: unknown): string => {
    const monsterId = asNumber(id);
    return monsterId === null ? '?' : catalogs.monsters.get(monsterId) ?? `monster ${String(monsterId)}`;
  };
  return {
    userBreedingId: asString(raw.user_breeding_id) ?? '?',
    userStructureId: asString(raw.structure) ?? '?',
    monster1Name: monsterName(raw.monster_1),
    monster2Name: monsterName(raw.monster_2),
    newMonsterName: monsterName(raw.new_monster),
    newMonsterId: numberOr(raw.new_monster, 0),
    startedOnMs: numberOr(raw.started_on, serverNowMs),
    completeOnMs: completeOn,
    done: serverNowMs >= completeOn,
    remainingMs: Math.max(0, completeOn - serverNowMs),
  };
}

function eggView(raw: Record<string, unknown>, catalogs: Catalogs, serverNowMs: number): EggView {
  const hatchesOn = numberOr(raw.hatches_on, serverNowMs);
  const monsterId = numberOr(raw.monster, 0);
  const costume = isRecord(raw.costume) ? numberOr(raw.costume.eq, 0) : 0;
  return {
    userEggId: asString(raw.user_egg_id) ?? '?',
    monsterName: catalogs.monsters.get(monsterId) ?? `monster ${String(monsterId)}`,
    monsterId,
    previousName: asString(raw.previous_name),
    costumeEq: costume,
    hatchesOnMs: hatchesOn,
    laidOnMs: numberOr(raw.laid_on, serverNowMs),
    done: serverNowMs >= hatchesOn,
    remainingMs: Math.max(0, hatchesOn - serverNowMs),
  };
}

/**
 * A bake job, from the island's `baking` list. Field names come from a
 * live gs_start_baking probe: the recipe is `food_option_id` in state
 * (but `food_id` on the request) and the finish time is `finished_at`.
 */
function bakingView(raw: Record<string, unknown>, foodsById: ReadonlyMap<number, FoodInfo>, serverNowMs: number): BakingView {
  const foodId = numberOr(raw.food_option_id, -1);
  const completeOn = numberOr(raw.finished_at, serverNowMs);
  const info = foodsById.get(foodId);
  return {
    userBakingId: asString(raw.user_baking_id) ?? '?',
    userStructureId: asString(raw.user_structure) ?? '?',
    foodId,
    foodName: info?.name ?? `treat ${String(foodId)}`,
    foodCount: numberOr(raw.food_count, info?.food ?? 0),
    startedOnMs: numberOr(raw.started_at, serverNowMs),
    completeOnMs: completeOn,
    done: serverNowMs >= completeOn,
    remainingMs: Math.max(0, completeOn - serverNowMs),
  };
}

const rowsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

/**
 * EntityStoreAvailability timed events are what turn limited-time rows
 * (Amber Island vessels, seasonal decoration packs) into sellable store
 * items: each data row names a global entity id, and the item is
 * purchasable for the whole start/end span. Overlapping windows for the
 * same entity are collapsed to the latest end so the countdown the
 * dashboard shows is how long the offer can actually last.
 */
function activeEntityOffers(
  rows: Record<string, unknown>[],
  serverNowMs: number,
): Map<number, number> {
  return rows.reduce((offers, row) => {
    if (asString(row.event_type) !== 'EntityStoreAvailability') return offers;
    const start = epochMs(row.start_date);
    const end = epochMs(row.end_date);
    if (start === null || end === null || serverNowMs < start || serverNowMs >= end) return offers;
    for (const entry of rowsOf(row.data)) {
      const entity = asNumber(entry.entity);
      if (entity === null) continue;
      offers.set(entity, Math.max(offers.get(entity) ?? 0, end));
    }
    return offers;
  }, new Map<number, number>());
}

/**
 * The market as this island sees it: db_structure rows with
 * view_in_market=1 whose allowed_on_island includes the island (mirrors
 * share their base island's market — the catalog never lists the mirror
 * variant ids themselves), plus the island's own monster rows from
 * db_island_v2. Rows outside view_in_market appear only while an
 * EntityStoreAvailability window sells them (Amber vessels, seasonal
 * decorations), and carry that window's end for a countdown. Functional
 * structures first, then decorations by coin price, monsters by name.
 * The level and prerequisite flags are hints for the UI — the server
 * enforces both, so a Buy on a locked row just fails gracefully.
 */
function buildStore(
  catalogs: Catalogs,
  playerLevel: number,
  ownedEntityIds: ReadonlySet<number>,
  islandVariantId: number,
  islandTypeId: number,
  offersByEntity: ReadonlyMap<number, number>,
): StoreView {
  // Mirror variants (101+) sell their base island's stock.
  const marketVariantId = islandVariantId >= 101 ? islandTypeId : islandVariantId;
  const items: StoreItemView[] = [...catalogs.structures.entries()]
    .filter(([, structure]) => {
      const offered = structure.viewInMarket || offersByEntity.has(structure.entityId);
      return (
        offered &&
        (structure.allowedOnIslands === null || structure.allowedOnIslands.includes(marketVariantId))
      );
    })
    .map(([structureId, structure]): StoreItemView => ({
      structureId,
      name: structure.prettyName,
      structureType: structure.structureType,
      isDecoration: structure.structureType === 'decoration',
      sizeX: structure.sizeX,
      sizeY: structure.sizeY,
      costCoins: structure.costCoins,
      costDiamonds: structure.costDiamonds,
      costEthCurrency: structure.costEthCurrency,
      level: structure.level,
      buildTimeMs: structure.buildTimeMs,
      requirements: structure.requirements,
      levelOk: structure.level <= playerLevel,
      requirementsOk: structure.requirements.every((entity) => ownedEntityIds.has(entity)),
      offerEndsMs: offersByEntity.get(structure.entityId),
    }));
  const monsters = (catalogs.islands.get(islandVariantId)?.marketMonsterIds ?? [])
    .map((monsterId) => catalogs.marketMonsters.get(monsterId))
    .filter((monster): monster is NonNullable<typeof monster> => monster !== undefined)
    .filter((monster) => monster.viewInMarket || offersByEntity.has(monster.entityId))
    .map((monster): MonsterStoreItemView => ({
      monsterId: monster.id,
      name: monster.name,
      costCoins: monster.costCoins,
      costDiamonds: monster.costDiamonds,
      costKeys: monster.costKeys,
      costRelics: monster.costRelics,
      costStarpower: monster.costStarpower,
      costEthCurrency: monster.costEthCurrency,
      costMedals: monster.costMedals,
      level: monster.level,
      levelOk: monster.level <= playerLevel,
      buildTimeMs: monster.buildTimeMs,
      beds: monster.beds,
      limited: monster.timeAvailability !== 255,
      offerEndsMs: offersByEntity.get(monster.entityId),
    }));
  return {
    items: items.sort(
      (a, b) =>
        Number(a.isDecoration) - Number(b.isDecoration) ||
        (a.costCoins || a.costEthCurrency) - (b.costCoins || b.costEthCurrency) ||
        a.name.localeCompare(b.name),
    ),
    monsters: monsters.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Sticker-book view for the album the player currently has open
 * (state.last_card_album). Progress comes from the account-wide
 * card_albums row; page definitions from db_card_albums.
 */
function buildCardAlbum(playerObject: PlayerJson, catalogs: Catalogs): CardAlbumView | null {
  const albumId = numberOr(playerObject.last_card_album, 0);
  const albumRow = rowsOf(playerObject.card_albums).find((row) => numberOr(row.card_album_id, 0) === albumId);
  const albumCatalog = catalogs.cardAlbums.get(albumId);
  if (albumRow === undefined || albumCatalog === undefined) return null;
  const data = isRecord(albumRow.data) ? albumRow.data : {};
  const stickers = rowsOf(data.cards);
  const collected = new Map<number, number>();
  for (const sticker of stickers) {
    collected.set(numberOr(sticker.i, 0), numberOr(sticker.n, 0));
  }
  const claimedPages = new Set<number>(
    (Array.isArray(data.page_rewards_collected) ? data.page_rewards_collected : [])
      .map((id) => asNumber(id))
      .filter((id): id is number => id !== null),
  );
  // data.packs rows are granted-but-unopened pack instances ({c: cards,
  // t: type, i: instance id}); the buy response only echoes pack TYPE ids,
  // so these instance ids are the only valid input to gs_open_card_packs.
  const pendingPacks: PendingPackView[] = rowsOf(data.packs).map((pack) => ({
    id: numberOr(pack.i, 0),
    type: numberOr(pack.t, 0),
    cards: (Array.isArray(pack.c) ? pack.c : [])
      .map((card) => asNumber(card))
      .filter((card): card is number => card !== null),
  }));
  const pages: CardPageView[] = albumCatalog.pages.map((page) => {
    const have = page.cardIds.filter((id) => collected.has(id)).length;
    const rewardClaimed = claimedPages.has(page.id);
    return {
      pageId: page.id,
      name: page.name,
      cardIds: page.cardIds,
      collected: have,
      rewardClaimed,
      canClaim: have === page.cardIds.length && !rewardClaimed,
      rewards: page.rewards,
    };
  });
  return {
    albumId,
    currency: numberOr(data.currency, 0),
    collectedCardIds: [...collected.keys()],
    duplicates: [...collected.values()].reduce((acc, count) => acc + Math.max(0, count - 1), 0),
    pages,
    complete: pages.length > 0 && pages.every((page) => page.rewardClaimed || page.collected === page.cardIds.length),
    pendingPacks,
    packs: catalogs.cardPackItems.map((pack) => ({ id: pack.id, name: pack.name, cost: pack.cost, contents: pack.contents })),
  };
}

/**
 * Build the events view from the raw player state plus the timed-event
 * definitions the session captured from gs_timed_events. Costume
 * availability events are skipped: there are dozens per week and the
 * costume shop itself is out of scope for the dashboard.
 */
function buildEvents(
  playerObject: PlayerJson,
  catalogs: Catalogs,
  timedEventRows: Record<string, unknown>[],
  islandNames: ReadonlyMap<string, string>,
  serverNowMs: number,
): EventsView {
  const timedEvents: TimedEventView[] = timedEventRows
    .map((raw): TimedEventView | null => {
      const eventType = asString(raw.event_type) ?? '';
      const data = rowsOf(raw.data);
      if (eventType === 'CostumeAvailability') return null;
      return {
        id: numberOr(raw.id, 0),
        eventType,
        label: asString(data[0]?.label) ?? prettifyKey(eventType),
        startOnMs: numberOr(raw.start_date, serverNowMs),
        endsOnMs: numberOr(raw.end_date, serverNowMs),
        active: serverNowMs >= numberOr(raw.start_date, serverNowMs) && serverNowMs < numberOr(raw.end_date, serverNowMs),
      };
    })
    .filter((event): event is TimedEventView => event !== null)
    .sort((a, b) => a.endsOnMs - b.endsOnMs)
    // Anniversary-month style sales repeat one row per entity; one line
    // per label is what the dashboard wants, keeping the soonest end.
    .filter((event, index, all) => all.findIndex((other) => other.eventType === event.eventType && other.label === event.label) === index);

  const encoreState = isRecord(playerObject.current_encore_state) ? playerObject.current_encore_state : undefined;
  const encoreEventId = encoreState === undefined ? 0 : Number(asString(encoreState.event_id) ?? numberOr(encoreState.event_id, 0));
  const encoreDef = encoreEventId === 0
    ? undefined
    : timedEventRows.find((raw) => numberOr(raw.id, -1) === encoreEventId);
  let encore: EncoreView | null = null;
  if (encoreDef !== undefined && encoreState !== undefined) {
    const data = rowsOf(encoreDef.data)[0] ?? {};
    const rewardTrackId = numberOr(data.reward_track_id, 0);
    encore = {
      eventId: encoreEventId,
      name: asString(data.label) ?? 'Encore event',
      progress: Math.max(0, Math.min(1, numberOr(encoreState.total_points, 0))),
      rewardTrackId,
      rewardTrackName: catalogs.rewardTracks.get(rewardTrackId)?.name ?? `track ${String(rewardTrackId)}`,
      rollsOver: numberOr(data.rolls_over, 0) === 1 || data.rolls_over === true,
      startOnMs: numberOr(encoreDef.start_date, serverNowMs),
      endsOnMs: numberOr(encoreDef.end_date, serverNowMs),
    };
  }

  const clubboxes: ClubboxView[] = rowsOf(playerObject.clubboxes)
    .map((raw): ClubboxView | null => {
      const actId = numberOr(raw.act, -1);
      const data = isRecord(raw.clubbox_data) ? raw.clubbox_data : {};
      // act -1 is a "no clubbox here" slot, not something to display.
      if (actId < 0) return null;
      const act = catalogs.clubboxActs.get(actId);
      const startedAt = numberOr(data.started_at, 0);
      return {
        actId,
        actName: act === undefined ? `Act ${String(actId)}` : catalogs.rewardTracks.get(act.rewardTrackId)?.name ?? `Act ${String(actId)}`,
        islandName: islandNames.get(asString(data.island) ?? '') ?? null,
        hype: numberOr(data.hype, 0),
        topHype: numberOr(data.top_hype, 0),
        startedOnMs: startedAt > 0 ? startedAt : null,
      };
    })
    .filter((box): box is ClubboxView => box !== null);

  return {
    encore,
    clubboxTokens: numberOr(playerObject.clubbox_tokens_actual, 0),
    clubboxes,
    minigameTokens: numberOr(playerObject.minigame_tokens_actual, 0),
    timedEvents,
  };
}

export function buildApiState(
  playerObject: PlayerJson | undefined,
  catalogs: Catalogs,
  serverNowMs: number,
  timedEventRows: Record<string, unknown>[] = [],
): ApiState {
  if (playerObject === undefined) {
    return {
      player: null,
      islands: [],
      foods: [],
      events: { encore: null, clubboxTokens: 0, clubboxes: [], minigameTokens: 0, timedEvents: [] },
      cardAlbum: null,
      summary: { islands: 0, monsters: 0, monstersCollectable: 0, eggsReady: 0, eggsTotal: 0, breedingsReady: 0, breedingsActive: 0, mines: 0, minesReady: 0, bakingsReady: 0, bakingsActive: 0 },
    };
  }

  const foodsById = new Map(catalogs.foods.map((food) => [food.id, food]));

  const player: PlayerSummaryView = {
    name: asString(playerObject.display_name) ?? 'unknown',
    level: numberOr(playerObject.level, 0),
    xp: numberOr(playerObject.xp, 0),
    coins: numberOr(playerObject.coins_actual, 0),
    diamonds: numberOr(playerObject.diamonds_actual, 0),
    food: numberOr(playerObject.food_actual, 0),
    keys: numberOr(playerObject.keys_actual, 0),
    relics: numberOr(playerObject.relics_actual, 0),
    starpower: numberOr(playerObject.starpower, 0),
    etherealCurrency: numberOr(playerObject.ethereal_currency_actual, 0),
    eggWildcards: numberOr(playerObject.egg_wildcards, 0),
    clubboxTokens: numberOr(playerObject.clubbox_tokens_actual, 0),
    minigameTokens: numberOr(playerObject.minigame_tokens_actual, 0),
  };

  // Prerequisite chains (castle tiers etc.) are satisfied by any placed
  // structure on any island, so the owned-entity set is account-wide and
  // computed once, before the per-island views that consume it.
  const ownedEntityIds = new Set<number>();
  for (const rawIsland of rowsOf(playerObject.islands)) {
    for (const rawStructure of rowsOf(rawIsland.structures)) {
      const entity = catalogs.structures.get(numberOr(rawStructure.structure, 0))?.entityId ?? 0;
      if (entity > 0) ownedEntityIds.add(entity);
    }
  }

  // Limited-time store rows (Amber vessels, seasonal decos) are gated by
  // the same account-wide windows on every island, so parse them once.
  const offersByEntity = activeEntityOffers(timedEventRows, serverNowMs);

  const islands: IslandView[] = rowsOf(playerObject.islands)
    .map((rawIsland): IslandView => {
      const islandVariantId = numberOr(rawIsland.island, 0);
      const info = catalogs.islands.get(islandVariantId);
      const islandTypeId = numberOr(rawIsland.type, islandVariantId);
      const monsters = rowsOf(rawIsland.monsters)
        .map((raw) => monsterView(raw, catalogs, serverNowMs, islandTypeId))
        // Stale-first: the monster that has gone uncollected the longest is
        // the one the player most likely wants to act on. Hotel guests can't
        // be collected, so they go last.
        .sort((a, b) =>
          Number(a.inHotel) - Number(b.inHotel) ||
          (b.sinceLastCollectionMs ?? 0) - (a.sinceLastCollectionMs ?? 0));
      const breeding = rowsOf(rawIsland.breeding).map((raw) => breedingView(raw, catalogs, serverNowMs));
      const baking = rowsOf(rawIsland.baking).map((raw) => bakingView(raw, foodsById, serverNowMs));
      const occupied = new Set(breeding.map((b) => b.userStructureId));
      return {
        userIslandId: asString(rawIsland.user_island_id) ?? '?',
        islandVariantId,
        islandTypeId,
        name: info?.name ?? `Island ${String(islandVariantId)}`,
        group: info?.group ?? 'special',
        isPaironormal: islandTypeId === ISLAND_TYPE_PAIRONORMAL,
        store: buildStore(catalogs, player.level, ownedEntityIds, islandVariantId, islandTypeId, offersByEntity),
        monsters,
        structures: rowsOf(rawIsland.structures).map((raw) => structureView(raw, catalogs, serverNowMs, occupied)),
        breeding,
        baking,
        eggs: rowsOf(rawIsland.eggs).map((raw) => eggView(raw, catalogs, serverNowMs)),
        likes: numberOr(rawIsland.likes, 0),
      };
    })
    // Game order: by island family, then the base island, mirrors after originals.
    .sort((a, b) =>
      ISLAND_GROUPS.indexOf(a.group) - ISLAND_GROUPS.indexOf(b.group) ||
      a.islandTypeId - b.islandTypeId ||
      a.islandVariantId - b.islandVariantId);

  // One reduce for every headline count on the dashboard.
  const summary = islands.reduce<SummaryCounts>(
    (acc, island) => {
      const collectable = island.monsters.filter((m) => isCollectableMonster(m) && m.sinceLastCollectionMs !== null).length;
      const mines = island.structures.filter((s) => s.isMine);
      return {
        islands: acc.islands + 1,
        monsters: acc.monsters + island.monsters.length,
        monstersCollectable: acc.monstersCollectable + collectable,
        eggsReady: acc.eggsReady + island.eggs.filter((e) => e.done).length,
        eggsTotal: acc.eggsTotal + island.eggs.length,
        breedingsReady: acc.breedingsReady + island.breeding.filter((b) => b.done).length,
        breedingsActive: acc.breedingsActive + island.breeding.filter((b) => !b.done).length,
        mines: acc.mines + mines.length,
        minesReady: acc.minesReady + mines.filter((s) => s.mineReady).length,
        bakingsReady: acc.bakingsReady + island.baking.filter((b) => b.done).length,
        bakingsActive: acc.bakingsActive + island.baking.filter((b) => !b.done).length,
      };
    },
    { islands: 0, monsters: 0, monstersCollectable: 0, eggsReady: 0, eggsTotal: 0, breedingsReady: 0, breedingsActive: 0, mines: 0, minesReady: 0, bakingsReady: 0, bakingsActive: 0 },
  );

  const foods: FoodOptionView[] = catalogs.foods.map((food) => ({
    id: food.id,
    name: food.name,
    cost: food.cost,
    timeMs: food.timeMs,
    food: food.food,
    alwaysAvail: food.alwaysAvail,
  }));

  const islandNames = new Map(islands.map((island) => [island.userIslandId, island.name]));
  const events = buildEvents(playerObject, catalogs, timedEventRows, islandNames, serverNowMs);
  const cardAlbum = buildCardAlbum(playerObject, catalogs);

  return { player, islands, foods, events, cardAlbum, summary };
}