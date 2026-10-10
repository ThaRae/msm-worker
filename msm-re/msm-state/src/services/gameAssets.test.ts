/**
 * Island scene builder: parse a real Plant Island grid/tileset when the
 * CrossOver bottle is present, and pin that TexturePacker r="y" frames
 * are flagged so the canvas can unrotate them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAeAnim, pickAnimation } from '../lib/aeAnim.js';
import { buildIslandScene, buildRuntimeIslandScene, gameDataDir, type IslandDraw } from './gameAssets.js';
import { AnimationPreview } from '../lib/animationPreview.js';
import { WasmAeSampler } from '../lib/wasmAeSampler.js';
import { loadCatalogs } from './catalogs.js';
import type { IslandView, MonsterView, StructureView } from './viewModel.js';

const catalogsDir = join(process.cwd(), '..', 'catalogs');
const gameInstalled = (): boolean => existsSync(join(gameDataDir(), 'xml_bin', 'island01.bin'));
const catalogsAvailable = (): boolean => existsSync(join(catalogsDir, 'db_island_v2.json'));

const emptyIsland = (): IslandView => ({
  userIslandId: '0',
  islandVariantId: 1,
  islandTypeId: 1,
  name: 'Plant Island',
  group: 'natural',
  isPaironormal: false,
  store: { items: [], monsters: [] },
  monsters: [],
  structures: [],
  breeding: [],
  eggs: [],
  baking: [],
  likes: 0,
});

const structure = (over: Partial<StructureView>): StructureView => ({
  userStructureId: '1', structureId: 2, name: 'Breeding Structure', structureType: 'breeding',
  isMine: false, isBreeding: true, isNursery: false, isBakery: false, isUpgrading: false,
  isOccupied: false, mineReady: false, mineFillsInMs: 0, mineFillMs: 0,
  sizeX: 4, sizeY: 4, posX: 10, posY: 10, scale: 1, inWarehouse: false, flip: false,
  sinceLastCollectionMs: null, ...over,
});

const monster = (over: Partial<MonsterView>): MonsterView => ({
  userMonsterId: '1', name: '', monsterName: 'Potbelly', monsterId: 2, level: 1, happiness: 0,
  posX: 5, posY: 5, sizeX: 1, sizeY: 1, scale: 1, inHotel: false, muted: false, flip: false,
  sinceLastCollectionMs: null, ...over,
});

function drawBounds(draw: IslandDraw): { minX: number; minY: number; maxX: number; maxY: number } {
  const [a, b, c, d, e, f] = draw.m;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lx, ly] of [[0, 0], [draw.lw, 0], [0, draw.lh], [draw.lw, draw.lh]] as const) {
    const x = a * lx + c * ly + e;
    const y = b * lx + d * ly + f;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

test('Plant Island AEAnim and breeding structure parse when the game is installed', () => {
  const dir = join(gameDataDir(), 'xml_bin');
  const island = join(dir, 'island01.bin');
  const breeding = join(dir, 'structure_breeding.bin');
  if (!existsSync(island) || !existsSync(breeding)) {
    return;
  }
  const scene = parseAeAnim(readFileSync(island));
  const clip = pickAnimation(scene, 'island01_loop');
  assert.ok(clip);
  assert.equal(clip.stageW, 1872);
  assert.ok(clip.layers.length > 20);

  const file = parseAeAnim(readFileSync(breeding));
  const body = pickAnimation(file, 'structure_breeding');
  assert.ok(body);
  const main = body.layers.find((layer) => layer.frames[0]?.sprite === 'structure_body');
  assert.ok(main);
  assert.equal(main.width, 320);
  assert.equal(main.frames[0]?.x, 500);
});

test('Plant Island scene marks TexturePacker r=y frames as rotated', () => {
  if (!catalogsAvailable() || !gameInstalled()) return;
  const catalogs = loadCatalogs(catalogsDir);
  const scene = buildIslandScene(emptyIsland(), catalogs);
  assert.ok(scene.draws.some((draw) => draw.rotated), 'island overlay uses packed-rotated frames');
});

test('grass tiles use native diamond geometry without altering texture crops', () => {
  if (!catalogsAvailable() || !gameInstalled()) return;
  const scene = buildIslandScene(emptyIsland(), loadCatalogs(catalogsDir));
  const tiles = scene.draws.filter((d) => d.url.includes('island01_grass'));
  assert.ok(tiles.length > 900);
  assert.ok(tiles.every((d) => d.shape === 'diamond' && d.lw === 96 && d.lh === 48));
  assert.ok(tiles.every((d) => d.fw === 96 && d.fh === 48));
});

test('Plant scenery including empty sprite nodes animates through WASM without rig fallback', async () => {
  if (!catalogsAvailable() || !gameInstalled()) return;
  const scene = buildRuntimeIslandScene(emptyIsland(), loadCatalogs(catalogsDir));
  const core = await WasmAeSampler.create(new Uint8Array(readFileSync(new URL('../../public/runtime/ae-sampler.wasm', import.meta.url))));
  const preview = new AnimationPreview(scene, core);
  const first = preview.drawsAt(0).filter((d) => d.instanceId === 'scene');
  const later = preview.drawsAt(1).filter((d) => d.instanceId === 'scene');
  assert.equal(preview.activeInstanceCount, 1);
  assert.ok(!preview.diagnostics.some((d) => d.includes('static fallback')));
  assert.ok(first.length > 40);
  assert.ok(later.some((d, i) => JSON.stringify(d.m) !== JSON.stringify(first[i]?.m)));
});

test('entities are anchored on their own cell, not their footprint centre', () => {
  if (!catalogsAvailable() || !existsSync(join(gameDataDir(), 'xml_bin', 'structure_breeding.bin'))) return;
  const catalogs = loadCatalogs(catalogsDir);
  const scene = buildIslandScene({ ...emptyIsland(), structures: [structure({})] }, catalogs);
  const draws = scene.draws.filter((draw) => draw.title === 'Breeding Structure');
  assert.ok(draws.length > 0, 'breeding structure resolves');
  const bounds = draws.map(drawBounds);
  const centre = (
    Math.min(...bounds.map((b) => b.minX)) + Math.max(...bounds.map((b) => b.maxX))
  ) / 2;
  // The client's setPosition puts the stage centre on cell (10, 10); the
  // footprint centre would be (11.5, 11.5), a full 1.5 cells to the right.
  const anchorX = (10 + 10) * (scene.tileW / 2);
  const footprintX = (11.5 + 11.5) * (scene.tileW / 2);
  assert.ok(
    Math.abs(centre - anchorX) < Math.abs(centre - footprintX),
    'sprite centre follows the anchor cell, not the footprint centre',
  );
});

test('monsters are composed from their rig layers, not a single portrait', () => {
  if (!catalogsAvailable() || !existsSync(join(gameDataDir(), 'xml_bin', 'monster_b.bin'))) return;
  const catalogs = loadCatalogs(catalogsDir);
  const scene = buildIslandScene({ ...emptyIsland(), monsters: [monster({})] }, catalogs);
  const draws = scene.draws.filter((draw) => draw.title === 'Potbelly');
  assert.ok(draws.length > 3, 'the rig contributes body, head, limbs and shadow layers');
});

test('hires rig sprites keep physical crops but halve logical size and trim offsets', () => {
  if (!catalogsAvailable() || !existsSync(join(gameDataDir(), 'xml_bin', 'monster_b.bin'))) return;
  const catalogs = loadCatalogs(catalogsDir);
  const scene = buildRuntimeIslandScene({ ...emptyIsland(), monsters: [monster({})] }, catalogs);
  const instance = scene.runtime.instances.find((i) => i.id === 'monster:1')!;
  const rig = scene.runtime.rigs[instance.rig]!;
  const bank = rig.sources['0']!;
  const belly = bank.sprites[bank.names.indexOf('B_belly1')]!;
  assert.equal(belly.pixelScale, 0.5);
  assert.equal(belly.fw, 103); assert.equal(belly.fh, 89);
  assert.equal(belly.lw, 53); assert.equal(belly.lh, 46);
  assert.equal(belly.ox, 0.5); assert.equal(belly.oy, 1.5);
  const mouth = bank.sprites[bank.names.indexOf('B_mouth05')]!;
  assert.equal(mouth.rotated, true);
  assert.equal(mouth.fw, 47); assert.equal(mouth.fh, 75);
  assert.equal(mouth.ox, 3); assert.equal(mouth.oy, 10.5);
  assert.equal(mouth.lw, 43); assert.equal(mouth.lh, 46);
  const staticBelly = scene.draws.find((d) => d.instanceId === instance.id && d.fx === belly.fx && d.fy === belly.fy)!;
  assert.equal(staticBelly.pixelScale, 0.5);
  assert.equal(staticBelly.lw, belly.lw);
});

test('atlas sheets with vertex children and mismatched source ids still resolve', () => {
  if (!catalogsAvailable()) return;
  if (!existsSync(join(gameDataDir(), 'xml_bin', 'structure_castle_05.bin'))) return;
  const catalogs = loadCatalogs(catalogsDir);
  const castle = structure({ structureId: 21, name: 'Castle 05', structureType: 'castle', sizeX: 4, sizeY: 4 });
  const scene = buildIslandScene({ ...emptyIsland(), structures: [castle] }, catalogs);
  assert.ok(scene.draws.some((draw) => draw.title === 'Castle 05'), 'structure_castle_05 resolves');
});

test('runtime island payload deduplicates rigs, excludes stored entities and animates installed monsters', async (t) => {
  if (!catalogsAvailable() || !gameInstalled()) { t.skip('game/catalogs not installed'); return; }
  const catalogs = loadCatalogs(catalogsDir);
  const island = { ...emptyIsland(), monsters: [
    monster({}), monster({ userMonsterId: '2', posX: 8 }),
    monster({ userMonsterId: '3', inHotel: true }),
  ], structures: [structure({ inWarehouse: true })] };
  const scene = buildRuntimeIslandScene(island, catalogs);
  const a = scene.runtime.instances.find((i) => i.id === 'monster:1');
  const b = scene.runtime.instances.find((i) => i.id === 'monster:2');
  assert.ok(a && b);
  assert.equal(a.rig, b.rig);
  assert.ok(!scene.runtime.instances.some((i) => i.id === 'monster:3' || i.id.startsWith('structure:')));
  const staticScene = buildIslandScene(island, catalogs);
  assert.deepEqual(scene.draws.map(({ instanceId: _id, ...d }) => d), staticScene.draws);
  const core = await WasmAeSampler.create(new Uint8Array(readFileSync(new URL('../../public/runtime/ae-sampler.wasm', import.meta.url))));
  const preview = new AnimationPreview(scene, core);
  const start = preview.drawsAt(0).filter((d) => d.instanceId === 'monster:1');
  const later = preview.drawsAt(0.5).filter((d) => d.instanceId === 'monster:1');
  assert.ok(preview.activeInstanceCount >= 2);
  assert.ok(later.some((d, i) => JSON.stringify(d.m) !== JSON.stringify(start[i]?.m)), 'real rig changes pose through WASM');
  assert.ok(later.every((d) => d.opacity !== undefined));
});

test('island iso puts a high-col low-row cell above the centre', () => {
  const tw = 96, th = 48;
  const iso = (c: number, r: number) => ({ x: (c + r) * (tw / 2), y: (r - c) * (th / 2) });
  const castle = iso(29, 9);
  const centre = iso(19, 19);
  assert.ok(castle.y < centre.y, 'castle sits above the island centre');
});
