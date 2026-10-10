/**
 * Codec for the game's SFS object format.
 *
 * Reversed from MSM_native.exe:
 * - sfs_SFSWriter_writeObject (0xE73490): object = tag 18, u16 key count,
 *   then per entry: u16 key length, key bytes, typed value.
 * - sfs_SFSWriter_writeValue (0xE72C20): each scalar writes its type tag
 *   followed by a big-endian payload.
 * - sfs_SFSReader_readObject (0xDA4B50) / readValue (0xDA4F20) are the
 *   symmetric parse on the receive side.
 *
 * Notable details: everything is big-endian; strings are u16-length-prefixed
 * UTF-8; objects iterate keys in sorted order because the client stores
 * entries in a std::map. Typed arrays (tag 12 etc.) carry a u16 element
 * count — see the IntArray branch in encodeValue.
 */

import { SfsTag, type SfsArray, type SfsObject, type SfsValue } from '../types/sfs.js';

export class SfsDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SfsDecodeError';
  }
}

export class SfsEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SfsEncodeError';
  }
}

export const newSfsObject = (): SfsObject => ({ kind: 'object', entries: new Map() });

export const newSfsArray = (): SfsArray => ({ kind: 'array', items: [] });

/**
 * Narrow a decoded SfsValue to SfsObject. Decoding produces plain JS
 * arrays for fixed-type arrays and Uint8Array for byte arrays, so the
 * discriminating `kind` field is the only reliable test.
 */
export function isSfsObject(value: unknown): value is SfsObject {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    (value as { kind?: unknown }).kind === 'object'
  );
}

/** Narrow a decoded SfsValue to a heterogeneous SfsArray (tag 17). */
export function isSfsArray(value: unknown): value is SfsArray {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    (value as { kind?: unknown }).kind === 'array'
  );
}

/** Decode a full SFSObject starting at offset. Returns value and new offset. */
export function decodeObject(
  buf: Uint8Array,
  offset: number,
): { value: SfsObject; offset: number } {
  const tag = readU8(buf, offset);
  offset += 1;
  if (tag !== SfsTag.SfsObject) {
    throw new SfsDecodeError(`expected object tag 18, got ${tag} at offset ${offset - 1}`);
  }
  const keyCount = readU16(buf, offset);
  offset += 2;
  const obj = newSfsObject();
  for (let i = 0; i < keyCount; i++) {
    const key = readUtf8(buf, offset);
    offset = key.offset;
    const decoded = decodeValue(buf, offset);
    offset = decoded.offset;
    obj.entries.set(key.value, decoded.value);
  }
  return { value: obj, offset };
}

/** Decode a typed value (tag byte + payload). */
export function decodeValue(
  buf: Uint8Array,
  offset: number,
): { value: SfsValue; offset: number } {
  const tag = readU8(buf, offset);
  const start = offset;
  offset += 1;

  switch (tag) {
    case SfsTag.Bool: {
      const value = readU8(buf, offset) !== 0;
      return { value, offset: offset + 1 };
    }
    case SfsTag.Byte: {
      // Signed char per the client's reader (case 2 at 0xDA4F20).
      const value = BigInt.asIntN(8, BigInt(readU8(buf, offset)));
      return { value: Number(value), offset: offset + 1 };
    }
    case SfsTag.Short: {
      // Signed short, u16 big-endian per the client's reader (case 3).
      const value = BigInt.asIntN(16, BigInt(readU16(buf, offset)));
      return { value: Number(value), offset: offset + 2 };
    }
    case SfsTag.Int: {
      const value = BigInt.asIntN(32, BigInt(readU32(buf, offset)));
      return { value: Number(value), offset: offset + 4 };
    }
    case SfsTag.Long: {
      const value = readU64(buf, offset);
      return { value: BigInt.asIntN(64, value), offset: offset + 8 };
    }
    case SfsTag.Float: {
      const value = bufF32(buf, offset);
      return { value, offset: offset + 4 };
    }
    case SfsTag.Double: {
      const value = bufF64(buf, offset);
      return { value, offset: offset + 8 };
    }
    case SfsTag.UtfString: {
      const str = readUtf8(buf, offset);
      return { value: str.value, offset: str.offset };
    }
    case SfsTag.BoolArray: {
      const count = readU16(buf, offset);
      offset += 2;
      const value = Array.from({ length: count }, () => {
        const b = readU8(buf, offset) !== 0;
        offset += 1;
        return b;
      });
      return { value, offset };
    }
    case SfsTag.ByteArray: {
      const length = readU32(buf, offset);
      offset += 4;
      const value = buf.subarray(offset, offset + Number(length));
      offset += Number(length);
      return { value, offset };
    }
    case SfsTag.ShortArray:
    case SfsTag.IntArray:
    case SfsTag.FloatArray: {
      // Short/int/float arrays: u16 count, then fixed-width elements.
      const width = tag === SfsTag.ShortArray ? 2 : tag === SfsTag.IntArray ? 4 : 4;
      const count = readU16(buf, offset);
      offset += 2;
      const value: number[] = [];
      for (let i = 0; i < count; i++) {
        const element = width === 2 ? readU16(buf, offset) : readU32(buf, offset);
        offset += width;
        value.push(
          tag === SfsTag.FloatArray ? bufF32(buf, offset - 4) : Number(element),
        );
      }
      return { value, offset };
    }
    case SfsTag.LongArray:
    case SfsTag.DoubleArray: {
      const count = readU16(buf, offset);
      offset += 2;
      const value: SfsValue[] = [];
      for (let i = 0; i < count; i++) {
        const raw = readU64(buf, offset);
        offset += 8;
        value.push(
          tag === SfsTag.LongArray
            ? BigInt.asIntN(64, raw)
            : bufF64(buf, offset - 8),
        );
      }
      return { value, offset };
    }
    case SfsTag.StringArray: {
      const count = readU16(buf, offset);
      offset += 2;
      const value: string[] = [];
      for (let i = 0; i < count; i++) {
        const str = readUtf8(buf, offset);
        offset = str.offset;
        value.push(str.value);
      }
      return { value, offset };
    }
    case SfsTag.SfsArray: {
      const count = readU16(buf, offset);
      offset += 2;
      const arr = newSfsArray();
      for (let i = 0; i < count; i++) {
        const decoded = decodeValue(buf, offset);
        offset = decoded.offset;
        arr.items.push(decoded.value);
      }
      return { value: arr, offset };
    }
    case SfsTag.SfsObject: {
      const decoded = decodeObject(buf, start);
      return decoded;
    }
    default:
      throw new SfsDecodeError(`unknown SFS type tag ${tag} at offset ${start}`);
  }
}

/** Encode an SfsObject to bytes (tag 18 included, sorted keys). */
export function encodeObject(obj: SfsObject): Uint8Array {
  const out: number[] = [];
  const keys = [...obj.entries.keys()].sort();
  writeU8(out, SfsTag.SfsObject);
  writeU16(out, keys.length);
  for (const key of keys) {
    const value = obj.entries.get(key);
    if (value === undefined) {
      throw new SfsEncodeError(`missing value for key ${key}`);
    }
    writeUtf8(out, key);
    encodeValue(out, value);
  }
  return Uint8Array.from(out);
}

function encodeValue(out: number[], value: SfsValue): void {
  if (value === null) return;
  switch (typeof value) {
    case 'boolean':
      writeU8(out, SfsTag.Bool);
      writeU8(out, value ? 1 : 0);
      return;
    case 'number':
      // Default to int32 for whole numbers, double otherwise (mirrors the
      // client's SFSData<int> / SFSData<double> split).
      if (Number.isInteger(value) && Number.isSafeInteger(value)) {
        writeU8(out, SfsTag.Int);
        writeU32(out, value >>> 0);
      } else {
        writeU8(out, SfsTag.Double);
        writeF64(out, value);
      }
      return;
    case 'bigint':
      writeU8(out, SfsTag.Long);
      writeU64(out, BigInt.asUintN(64, value));
      return;
    case 'string':
      writeU8(out, SfsTag.UtfString);
      writeUtf8(out, value);
      return;
  }
  if (value instanceof Uint8Array) {
    writeU8(out, SfsTag.ByteArray);
    writeU32(out, value.length);
    out.push(...value);
    return;
  }
  if (!('kind' in value)) {
    // Plain arrays come out of decoding (tags 9-16); the encoder only
    // supports homogeneous typed arrays it wrote itself, so refuse.
    throw new SfsEncodeError('plain JS arrays are not encodable; wrap items in newSfsArray()');
  }
  if (value.kind === 'short') {
    writeU8(out, SfsTag.Short);
    writeU16(out, value.value);
    return;
  }
  if (value.kind === 'double') {
    writeU8(out, SfsTag.Double);
    writeF64(out, value.value);
    return;
  }
  if (value.kind === 'float') {
    writeU8(out, SfsTag.Float);
    // The client writes single-precision (SFSData<float>); a plain
    // DataView f32 round-trips exactly what it read.
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value.value, false);
    out.push(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    return;
  }
  if (value.kind === 'int-array') {
    writeU8(out, SfsTag.IntArray);
    // The client's reader expects a u16 element count (see the IntArray
    // decode branch), so anything longer would be truncated on the wire.
    if (value.values.length > 0xffff) {
      throw new SfsEncodeError(`int array too long: ${value.values.length}`);
    }
    writeU16(out, value.values.length);
    for (const item of value.values) writeU32(out, item >>> 0);
    return;
  }
  if (value.kind === 'array') {
    writeU8(out, SfsTag.SfsArray);
    writeU16(out, value.items.length);
    for (const item of value.items) encodeValue(out, item);
    return;
  }
  writeU8(out, SfsTag.SfsObject);
  const nested = encodeObject(value);
  out.push(...nested.subarray(1)); // skip the duplicate tag byte
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function readU8(buf: Uint8Array, offset: number): number {
  if (offset >= buf.length) throw new SfsDecodeError(`read past end at ${offset}`);
  return buf[offset]!;
}

function readU16(buf: Uint8Array, offset: number): number {
  return (readU8(buf, offset) << 8) | readU8(buf, offset + 1);
}

function readU32(buf: Uint8Array, offset: number): number {
  return (
    (readU8(buf, offset) * 0x1000000) +
    (readU8(buf, offset + 1) << 16) +
    (readU8(buf, offset + 2) << 8) +
    readU8(buf, offset + 3)
  );
}

function readU64(buf: Uint8Array, offset: number): bigint {
  return (BigInt(readU32(buf, offset)) << 32n) | BigInt(readU32(buf, offset + 4));
}

function bufF32(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
  return view.getFloat32(0, false);
}

function bufF64(buf: Uint8Array, offset: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
  return view.getFloat64(0, false);
}

function readUtf8(buf: Uint8Array, offset: number): { value: string; offset: number } {
  const length = readU16(buf, offset);
  offset += 2;
  const value = textDecoder.decode(buf.subarray(offset, offset + length));
  return { value, offset: offset + length };
}

function writeU8(out: number[], v: number): void {
  out.push(v & 0xff);
}

function writeU16(out: number[], v: number): void {
  out.push((v >> 8) & 0xff, v & 0xff);
}

function writeU32(out: number[], v: number): void {
  out.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

function writeU64(out: number[], v: bigint): void {
  for (let shift = 56n; shift >= 0n; shift -= 8n) {
    out.push(Number((v >> shift) & 0xffn));
  }
}

function writeF64(out: number[], v: number): void {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, v, false);
  out.push(...bytes);
}

function writeUtf8(out: number[], v: string): void {
  const bytes = textEncoder.encode(v);
  if (bytes.length > 0xffff) {
    throw new SfsEncodeError(`string too long to encode: ${bytes.length}`);
  }
  writeU16(out, bytes.length);
  out.push(...bytes);
}