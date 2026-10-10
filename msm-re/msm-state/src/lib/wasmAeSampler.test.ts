import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseAeAnim, type AnimKeyframe, type AnimLayer } from './aeAnim.js';
import { WasmAeSampler, sampleAtlasIndex } from './wasmAeSampler.js';
import { gameDataDir } from '../services/gameAssets.js';

const binary = readFileSync(new URL('../../public/runtime/ae-sampler.wasm', import.meta.url));
const sampler = await WasmAeSampler.create(binary);
const floatBits = (n: number): number => { const b = Buffer.alloc(4); b.writeFloatLE(n); return b.readUInt32LE(); };
function key(time: number, values: { pos?: [number, number]; scale?: [number, number]; rotation?: number; opacity?: number; sprite?: string; color?: [number, number, number]; hold?: boolean } = {}): AnimKeyframe {
  const mode = values.hold ? 1 : 0;
  const words = [floatBits(time), 255, 0, 0, 255, 0, 0, 255, 0, 255, 0];
  if (values.pos) { words[1] = mode; words[2] = floatBits(values.pos[0]); words[3] = floatBits(values.pos[1]); }
  if (values.scale) { words[4] = mode; words[5] = floatBits(values.scale[0]); words[6] = floatBits(values.scale[1]); }
  if (values.rotation !== undefined) { words[7] = mode; words[8] = floatBits(values.rotation); }
  if (values.opacity !== undefined) { words[9] = mode; words[10] = floatBits(values.opacity); }
  const color = values.color;
  const packed = color ? ((color[2] << 24) | (color[1] << 16) | (color[0] << 8) | mode) : -1;
  return { x: 0, y: 0, scaleX: 0, scaleY: 0, rotation: 0, opacity: 0, sprite: values.sprite ?? '',
    native: { words, beforeSprite: values.sprite === undefined ? 255 : mode, afterSprite: packed } };
}
function layer(frames: AnimKeyframe[]): AnimLayer {
  return { name: 'fixture', id: 0, parent: -1, sourceId: 0, width: 10, height: 10, anchorX: 0, anchorY: 0, frames };
}

test('WASM is freestanding and exports the versioned sampler ABI', () => {
  const module = new WebAssembly.Module(binary);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  const e = new WebAssembly.Instance(module).exports;
  assert.equal((e.ae_abi_version as () => number)(), 1);
});

test('sparse tracks interpolate independently across unrelated keys', () => {
  const rig = layer([
    key(0, { pos: [10, 20], scale: [100, 50], rotation: 350, opacity: 100, sprite: 'a', color: [10, 20, 30] }),
    key(1, { sprite: 'b' }),
    key(2, { opacity: 20 }),
    key(4, { pos: [50, 60], scale: [50, 150], rotation: 10, color: [50, 60, 70] }),
  ]);
  const p = sampler.sample(rig, 2);
  assert.equal(p.x, 30); assert.equal(p.y, 40);
  assert.equal(p.scaleX, 0.75); assert.equal(p.scaleY, 1);
  assert.equal(p.rotation, 180); // Native does NOT shortest-path wrap rotations.
  assert.equal(p.opacity, 20);
  assert.deepEqual(p.color, [30, 40, 50]);
  assert.deepEqual(p.sprite, { from: 'b', to: 'b', fraction: 0 });
});

test('hold mode, exact boundaries, end holds and reverse seeks', () => {
  const rig = layer([key(0, { pos: [10, 20], opacity: 100, hold: true }), key(2, { pos: [30, 40], opacity: 0 })]);
  assert.equal(sampler.sample(rig, 1).x, 10);
  assert.equal(sampler.sample(rig, 2).x, 30);
  assert.equal(sampler.sample(rig, 20).x, 30);
  assert.equal(sampler.sample(rig, 0.5).x, 10);
  assert.equal(sampler.sample(rig, 1).opacity, 100);
});

test('empty tracks and before-first keys use native numeric defaults', () => {
  for (const rig of [layer([]), layer([key(2, { pos: [1, 2], opacity: 100, sprite: 'a' })])]) {
    assert.deepEqual(sampler.sample(rig, 0), {
      x: 0, y: 0, scaleX: 0, scaleY: 0, rotation: 0, opacity: 0,
      color: [255, 255, 255], sprite: null,
    });
  }
});

test('duplicate times select the last key at that boundary', () => {
  const rig = layer([key(0, { pos: [1, 2] }), key(0, { pos: [3, 4] }), key(1, { pos: [5, 6] })]);
  assert.equal(sampler.sample(rig, 0).x, 3);
  assert.equal(sampler.sample(rig, 0.5).x, 4);
});

test('sprite tracks return endpoints for native atlas-index interpolation', () => {
  const rig = layer([key(0, { sprite: 'a' }), key(4, { sprite: 'z' })]);
  assert.deepEqual(sampler.sample(rig, 1).sprite, { from: 'a', to: 'z', fraction: 0.25 });
  assert.equal(sampleAtlasIndex(2, 10, 0.25), 4);
  assert.equal(sampleAtlasIndex(10, 1, 0.25), 8); // truncation, not floor
  assert.throws(() => sampleAtlasIndex(0, 1, NaN));
});

test('invalid metadata, oversized layers and bad times are rejected', () => {
  assert.throws(() => sampler.sample(layer([key(0)]), NaN), /time/);
  assert.throws(() => sampler.sample(layer([key(0)]), 1e100), /time/);
  assert.throws(() => sampler.sample(layer([key(1), key(0)]), 0), /\(-2\)/);
  assert.throws(() => sampler.sample(layer([key(NaN)]), 0), /\(-2\)/);
  assert.throws(() => sampler.sample(layer([key(0, { pos: [Infinity, 0] })]), 0), /\(-3\)/);
  assert.throws(() => sampler.sample(layer(Array.from({ length: 4097 }, () => key(0))), 0), /capacity/);
  const frame = key(0); delete frame.native;
  assert.throws(() => sampler.sample(layer([frame]), 0), /native/);
  // Invalid input must not poison the following valid call.
  assert.equal(sampler.sample(layer([key(0, { pos: [7, 8] })]), 0).x, 7);
});

test('absent track flags use their low byte and ignore nonfinite unused payloads', () => {
  const frame = key(0);
  frame.native!.words[1] = 0xaabbccff;
  frame.native!.words[2] = floatBits(NaN);
  assert.equal(sampler.sample(layer([frame]), 0).x, 0);
});

test('actual installed rigs sample their first keyed pose and sparse intermediate times', (t) => {
  const dir = join(gameDataDir(), 'xml_bin');
  if (!existsSync(join(dir, 'monster_A.bin'))) { t.skip('game not installed'); return; }
  let checked = 0;
  for (const name of ['monster_A.bin', 'monster_B.bin', 'structure_breeding.bin', 'island01.bin']) {
    const file = parseAeAnim(readFileSync(join(dir, name)));
    for (const clip of file.animations) {
      for (const l of clip.layers) {
        if (!l.frames.length) continue;
        const raw = l.frames[0]!.native!;
        const b = Buffer.alloc(4); b.writeUInt32LE(raw.words[0]!);
        const start = b.readFloatLE();
        const p = sampler.sample(l, start);
        // First-frame transforms only exist when this property has a key.
        if ((raw.words[1]! & 255) !== 255) {
          assert.equal(p.x, l.frames[0]!.x); assert.equal(p.y, l.frames[0]!.y);
        }
        for (const time of [start + 0.03125, start + 0.5, start + 2]) {
          const s = sampler.sample(l, time);
          assert.ok([s.x, s.y, s.scaleX, s.scaleY, s.rotation, s.opacity, ...s.color].every(Number.isFinite));
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100);
});
