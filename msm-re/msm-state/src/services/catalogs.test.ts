/**
 * Island naming: db_island_v2 only carries localization keys, so these pin
 * down how ids, variants and mirrors map to the game's English names.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeIsland, prettifyKey } from './catalogs.js';

test('base islands use the in-game name and family', () => {
  assert.deepEqual(describeIsland('ISLAND_18', 18, 18), { name: 'Light Island', group: 'magical', marketMonsterIds: [] });
  assert.deepEqual(describeIsland('ISLAND_UNDERLING', 10, 10), { name: 'Wublin Island', group: 'special', marketMonsterIds: [] });
  assert.deepEqual(describeIsland('ISLAND_25', 25, 25), { name: 'Magical Nexus', group: 'magical', marketMonsterIds: [] });
  assert.deepEqual(describeIsland('ISLAND_29', 29, 29), { name: 'Crystal Islet', group: 'ethereal', marketMonsterIds: [] });
  assert.deepEqual(describeIsland('ISLAND_32', 32, 32), { name: 'bbli$zard Island', group: 'special', marketMonsterIds: [] });
});

test('mirror variants are prefixed and grouped as mirrors', () => {
  assert.deepEqual(describeIsland('ISLAND_1_MIRROR', 101, 1), { name: 'Mirror Plant Island', group: 'mirror', marketMonsterIds: [] });
  assert.deepEqual(describeIsland('ISLAND_18_MIRROR', 118, 18), { name: 'Mirror Light Island', group: 'mirror', marketMonsterIds: [] });
});

test('non-mirror variants reuse their base island', () => {
  assert.deepEqual(describeIsland('ISLAND_COMPOSER', 107, 11), { name: 'Composer Island', group: 'special', marketMonsterIds: [] });
});

test('unknown ids fall back to the prettified catalog key', () => {
  assert.deepEqual(describeIsland('ISLAND_40', 40, 40), { name: 'Island 40', group: 'special', marketMonsterIds: [] });
  assert.deepEqual(describeIsland('ISLAND_40_MIRROR', 140, 40), { name: 'Island 40 Mirror', group: 'mirror', marketMonsterIds: [] });
  assert.deepEqual(describeIsland('', 41, 41), { name: 'Island 41', group: 'special', marketMonsterIds: [] });
});

test('prettifyKey title-cases underscore keys', () => {
  assert.equal(prettifyKey('BREEDING_STRUCTURE'), 'Breeding Structure');
});
