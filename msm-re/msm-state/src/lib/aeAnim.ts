/**
 * Parser for the game's AEAnim .bin files (sys::res::ResourceAEAnim).
 *
 * Reversed from ResourceAEAnim.cpp / AEAnim.cpp in MSM_native.exe: a
 * length-prefixed string table of texture sources, then animations made
 * of After-Effects-style layers. Each layer has a parent, an anchor, a
 * source id, and keyframes. Frame 0 is the rest pose the island viewer
 * draws. Strings are u32 length (including a NUL) and padded to 4 bytes.
 */

export type AnimSource = {
  name: string;
  id: number;
  width: number;
  height: number;
};

export type AnimKeyframe = {
  /** Native record, retained for the runtime port. Present on parsed files;
   * meanings of the unknown words must be verified before playback uses them.
   * Words retain the original bits (including fields not actually floats).
   */
  native?: { words: number[]; beforeSprite: number; afterSprite: number };
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  sprite: string;
};

export type AnimLayer = {
  native?: { type: number; blend: number; reserved: number; comment: string };
  name: string;
  id: number;
  parent: number;
  sourceId: number;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  frames: AnimKeyframe[];
};

export type Animation = {
  /** The two header words after the stage dimensions, not yet interpreted. */
  native?: { words: [number, number] };
  name: string;
  stageW: number;
  stageH: number;
  layers: AnimLayer[];
};

export type AeAnim = {
  sources: AnimSource[];
  animations: Animation[];
};

/** Affine 2D matrix [a, b, c, d, e, f] mapping (x, y) -> (a x + c y + e, b x + d y + f). */
export type Matrix2d = readonly [number, number, number, number, number, number];

class BinReader {
  constructor(private readonly buf: Buffer, private offset = 0) {}

  get pos(): number {
    return this.offset;
  }

  get length(): number {
    return this.buf.length;
  }

  u32(): number {
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i32(): number {
    const value = this.buf.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u16(): number {
    const value = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  i16(): number {
    const value = this.buf.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  f32(): number {
    const value = this.buf.readFloatLE(this.offset);
    this.offset += 4;
    return value;
  }

  /**
   * Length-prefixed C string. The stored length includes the NUL (and
   * sometimes extra pad bytes already counted); leftover bytes up to the
   * next 4-byte boundary are skipped, matching ReaderBuffer alignment.
   */
  str(): string {
    const len = this.u32();
    if (len < 0 || this.offset + len > this.buf.length) {
      throw new Error('string overruns AEAnim buffer');
    }
    const raw = this.buf.toString('latin1', this.offset, this.offset + len).replace(/\0.*$/s, '');
    this.offset += (len + 3) & ~3;
    return raw;
  }

  skip(n: number): void {
    this.offset += n;
  }
}

function readKeyframe(reader: BinReader): AnimKeyframe {
  // 11 little-endian u32/f32 fields, then i32, sprite string, i32.
  // Frame 0 of every idle/body anim observed: [time, ?, x, y, ?, scaleX%,
  // scaleY%, ?, rotationDeg, ?, opacity%].
  const words: number[] = [];
  const fields: number[] = [];
  const scratch = Buffer.alloc(4);
  for (let i = 0; i < 11; i += 1) {
    const word = reader.u32();
    words.push(word);
    scratch.writeUInt32LE(word);
    fields.push(scratch.readFloatLE());
  }
  const beforeSprite = reader.i32();
  const sprite = reader.str();
  const afterSprite = reader.i32();
  return {
    native: { words, beforeSprite, afterSprite },
    x: fields[2] ?? 0,
    y: fields[3] ?? 0,
    scaleX: (fields[5] ?? 100) / 100,
    scaleY: (fields[6] ?? 100) / 100,
    rotation: fields[8] ?? 0,
    opacity: fields[10] ?? 100,
    sprite,
  };
}

function readLayer(reader: BinReader): AnimLayer {
  const name = reader.str();
  const type = reader.u32();
  const blend = reader.u32();
  const parent = reader.i16();
  const id = reader.u16();
  const sourceId = reader.u16();
  const width = reader.u16();
  const height = reader.u16();
  const reserved = reader.u16();
  const anchorX = reader.f32();
  const anchorY = reader.f32();
  const comment = reader.str();
  const frames = Array.from({ length: reader.u32() }, () => readKeyframe(reader));
  return { native: { type, blend, reserved, comment }, name, id, parent, sourceId, width, height, anchorX, anchorY, frames };
}

function readAnimation(reader: BinReader): Animation {
  const name = reader.str();
  const stageW = reader.u16();
  const stageH = reader.u16();
  const words: [number, number] = [reader.u32(), reader.u32()];
  const layers = Array.from({ length: reader.u32() }, () => readLayer(reader));
  return { native: { words }, name, stageW, stageH, layers };
}

/** Parse a complete AEAnim .bin (structure, monster, or island scene). */
export function parseAeAnim(buf: Buffer): AeAnim {
  const reader = new BinReader(buf);
  const sources = Array.from({ length: reader.u32() }, () => {
    const name = reader.str();
    const id = reader.u16();
    const width = reader.u16();
    const height = reader.u16();
    reader.u16();
    return { name, id, width, height };
  });
  const animations = Array.from({ length: reader.u32() }, () => readAnimation(reader));
  if (reader.pos !== reader.length) {
    throw new Error(`AEAnim parse left ${String(reader.length - reader.pos)} unread bytes`);
  }
  return { sources, animations };
}

function layerRotateScale(frame: AnimKeyframe): { a: number; b: number; c: number; d: number } {
  const rad = (frame.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos * frame.scaleX,
    b: sin * frame.scaleX,
    c: -sin * frame.scaleY,
    d: cos * frame.scaleY,
  };
}

/**
 * T(pos) R S without anchor compensation. This is not the space used for
 * parenting AE layers; children use the parent's untrimmed top-left space.
 */
export function layerParentMatrix(frame: AnimKeyframe): Matrix2d {
  const { a, b, c, d } = layerRotateScale(frame);
  return [a, b, c, d, frame.x, frame.y];
}

/** T(pos) R(rot) S(scale) T(-anchor) — After Effects layer local matrix. */
export function layerLocalMatrix(layer: AnimLayer, frame: AnimKeyframe): Matrix2d {
  const { a, b, c, d } = layerRotateScale(frame);
  return [
    a,
    b,
    c,
    d,
    frame.x - (a * layer.anchorX + c * layer.anchorY),
    frame.y - (b * layer.anchorX + d * layer.anchorY),
  ];
}

export function multiplyMatrix(p: Matrix2d, q: Matrix2d): Matrix2d {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}

export function translateMatrix(x: number, y: number): Matrix2d {
  return [1, 0, 0, 1, x, y];
}

export function scaleAboutMatrix(sx: number, sy: number, ox: number, oy: number): Matrix2d {
  return multiplyMatrix(translateMatrix(ox, oy), multiplyMatrix([sx, 0, 0, sy, 0, 0], translateMatrix(-ox, -oy)));
}

/**
 * World matrix for every layer at frame 0, parents applied. AE lists
 * layers front-to-back, so callers that paint should iterate reversed.
 */
export function layerWorldMatrices(anim: Animation): Map<number, Matrix2d> {
  const byId = new Map(anim.layers.map((layer) => [layer.id, layer]));
  const parentWorld = new Map<number, Matrix2d>();
  const visiting = new Set<number>();
  const parentSpace = (layer: AnimLayer): Matrix2d => {
    const cached = parentWorld.get(layer.id);
    if (cached !== undefined) return cached;
    if (visiting.has(layer.id)) throw new Error('Cyclic layer hierarchy');
    visiting.add(layer.id);
    const frame = layer.frames[0];
    const local = frame === undefined ? ([1, 0, 0, 1, 0, 0] as Matrix2d) : layerLocalMatrix(layer, frame);
    const parent = layer.parent >= 0 ? byId.get(layer.parent) : undefined;
    const matrix = parent === undefined ? local : multiplyMatrix(parentSpace(parent), local);
    visiting.delete(layer.id);
    parentWorld.set(layer.id, matrix);
    return matrix;
  };
  const worlds = new Map<number, Matrix2d>();
  for (const layer of anim.layers) {
    const frame = layer.frames[0];
    if (frame === undefined) {
      worlds.set(layer.id, [1, 0, 0, 1, 0, 0]);
      continue;
    }
    const local = layerLocalMatrix(layer, frame);
    const parent = layer.parent >= 0 ? byId.get(layer.parent) : undefined;
    worlds.set(layer.id, parent === undefined ? local : multiplyMatrix(parentSpace(parent), local));
  }
  return worlds;
}

/** Prefer the named clip, then Idle, then the first clip that is not the store thumbnail. */
export function pickAnimation(file: AeAnim, preferred: string): Animation | undefined {
  const want = preferred.toLowerCase();
  return (
    file.animations.find((anim) => anim.name.toLowerCase() === want) ??
    file.animations.find((anim) => anim.name.toLowerCase() === 'idle') ??
    file.animations.find((anim) => !/store/i.test(anim.name)) ??
    file.animations[0]
  );
}
