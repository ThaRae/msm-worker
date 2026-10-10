/**
 * Amber Island mechanics against the real catalog data: vessel statue
 * state (box_requirements presence, invisible fill) and the
 * EntityStoreAvailability-gated store rows. Skipped when the downloaded
 * catalogs are not present, like the other catalog-dependent suites.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalogs } from './catalogs.js';
import { buildApiState, isCollectableMonster, type PlayerJson } from './viewModel.js';

const catalogsDir = join(process.cwd(), '..', 'catalogs');
const catalogsAvailable = (): boolean => existsSync(join(catalogsDir, 'db_monster.json'));

/** Amber island with optional raw monster rows. */
const amberPlayer = (monsters: Record<string, unknown>[]): PlayerJson => ({
  level: 20,
  islands: [
    {
      user_island_id: '4060207',
      island: 22,
      type: 22,
      monsters,
      structures: [],
      breeding: [],
      baking: [],
      eggs: [],
      likes: 0,
    },
  ],
});

/** EntityStoreAvailability window around a fixed "now". */
const offer = (entity: number, startMs: number, endMs: number): Record<string, unknown> => ({
  event_type: 'EntityStoreAvailability',
  start_date: String(startMs),
  end_date: String(endMs),
  data: [{ label: 'All Amber Vessels', entity }],
});

const NOW = 1_790_000_000_000;

/** Kayna vessel row: requirements present, fill invisible server-side. */
const activeVessel = (): Record<string, unknown> => ({
  user_monster_id: '642',
  monster: 539,
  name: 'Lavalee',
  level: 20,
  pos_x: 26,
  pos_y: 15,
  box_requirements: '[31,31,31,23,23]',
  has_evolve_reqs: '[]',
});

test('an active Amber vessel is dormant with every requirement open', () => {
  if (!catalogsAvailable()) return;
  const state = buildApiState(amberPlayer([activeVessel()]), loadCatalogs(catalogsDir), NOW, []);
  const vessel = state.islands[0]?.monsters[0];
  assert.ok(vessel);
  assert.equal(vessel.statueState, 'dormant');
  assert.equal(vessel.boxTotal, 5);
  // The server never ships a vessel box contents, so fill is unknown, not 0.
  assert.equal(vessel.boxFillKnown, false);
  assert.equal(vessel.boxFilled, undefined);
  assert.equal(vessel.boxNeeds?.length, 2);
  assert.deepEqual(
    vessel.boxNeeds?.map((entry) => ({ monsterId: entry.monsterId, count: entry.count })),
    [
      { monsterId: 31, count: 3 },
      { monsterId: 23, count: 2 },
    ],
  );
});

test('a completed Amber vessel drops box_requirements and stops being a statue', () => {
  if (!catalogsAvailable()) return;
  const completed = { ...activeVessel(), user_monster_id: '900', monster: 553 };
  delete (completed as Record<string, unknown>).box_requirements;
  const state = buildApiState(amberPlayer([completed]), loadCatalogs(catalogsDir), NOW, []);
  const monster = state.islands[0]?.monsters[0];
  assert.ok(monster);
  assert.equal(monster.statueState, undefined);
  assert.equal(monster.boxNeeds, undefined);
});

test('vessel store rows appear only inside their offer window', () => {
  if (!catalogsAvailable()) return;
  const catalogs = loadCatalogs(catalogsDir);
  // Glowl (monster 540) has view_in_market=0: without a window covering its
  // entity the Amber store must not sell it.
  const withoutOffer = buildApiState(amberPlayer([]), catalogs, NOW, [offer(1253, NOW - 10_000, NOW - 1)]);
  assert.equal(withoutOffer.islands[0]?.store.monsters.find((m) => m.monsterId === 540), undefined);

  // Kayna (539) is a plain view_in_market=1 row, so it sells regardless.
  assert.ok(withoutOffer.islands[0]?.store.monsters.some((m) => m.monsterId === 539));

  // Inside the window the vessel is offered and carries the countdown end.
  const withOffer = buildApiState(
    amberPlayer([]),
    catalogs,
    NOW,
    [offer(1253, NOW - 10_000, NOW + 90_000), offer(1253, NOW - 10_000, NOW + 60_000)],
  );
  const glowl = withOffer.islands[0]?.store.monsters.find((m) => m.monsterId === 540);
  assert.ok(glowl);
  assert.equal(glowl.offerEndsMs, NOW + 90_000);
});

test('a gated decoration sells on its allowed island while the window is open', () => {
  if (!catalogsAvailable()) return;
  const catalogs = loadCatalogs(catalogsDir);
  const state = buildApiState(amberPlayer([]), catalogs, NOW, [offer(1340, NOW - 1, NOW + 1)]);
  // Entity 1340 is DECORATION_ANNIVERSARY_01, allowed on Amber.
  const row = state.islands[0]?.store.items.find((it) => it.offerEndsMs === NOW + 1);
  assert.ok(row);
  assert.equal(row.isDecoration, true);
});

/** Wublin Island with optional raw statue rows. */
const wublinPlayer = (monsters: Record<string, unknown>[]): PlayerJson => ({
  level: 20,
  islands: [
    {
      user_island_id: '3585175',
      island: 10,
      type: 10,
      monsters,
      structures: [],
      breeding: [],
      baking: [],
      eggs: [],
      likes: 0,
    },
  ],
});

const pinnaStatue = (boxedEggs: unknown): Record<string, unknown> => ({
  user_monster_id: '233',
  monster: 152,
  name: 'Pinna',
  level: 1,
  pos_x: 13,
  pos_y: 33,
  box_requirements: '[27,27,27,27,19,19,19,19,24,24,24,24,24,24,7,7,7,7,7,7,4,4,4,4]',
  has_evolve_reqs: '[]',
  boxed_eggs: boxedEggs,
});

test('a dormant Wublin with empty boxed_eggs does not report zero fill', () => {
  if (!catalogsAvailable()) return;
  const state = buildApiState(wublinPlayer([pinnaStatue('[]')]), loadCatalogs(catalogsDir), NOW, []);
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.statueState, 'dormant');
  assert.equal(pinna.boxFillKnown, false);
  assert.equal(pinna.boxFilled, undefined);
  assert.equal(pinna.boxTotal, 24);
  assert.equal(pinna.boxNeeds?.reduce((sum, entry) => sum + entry.count, 0), 24);
});

test('a Wublin boxed_eggs int-array still counts as fill, not awake', () => {
  if (!catalogsAvailable()) return;
  const state = buildApiState(wublinPlayer([pinnaStatue([27, 27, 19, 24, 7, 4])]), loadCatalogs(catalogsDir), NOW, []);
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.statueState, 'dormant');
  assert.equal(pinna.boxFillKnown, true);
  assert.equal(pinna.boxFilled, 6);
  assert.equal(pinna.boxTotal, 24);
  assert.equal(pinna.boxNeeds?.reduce((sum, entry) => sum + entry.count, 0), 18);
});

test('a Wublin boxed_eggs JSON string of ids counts the same as an int-array', () => {
  if (!catalogsAvailable()) return;
  const state = buildApiState(wublinPlayer([pinnaStatue('[27,27,19,24,7,4]')]), loadCatalogs(catalogsDir), NOW, []);
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.boxFillKnown, true);
  assert.equal(pinna.boxFilled, 6);
});

test('an awake Wublin drops boxed_eggs and counts the phase as filled', () => {
  if (!catalogsAvailable()) return;
  const awake = pinnaStatue('[]');
  delete awake.boxed_eggs;
  const state = buildApiState(wublinPlayer([awake]), loadCatalogs(catalogsDir), NOW, []);
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.statueState, 'awake');
  assert.equal(pinna.boxFillKnown, true);
  assert.equal(pinna.boxFilled, 24);
  assert.deepEqual(pinna.boxNeeds, []);
});

/** Blipsqueak / Pinna: db_monster time_to_fill_sec is 432000 (5 days). */
const PINNA_FILL_MS = 432_000_000;

test('a dormant Wublin without egg_timer_start still reports the fill window', () => {
  if (!catalogsAvailable()) return;
  const state = buildApiState(wublinPlayer([pinnaStatue('[]')]), loadCatalogs(catalogsDir), NOW, []);
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.boxFillMs, PINNA_FILL_MS);
  assert.equal(pinna.eggTimerStartMs, undefined);
  assert.equal(pinna.boxExpiresAtMs, undefined);
  assert.equal(pinna.boxExpiresInMs, undefined);
  assert.equal(isCollectableMonster(pinna), false);
});

test('a dormant Wublin fill timer counts down from egg_timer_start', () => {
  if (!catalogsAvailable()) return;
  const started = NOW - 86_400_000;
  const state = buildApiState(
    wublinPlayer([{ ...pinnaStatue('[]'), egg_timer_start: String(started) }]),
    loadCatalogs(catalogsDir),
    NOW,
    [],
  );
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.eggTimerStartMs, started);
  assert.equal(pinna.boxExpiresAtMs, started + PINNA_FILL_MS);
  assert.equal(pinna.boxExpiresInMs, PINNA_FILL_MS - 86_400_000);
  assert.equal(pinna.boxExpired, false);
});

test('an expired Wublin fill timer is marked expired', () => {
  if (!catalogsAvailable()) return;
  const started = NOW - PINNA_FILL_MS - 1;
  const state = buildApiState(
    wublinPlayer([{ ...pinnaStatue('[]'), egg_timer_start: String(started) }]),
    loadCatalogs(catalogsDir),
    NOW,
    [],
  );
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.boxExpired, true);
  assert.equal(pinna.boxExpiresInMs, 0);
});

test('an awake Wublin is collectable and has no fill timer', () => {
  if (!catalogsAvailable()) return;
  const awake = pinnaStatue('[]');
  delete awake.boxed_eggs;
  awake.egg_timer_start = String(NOW);
  const state = buildApiState(wublinPlayer([awake]), loadCatalogs(catalogsDir), NOW, []);
  const pinna = state.islands[0]?.monsters[0];
  assert.ok(pinna);
  assert.equal(pinna.statueState, 'awake');
  assert.equal(pinna.boxExpiresAtMs, undefined);
  assert.equal(pinna.boxFillMs, undefined);
  assert.equal(isCollectableMonster(pinna), true);
});