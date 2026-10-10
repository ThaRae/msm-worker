/**
 * Pins the AEAnim binary layout reversed from ResourceAEAnim.cpp: padded
 * strings, source records, and a one-layer rest pose.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  layerLocalMatrix,
  layerWorldMatrices,
  multiplyMatrix,
  parseAeAnim,
  pickAnimation,
} from './aeAnim.js';

function paddedString(text: string): Buffer {
  const body = Buffer.from(`${text}\0`, 'latin1');
  const padded = Buffer.alloc((body.length + 3) & ~3);
  body.copy(padded);
  const out = Buffer.alloc(4 + padded.length);
  out.writeUInt32LE(body.length, 0);
  padded.copy(out, 4);
  return out;
}

function u16(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function i16(n: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeInt16LE(n);
  return buf;
}

function u32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n);
  return buf;
}

function f32(n: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeFloatLE(n);
  return buf;
}

test('parseAeAnim reads a one-layer rest pose', () => {
  const frame = Buffer.concat([
    f32(0), f32(0), f32(100), f32(80), f32(0), f32(100), f32(100), f32(0), f32(0), f32(0), f32(100),
    u32(0),
    paddedString('body'),
    u32(0xffffffff),
  ]);
  const layer = Buffer.concat([
    paddedString('main structure'),
    u32(1), u32(3),
    i16(-1), u16(5), u16(0), u16(320), u16(440), u16(9),
    f32(160), f32(220),
    paddedString('native layer metadata'),
    u32(2),
    frame,
    // Exercise a nonzero-time record and unknown words without guessing
    // interpolation rules or treating all native fields as floats.
    Buffer.concat([
      f32(12), u32(0x7fc01234), f32(130), f32(90), u32(2),
      f32(75), f32(50), u32(4), f32(45), u32(6), f32(80),
      u32(7), paddedString('body_alt'), u32(0xfffffffe),
    ]),
  ]);
  const anim = Buffer.concat([
    paddedString('structure_breeding'),
    u16(1000), u16(1000), f32(-1), u32(1),
    u32(1),
    layer,
  ]);
  const bin = Buffer.concat([
    u32(1),
    paddedString('breeding_sheet.xml'),
    u16(0), u16(0), u16(0), u16(0),
    u32(1),
    anim,
  ]);

  const parsed = parseAeAnim(bin);
  assert.equal(parsed.sources[0]?.name, 'breeding_sheet.xml');
  const clip = pickAnimation(parsed, 'structure_breeding');
  assert.ok(clip);
  assert.equal(clip.stageW, 1000);
  assert.equal(clip.layers[0]?.width, 320);
  assert.equal(clip.layers[0]?.frames[0]?.sprite, 'body');
  assert.equal(clip.layers[0]?.frames[0]?.x, 100);
  assert.deepEqual(clip.native?.words, [0xbf800000, 1]);
  assert.deepEqual(clip.layers[0]?.native, {
    type: 1, blend: 3, reserved: 9, comment: 'native layer metadata',
  });
  const frames = clip.layers[0]!.frames;
  assert.equal(frames.length, 2);
  assert.equal(frames[0]?.native?.afterSprite, -1);
  assert.deepEqual(frames[1]?.native, {
    words: [12, 0, 130, 90, 0, 75, 50, 0, 45, 0, 80].map((n, i) => {
      if (i === 1) return 0x7fc01234;
      if (i === 4) return 2;
      if (i === 7) return 4;
      if (i === 9) return 6;
      return f32(n).readUInt32LE();
    }),
    beforeSprite: 7, afterSprite: -2,
  });
  assert.equal(frames[1]?.sprite, 'body_alt');
  assert.equal(frames[1]?.scaleX, 0.75);
  assert.equal(frames[1]?.rotation, 45);
});

test('layerLocalMatrix places the sprite relative to its anchor', () => {
  const layer = {
    name: 'body', id: 0, parent: -1, sourceId: 0, width: 320, height: 440,
    anchorX: 160, anchorY: 220,
    frames: [{ x: 500, y: 296, scaleX: 1, scaleY: 1, rotation: 0, opacity: 100, sprite: 'structure_body' }],
  };
  const m = layerLocalMatrix(layer, layer.frames[0]!);
  // Top-left of the 320x440 box: pos - anchor = (340, 76).
  assert.equal(m[4], 340);
  assert.equal(m[5], 76);
  const shifted = multiplyMatrix([1, 0, 0, 1, -500, -500], m);
  assert.equal(shifted[4], -160);
  assert.equal(shifted[5], -424);
});

test('layerWorldMatrices inherits the parent anchor-adjusted top-left space', () => {
  const anim = {
    name: 'Idle',
    stageW: 384,
    stageH: 384,
    layers: [
      {
        name: 'head', id: 6, parent: 7, sourceId: 0, width: 10, height: 10,
        anchorX: 2, anchorY: 3,
        frames: [{ x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 100, sprite: 'head' }],
      },
      {
        name: 'body', id: 7, parent: -1, sourceId: 0, width: 20, height: 20,
        anchorX: 10, anchorY: 20,
        frames: [{ x: 100, y: 80, scaleX: 1, scaleY: 1, rotation: 0, opacity: 100, sprite: 'body' }],
      },
    ],
  };
  const worlds = layerWorldMatrices(anim);
  const body = worlds.get(7);
  const head = worlds.get(6);
  assert.ok(body);
  assert.ok(head);
  // Body sprite top-left is pos - anchor.
  assert.equal(body[4], 90);
  assert.equal(body[5], 60);
  // Parent anchor must also be subtracted: (90,60) + (5,7) - (2,3).
  assert.equal(head[4], 93);
  assert.equal(head[5], 64);
});
