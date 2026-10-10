/**
 * Compact projections of buildApiState() for MCP tool results.
 *
 * The full ApiState is ~2 MB for a mature account (most of it the per-island
 * market), far too large for a model tool result. Every function here
 * returns only the fields a caller needs, and list-shaped sections take
 * offset/limit so nothing is ever dumped wholesale.
 */

import type { LiveSession } from '../liveSession.js';
import {
  buildApiState,
  isCollectableMonster,
  type ApiState,
  type CardAlbumView,
  type IslandView,
  type MonsterView,
} from '../viewModel.js';
import type { JsonObject } from './protocol.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Snapshot of the connection/auth, safe to read without touching the game. */
export function projectStatus(session: LiveSession): JsonObject {
  const status = session.getStatus();
  const nowMs = Date.now();
  const expiresAtMs = status.authExpiresAtMs;
  return {
    status: status.status,
    lastError: status.lastError ?? null,
    lastSyncAtMs: status.lastSyncAtMs,
    lastSyncAgeMs: status.lastSyncAtMs === 0 ? null : nowMs - status.lastSyncAtMs,
    serverNowMs: session.serverNow(),
    auth: {
      expiresAtMs: expiresAtMs ?? null,
      expiresInMs: expiresAtMs === undefined ? null : expiresAtMs - nowMs,
      fromCache: status.authFromCache ?? null,
      stale: status.authStale ?? null,
    },
    cooldown: {
      untilMs: status.cooldownUntilMs === 0 ? null : status.cooldownUntilMs,
      remainingMs: status.cooldownRemainingMs,
      connectFailures: status.connectFailures,
    },
    resources: { guide: 'msm://guide' },
  };
}

function paginate<T>(rows: readonly T[], offset: number, limit: number | undefined): T[] {
  const start = Math.max(0, offset);
  const end = limit === undefined ? rows.length : start + Math.max(0, limit);
  return rows.slice(start, end);
}

export function projectIslandSummary(island: IslandView): JsonObject {
  const mines = island.structures.filter((structure) => structure.isMine);
  const collectable = island.monsters.filter((monster) => isCollectableMonster(monster) && monster.sinceLastCollectionMs !== null);
  return {
    userIslandId: island.userIslandId,
    name: island.name,
    group: island.group,
    islandVariantId: island.islandVariantId,
    islandTypeId: island.islandTypeId,
    isPaironormal: island.isPaironormal,
    likes: island.likes,
    structures: island.structures.length,
    monsters: island.monsters.length,
    monstersCollectable: collectable.length,
    eggs: island.eggs.length,
    eggsReady: island.eggs.filter((egg) => egg.done).length,
    breedings: island.breeding.length,
    breedingsReady: island.breeding.filter((breeding) => breeding.done).length,
    mines: mines.length,
    minesReady: mines.filter((mine) => mine.mineReady).length,
    bakings: island.baking.length,
    bakingsReady: island.baking.filter((baking) => baking.done).length,
  };
}

/** Eggs, breedings, mines and bakes that can be acted on right now. */
export function projectReady(api: ApiState): JsonObject {
  const eggs: JsonObject[] = [];
  const breedings: JsonObject[] = [];
  const mines: JsonObject[] = [];
  const bakings: JsonObject[] = [];
  for (const island of api.islands) {
    const where = { userIslandId: island.userIslandId, islandName: island.name };
    for (const egg of island.eggs) {
      if (!egg.done) continue;
      eggs.push({
        ...where,
        userEggId: egg.userEggId,
        monsterName: egg.monsterName,
        monsterId: egg.monsterId,
        costumeEq: egg.costumeEq,
      });
    }
    for (const breeding of island.breeding) {
      if (!breeding.done) continue;
      breedings.push({
        ...where,
        userBreedingId: breeding.userBreedingId,
        userStructureId: breeding.userStructureId,
        parents: `${breeding.monster1Name} x ${breeding.monster2Name}`,
        resultName: breeding.newMonsterName,
        resultMonsterId: breeding.newMonsterId,
      });
    }
    for (const structure of island.structures) {
      if (!structure.isMine || !structure.mineReady) continue;
      mines.push({ ...where, userStructureId: structure.userStructureId, name: structure.name });
    }
    for (const baking of island.baking) {
      if (!baking.done) continue;
      bakings.push({
        ...where,
        userBakingId: baking.userBakingId,
        userStructureId: baking.userStructureId,
        foodName: baking.foodName,
        foodCount: baking.foodCount,
      });
    }
  }
  return { eggs, breedings, mines, bakings };
}

export function projectEvents(api: ApiState, nowMs?: number): JsonObject {
  const encore = api.events.encore;
  return {
    encore: encore === null
      ? null
      : {
          ...encore,
          endsInMs: nowMs === undefined ? null : Math.max(0, encore.endsOnMs - nowMs),
          started: nowMs === undefined ? null : nowMs >= encore.startOnMs,
        },
    clubboxTokens: api.events.clubboxTokens,
    clubboxes: api.events.clubboxes,
    minigameTokens: api.events.minigameTokens,
    timedEvents: api.events.timedEvents,
  };
}

export function projectCardAlbum(album: CardAlbumView): JsonObject {
  const pagesComplete = album.pages.filter((page) => page.canClaim);
  return {
    albumId: album.albumId,
    currency: album.currency,
    collectedCards: album.collectedCardIds.length,
    duplicates: album.duplicates,
    pagesTotal: album.pages.length,
    pagesComplete: album.pages.filter((page) => page.rewardClaimed || page.canClaim).length,
    claimablePageIds: pagesComplete.map((page) => page.pageId),
    complete: album.complete,
    pendingPacks: album.pendingPacks,
    packs: album.packs,
    pages: album.pages,
  };
}

export type IslandDetailOptions = {
  /** Which sections to include; defaults to everything except the store. */
  sections?: readonly string[] | undefined;
  /** Case-insensitive substring match on monster name or nickname. */
  monsterFilter?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

const DEFAULT_SECTIONS = ['monsters', 'structures', 'breeding', 'eggs', 'baking'] as const;

export function projectIslandDetail(island: IslandView, options: IslandDetailOptions = {}): JsonObject {
  const sections = options.sections ?? DEFAULT_SECTIONS;
  const offset = options.offset ?? 0;
  const limit = options.limit;
  const result: JsonObject = { ...projectIslandSummary(island) };

  if (sections.includes('monsters')) {
    const filter = (options.monsterFilter ?? '').trim().toLowerCase();
    const rows: MonsterView[] = filter === ''
      ? island.monsters
      : island.monsters.filter(
          (monster) =>
            monster.monsterName.toLowerCase().includes(filter) || monster.name.toLowerCase().includes(filter),
        );
    result.monsters = { total: rows.length, offset, items: paginate(rows, offset, limit) };
  }
  if (sections.includes('structures')) {
    result.structures = { total: island.structures.length, offset, items: paginate(island.structures, offset, limit) };
  }
  if (sections.includes('breeding')) {
    result.breeding = { total: island.breeding.length, offset, items: paginate(island.breeding, offset, limit) };
  }
  if (sections.includes('eggs')) {
    result.eggs = { total: island.eggs.length, offset, items: paginate(island.eggs, offset, limit) };
  }
  if (sections.includes('baking')) {
    result.baking = { total: island.baking.length, offset, items: paginate(island.baking, offset, limit) };
  }
  if (sections.includes('store')) {
    result.store = projectStore(island, { offset, limit });
  }
  return result;
}

export type StoreOptions = {
  /** Only rows the player can buy right now (level + prerequisite gates). */
  purchasableOnly?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

export function projectStore(island: IslandView, options: StoreOptions = {}): JsonObject {
  const offset = options.offset ?? 0;
  const limit = options.limit;
  let items = island.store.items;
  let monsters = island.store.monsters;
  if (options.purchasableOnly === true) {
    items = items.filter((item) => item.levelOk && item.requirementsOk);
    monsters = monsters.filter((monster) => monster.levelOk);
  }
  return {
    userIslandId: island.userIslandId,
    islandName: island.name,
    islandVariantId: island.islandVariantId,
    islandTypeId: island.islandTypeId,
    itemsTotal: items.length,
    items: paginate(items, offset, limit),
    monstersTotal: monsters.length,
    monsters: paginate(monsters, offset, limit),
  };
}

/**
 * Lean account overview for the first model call. It deliberately omits the
 * per-island rows (msm_list_islands / msm_get_island own those) so the
 * result stays small on a mature 38-island account.
 */
export function projectOverview(api: ApiState): JsonObject {
  return {
    player: api.player,
    summary: api.summary,
    ready: projectReady(api),
    events: projectEvents(api),
    cardAlbum: api.cardAlbum === null ? null : projectCardAlbum(api.cardAlbum),
    foods: api.foods,
  };
}

/**
 * Resolve a dotted path into the raw player object, e.g.
 * "islands.0.monsters" or "mailbox". Array segments are numeric indexes.
 */
export function getByPath(root: unknown, path: string): unknown {
  const trimmed = path.trim();
  if (trimmed === '') return root;
  let current: unknown = root;
  for (const segment of trimmed.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`"${segment}" is not a valid array index in path "${path}"`);
      }
      current = current[index];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      throw new Error(`cannot read "${segment}": path "${path}" descends into a non-object`);
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/**
 * Builds (and briefly caches) the derived API state for a live session.
 * The cache is keyed by the last sync timestamp so a tool call after a
 * refresh never serves stale data, while concurrent reads in a burst share
 * one build.
 */
export class StateView {
  private cached: { api: ApiState; key: string; atMs: number } | undefined;

  constructor(private readonly session: LiveSession) {}

  invalidate(): void {
    this.cached = undefined;
  }

  async api(options: { refresh?: boolean | undefined } = {}): Promise<ApiState> {
    if (options.refresh === true) {
      await this.session.refresh();
      this.cached = undefined;
    } else {
      await this.session.ensureStarted();
    }
    let player = this.session.getPlayerObject();
    if (player === undefined) {
      await this.session.refresh();
      player = this.session.getPlayerObject();
    }
    const status = this.session.getStatus();
    const key = `${status.lastSyncAtMs}:${this.session.getTimedEvents().length}`;
    const nowMs = Date.now();
    if (this.cached !== undefined && this.cached.key === key && nowMs - this.cached.atMs < 1500) {
      return this.cached.api;
    }
    const api = buildApiState(player, this.session.getCatalogs(), this.session.serverNow(), this.session.getTimedEvents());
    this.cached = { api, key, atMs: nowMs };
    return api;
  }
}
