/**
 * Tests the compact projections the MCP tools return, plus the raw-field
 * path resolver. These run on synthetic state, no network or game files.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiveSession } from '../liveSession.js';
import { getByPath, projectIslandDetail, projectIslandSummary, projectReady, projectStatus } from './stateView.js';
import type { IslandView, MonsterView, StructureView } from '../viewModel.js';

const monster = (overrides: Partial<MonsterView> & { userMonsterId: string }): MonsterView => ({
  name: 'Nickname',
  monsterName: 'Noggin',
  monsterId: 3,
  level: 1,
  happiness: 50,
  posX: 0,
  posY: 0,
  sizeX: 2,
  sizeY: 2,
  scale: 1,
  inHotel: false,
  muted: false,
  flip: false,
  sinceLastCollectionMs: 0,
  ...overrides,
});

const structure = (overrides: Partial<StructureView> & { userStructureId: string }): StructureView => ({
  structureId: 34,
  name: 'Mine',
  structureType: 'mine',
  isMine: false,
  isBreeding: false,
  isNursery: false,
  isBakery: false,
  isUpgrading: false,
  isOccupied: false,
  mineReady: false,
  mineFillsInMs: 0,
  mineFillMs: 0,
  sizeX: 2,
  sizeY: 2,
  posX: 0,
  posY: 0,
  scale: 1,
  inWarehouse: false,
  flip: false,
  sinceLastCollectionMs: null,
  ...overrides,
});

const island = (overrides: Partial<IslandView> = {}): IslandView => ({
  userIslandId: '1',
  islandVariantId: 1,
  islandTypeId: 1,
  name: 'Plant Island',
  group: 'natural',
  isPaironormal: false,
  store: { items: [], monsters: [] },
  monsters: [],
  structures: [],
  breeding: [],
  baking: [],
  eggs: [],
  likes: 0,
  ...overrides,
});

test('getByPath walks objects and arrays', () => {
  const root = { islands: [{ monsters: [{ user_monster_id: '9' }] }], level: 54 };
  assert.equal(getByPath(root, 'level'), 54);
  assert.deepEqual(getByPath(root, 'islands.0.monsters.0'), { user_monster_id: '9' });
  assert.equal(getByPath(root, ''), root);
  assert.equal(getByPath(root, 'islands.9'), undefined);
  assert.throws(() => getByPath(root, 'islands.x'), /array index/);
  assert.throws(() => getByPath(root, 'level.0'), /non-object/);
});

test('projectIslandSummary counts what is ready', () => {
  const view = island({
    monsters: [monster({ userMonsterId: '1' }), monster({ userMonsterId: '2', inHotel: true })],
    structures: [
      structure({ userStructureId: '1', isMine: true, mineReady: true }),
      structure({ userStructureId: '2', isMine: true }),
    ],
    eggs: [
      { userEggId: '1', monsterName: 'Noggin', monsterId: 3, previousName: null, costumeEq: 0, hatchesOnMs: 0, laidOnMs: 0, done: true, remainingMs: 0 },
    ],
  });
  const summary = projectIslandSummary(view);
  assert.equal(summary.monsters, 2);
  assert.equal(summary.monstersCollectable, 1);
  assert.equal(summary.mines, 2);
  assert.equal(summary.minesReady, 1);
  assert.equal(summary.eggsReady, 1);
});

test('projectIslandSummary does not count dormant statues as collectable', () => {
  const view = island({
    islandTypeId: 10,
    name: 'Wublin Island',
    monsters: [
      monster({ userMonsterId: '1', monsterName: 'Blipsqueak', statueState: 'dormant' }),
      monster({ userMonsterId: '2', monsterName: 'Zynth', statueState: 'awake' }),
    ],
  });
  const summary = projectIslandSummary(view);
  assert.equal(summary.monsters, 2);
  assert.equal(summary.monstersCollectable, 1);
});

test('projectIslandDetail filters and pages monster rows', () => {
  const view = island({
    monsters: [
      monster({ userMonsterId: '1', monsterName: 'Noggin' }),
      monster({ userMonsterId: '2', monsterName: 'Mammott' }),
      monster({ userMonsterId: '3', monsterName: 'Rare Mammott' }),
    ],
  });
  const detail = projectIslandDetail(view, { monsterFilter: 'mammott', limit: 1, offset: 1 });
  const section = detail.monsters as { total: number; offset: number; items: MonsterView[] };
  assert.equal(section.total, 2);
  assert.equal(section.offset, 1);
  assert.deepEqual(section.items.map((row) => row.userMonsterId), ['3']);
});

test('projectReady lists ready entities with their island', () => {
  const api = {
    islands: [
      island({
        eggs: [
          { userEggId: '5', monsterName: 'Noggin', monsterId: 3, previousName: null, costumeEq: 0, hatchesOnMs: 0, laidOnMs: 0, done: true, remainingMs: 0 },
          { userEggId: '6', monsterName: 'Noggin', monsterId: 3, previousName: null, costumeEq: 0, hatchesOnMs: 5000, laidOnMs: 0, done: false, remainingMs: 5000 },
        ],
        structures: [structure({ userStructureId: '9', isMine: true, mineReady: true })],
      }),
    ],
  } as unknown as Parameters<typeof projectReady>[0];
  const ready = projectReady(api);
  const eggs = ready.eggs as Array<{ userEggId: string; islandName: string }>;
  assert.deepEqual(eggs.map((egg) => egg.userEggId), ['5']);
  assert.equal(eggs[0]?.islandName, 'Plant Island');
  assert.equal((ready.mines as unknown[]).length, 1);
});

test('projectStatus reports the cached auth state', () => {
  const now = Date.now();
  const session = {
    getStatus: () => ({
      status: 'online',
      lastError: undefined,
      lastSyncAtMs: now - 1000,
      authExpiresAtMs: now + 60_000,
      authFromCache: true,
      authStale: false,
      cooldownUntilMs: 0,
      cooldownRemainingMs: 0,
      connectFailures: 0,
    }),
    serverNow: () => now,
  } as unknown as LiveSession;
  const status = projectStatus(session);
  assert.equal(status.status, 'online');
  assert.deepEqual((status.auth as { fromCache: boolean }).fromCache, true);
  // projectStatus samples Date.now() again, so allow the tick that can pass
  // between the two calls instead of asserting an exact millisecond.
  const age = status.lastSyncAgeMs as number;
  assert.ok(age >= 1000 && age < 2000, `unexpected age ${String(age)}`);
});
