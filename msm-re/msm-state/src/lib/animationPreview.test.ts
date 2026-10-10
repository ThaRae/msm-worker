import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AnimationPreview, previewClipTime, previewWorldMatrices } from './animationPreview.js';
import { WasmAeSampler } from './wasmAeSampler.js';
import { layerWorldMatrices, type AnimKeyframe, type AnimLayer } from './aeAnim.js';
import type { RuntimeIslandScene, RuntimeRig, RuntimeSprite } from './islandRuntime.js';

const core = await WasmAeSampler.create(new Uint8Array(readFileSync(new URL('../../public/runtime/ae-sampler.wasm', import.meta.url))));
function bits(n: number): number { const b = Buffer.alloc(4); b.writeFloatLE(n); return b.readUInt32LE(); }
function frame(time: number, x: number, sprite = 'a', opacity = 100): AnimKeyframe {
  return { x, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity, sprite,
    native: { words: [bits(time), 0, bits(x), bits(20), 0, bits(100), bits(100), 0, bits(0), 0, bits(opacity)], beforeSprite: 1, afterSprite: -1 } };
}
function layer(overrides: Partial<AnimLayer> = {}): AnimLayer {
  return { name: 'body', id: 0, parent: -1, sourceId: 0, width: 10, height: 10,
    anchorX: 2, anchorY: 3, frames: [frame(0, 10), frame(1, 30, 'b')],
    native: { type: 1, blend: 0, reserved: 0, comment: '' }, ...overrides };
}
function sprite(fx: number): RuntimeSprite {
  return { url: '/api/assets/test.avif', fx, fy: 0, fw: 10, fh: 10, ox: 0, oy: 0, lw: 10, lh: 10, texW: 20, texH: 10, rotated: false };
}
function scene(l = layer()): RuntimeIslandScene {
  const rig: RuntimeRig = { clip: { name: 'Idle', stageW: 100, stageH: 100, layers: [l] },
    duration: 1, loopStart: -1,
    sources: { '0': { names: ['a', 'b'], sprites: [sprite(0), sprite(10)], wholeTexture: false } } };
  return { tileW: 96, tileH: 48, viewBox: { x: 0, y: 0, w: 100, h: 100 },
    draws: [
      { ...sprite(0), z: -100, m: [1, 0, 0, 1, 0, 0] },
      { ...sprite(0), z: 1, m: [1, 0, 0, 1, 8, 17], instanceId: 'monster:1' },
    ], runtime: { version: 1, rigs: { rig0: rig }, diagnostics: [],
      instances: [{ id: 'monster:1', rig: 'rig0', z: 1, origin: [1, 0, 0, 1, 0, 0], title: 'Test monster' }] } };
}

test('preview timeline supports nonzero loop starts and nonlooping clips', () => {
  assert.equal(previewClipTime(3, 4, 2), 3);
  assert.equal(previewClipTime(4, 4, 2), 2);
  assert.equal(previewClipTime(9, 4, 2), 3);
  assert.equal(previewClipTime(9, 4, -1), 4);
  assert.equal(previewClipTime(9, 0, -1), 0);
  assert.throws(() => previewClipTime(4, 4, 4));
  assert.throws(() => previewClipTime(Infinity, 4, 0));
});

test('prepared WASM layers snapshot immutable resource data and coexist', () => {
  const a = layer(), b = layer({ frames: [frame(0, 99)] });
  const sa = core.prepare(a), sb = core.prepare(b);
  a.frames[0]!.native!.words[2] = bits(200);
  a.frames[0]!.sprite = 'changed';
  const before = sa(0);
  assert.equal(before.x, 10); assert.equal(before.sprite?.from, 'a');
  assert.equal(sb(0).x, 99);
  assert.equal(sa(0.5).x, 20);
  assert.equal(before.x, 10);
});

test('static and sampled anchor-adjusted parent transforms agree at time zero', () => {
  const layers = [
    layer({ id: 2, parent: 1, anchorX: 5, frames: [{ ...frame(0, 5), rotation: 90 }] }),
    layer({ id: 1, frames: [{ ...frame(0, 100), scaleX: -2, scaleY: 3, rotation: 45 }] }),
  ];
  const poses = layers.map((l) => ({ ...l.frames[0]!, color: [255, 255, 255] as const, sprite: null }));
  const expected = layerWorldMatrices({ name: 'fixture', stageW: 100, stageH: 100, layers });
  const actual = previewWorldMatrices(layers, poses);
  for (const l of layers) {
    actual.get(l.id)!.forEach((v, i) => assert.ok(Math.abs(v - expected.get(l.id)![i]!) < 1e-9));
  }
});

test('every ancestor anchor is inherited under nonuniform scale and mirroring', () => {
  const layers = [layer({ id: 0, anchorX: 10, anchorY: 20 }),
    layer({ id: 1, parent: 0, anchorX: 2, anchorY: 3 }),
    layer({ id: 2, parent: 1, anchorX: 1, anchorY: 2 })];
  const poses = layers.map((l) => core.sample(l, 0));
  Object.assign(poses[0]!, { x: 100, y: 80, scaleX: -2, scaleY: 3 });
  Object.assign(poses[1]!, { x: 5, y: 7 });
  Object.assign(poses[2]!, { x: 4, y: 6 });
  const worlds = previewWorldMatrices(layers, poses);
  assert.equal(worlds.get(0)![4], 120); assert.equal(worlds.get(0)![5], 20);
  assert.equal(worlds.get(1)![4], 114); assert.equal(worlds.get(1)![5], 32);
  assert.equal(worlds.get(2)![4], 108); assert.equal(worlds.get(2)![5], 44);
});

test('layers without sprite keys keep the initial atlas sprite instead of resolving an empty name', () => {
  const f = frame(0, 10, ''); f.native!.beforeSprite = 255;
  const s = scene(layer({ frames: [f], name: 'transform-only node' }));
  const preview = new AnimationPreview(s, core);
  const draws = preview.drawsAt(0.5).filter((d) => d.instanceId === 'monster:1');
  assert.equal(preview.activeInstanceCount, 1);
  assert.equal(preview.diagnostics.length, 0);
  assert.equal(draws[0]!.fx, 0);
});

test('before a future sprite key, the fresh sheet uses its initial index rather than the future key', () => {
  const f = frame(1, 10, 'b');
  const s = scene(layer({ frames: [f] }));
  // Supply an earlier numeric key while omitting only its sprite property.
  const numeric = frame(0, 10, ''); numeric.native!.beforeSprite = 255;
  s.runtime.rigs.rig0!.clip.layers[0]!.frames.unshift(numeric);
  const preview = new AnimationPreview(s, core);
  const early = preview.drawsAt(0.5).find((d) => d.instanceId === 'monster:1')!;
  assert.equal(early.fx, 0);
  const active = preview.drawsAt(1).find((d) => d.instanceId === 'monster:1')!;
  assert.equal(active.fx, 10);
});

test('hierarchy errors are explicit, not infinite recursion', () => {
  const l = layer({ parent: 0 }); const poses = [core.sample(l, 0)];
  assert.throws(() => previewWorldMatrices([l], poses), /Cyclic/);
  assert.throws(() => previewWorldMatrices([layer({ parent: 99 })], poses), /Missing parent/);
  assert.throws(() => previewWorldMatrices([layer(), layer()], [...poses, ...poses]), /Duplicate/);
});

test('WASM animation replaces only its own rest pose and applies instance placement', () => {
  const s = scene();
  s.runtime.instances.push({ id: 'monster:2', rig: 'rig0', z: 2, origin: [-1, 0, 0, 1, 100, 0], title: 'Flipped copy' });
  const preview = new AnimationPreview(s, core);
  const draws = preview.drawsAt(0.5);
  assert.equal(draws.length, 3);
  assert.equal(draws[0]!.z, -100);
  assert.equal(draws[1]!.m[4], 18);
  assert.equal(draws[2]!.m[4], 82);
  assert.equal(preview.activeInstanceCount, 2);
  assert.equal(preview.drawsAt(1)[1]!.fx, 10);
  assert.equal(s.draws[1]!.m[4], 8, 'payload is never mutated');
});

test('opacity zero removes the animated layer without reviving its rest pose', () => {
  const preview = new AnimationPreview(scene(layer({ frames: [frame(0, 10, 'a', 0)] })), core);
  assert.equal(preview.drawsAt(0).length, 1);
  assert.equal(preview.activeInstanceCount, 1);
});

test('a failed rig retains the static instance and reports only once', () => {
  const s = scene(layer({ parent: 99 }));
  const preview = new AnimationPreview(s, core);
  assert.deepEqual(preview.drawsAt(0), s.draws);
  assert.deepEqual(preview.drawsAt(1), s.draws);
  assert.equal(preview.activeInstanceCount, 0);
  assert.equal(preview.diagnostics.length, 1);
  assert.match(preview.diagnostics[0]!, /static fallback/);
});
