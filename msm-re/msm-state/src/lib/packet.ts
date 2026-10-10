/**
 * Packet framing for the game socket ("tomcat" transport).
 *
 * Reversed from MSM_native.exe (sfs::SFSTomcatClient):
 * - login (sfs_SFSTomcatClient_login @ 0xDAABA0) and requests
 *   (sfs_SFSTomcatClient_sendRequest @ 0xDAB0B0) write:
 *       [i64 big-endian sequence id][u16 cmd length][cmd bytes][SFSObject]
 *   The keep-alive sender (0xDAB1F0) omits the trailing object, so the
 *   payload object is optional.
 * - the receive dispatcher (sfs_SFSTomcatClient_onDispatchCommand @ 0xDAB650)
 *   parses [cmd string][SFSObject]; the sequence id is consumed by the
 *   lower websocket layer. We accept both shapes when parsing.
 */

import { decodeObject, decodeValue, encodeObject, isSfsObject } from './sfs.js';
import type { SfsObject, SfsValue } from '../types/sfs.js';

export type GamePacket = {
  /** 64-bit sequence id echoed by the server; 0n when absent. */
  seq: bigint;
  cmd: string;
  /** Payload object when present. */
  data: SfsObject | undefined;
};

/** Encode a client->server packet. */
export function encodePacket(seq: bigint, cmd: string, data?: SfsObject): Uint8Array {
  const cmdBytes = new TextEncoder().encode(cmd);
  if (cmdBytes.length > 0xffff) {
    throw new Error(`command too long: ${cmd}`);
  }
  const payload = data === undefined ? new Uint8Array(0) : encodeObject(data);
  const out = new Uint8Array(8 + 2 + cmdBytes.length + payload.length);
  const view = new DataView(out.buffer);
  view.setBigInt64(0, seq, false);
  view.setUint16(8, cmdBytes.length, false);
  out.set(cmdBytes, 10);
  out.set(payload, 10 + cmdBytes.length);
  return out;
}

/**
 * Decode a server->client packet.
 *
 * Empirically (via mitm of the live game) server frames carry NO sequence
 * prefix: [u16 cmdlen][cmd][SFSObject]. The seq-first interpretation can
 * still parse short frames incorrectly (e.g. CID misparses as cmd "cid"),
 * so the no-seq layout must be attempted first.
 */
export function decodePacket(buf: Uint8Array): GamePacket {
  const withoutSeq = tryDecode(buf, 0);
  if (withoutSeq !== undefined) {
    return { seq: 0n, ...withoutSeq };
  }
  const withSeq = tryDecode(buf, 8);
  if (withSeq === undefined) {
    throw new Error(`unparseable game packet (${buf.length} bytes)`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, 8);
  return { seq: view.getBigInt64(0, false), ...withSeq };
}

function tryDecode(
  buf: Uint8Array,
  seqBytes: number,
): { cmd: string; data: SfsObject | undefined } | undefined {
  if (buf.length < seqBytes + 2) return undefined;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.length);
  const cmdLen = view.getUint16(seqBytes, false);
  if (cmdLen === 0 || seqBytes + 2 + cmdLen > buf.length) return undefined;
  const cmdBytes = buf.subarray(seqBytes + 2, seqBytes + 2 + cmdLen);
  // Commands are short printable ASCII identifiers; reject garbage so the
  // alternate framing attempt gets a chance.
  const printable = cmdBytes.every((b) => b >= 0x20 && b <= 0x7e);
  if (!printable) return undefined;
  const cmd = new TextDecoder().decode(cmdBytes);

  let offset = seqBytes + 2 + cmdLen;
  let data: SfsObject | undefined;
  if (offset < buf.length) {
    const tag = view.getUint8(offset);
    const decoded = tag === 18 ? decodeObject(buf, offset) : decodeValue(buf, offset);
    if (decoded.offset !== buf.length) return undefined;
    const value = decoded.value;
    // Payload must be a nested object; plain scalars/arrays mean we
    // mis-guessed the framing.
    if (!isSfsObject(value)) {
      return undefined;
    }
    data = value;
  }
  return { cmd, data };
}

/** Convert an SfsValue tree to a JSON-friendly structure for display. */
export function sfsToJson(value: SfsValue): unknown {
  switch (typeof value) {
    case 'bigint':
      return value.toString();
    case 'boolean':
    case 'number':
    case 'string':
      return value;
  }
  if (value === null) return null;
  if (value instanceof Uint8Array) {
    return `<bytes:${String(value.length)}>`;
  }
  if ('kind' in value && value.kind === 'short') {
    return value.value;
  }
  if ('kind' in value && value.kind === 'double') {
    return value.value;
  }
  if ('kind' in value && value.kind === 'float') {
    return value.value;
  }
  if ('kind' in value && value.kind === 'int-array') {
    return value.values;
  }
  // Fixed-type arrays (tags 9-16) are plain JS arrays; SfsArray carries
  // heterogeneous items.
  if (Array.isArray(value)) {
    return value.map(sfsToJson);
  }
  if (value.kind === 'array') {
    return value.items.map(sfsToJson);
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of value.entries) {
    out[key] = sfsToJson(entry);
  }
  return out;
}