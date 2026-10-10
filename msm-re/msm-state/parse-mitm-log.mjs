/**
 * Decode ws-mitm captured frames through the msm-state SFS codec to see
 * the full command dance (direction, cmd, payload keys) in session order.
 *
 * Usage: node parse-mitm-log.mjs ../mitm-ws/mitm.log
 */

import { readFileSync } from 'node:fs';
import { decodePacket, sfsToJson } from './dist/lib/packet.js';

const logPath = process.argv[2] ?? '../mitm-ws/mitm.log';
const lines = readFileSync(logPath, 'utf8').split('\n');

const frameRe = /\[(\S+) (C2S|S2C) (\d+)b\] ([0-9a-f]+)(\.\.\.)?$/;
for (const line of lines) {
  const match = frameRe.exec(line);
  if (match === null) continue;
  const [, ts, dir, size, hex, truncated] = match;
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  try {
    const packet = decodePacket(bytes);
    const keys = packet.data === undefined ? '' : [...packet.data.entries.keys()].join(',');
    const preview =
      packet.data === undefined ? '' : JSON.stringify(sfsToJson(packet.data)).slice(0, 160);
    console.log(
      `${ts} ${dir} ${String(size).padStart(6)} seq=${packet.seq} ${packet.cmd} [${keys}] ${preview}`,
    );
  } catch (err) {
    console.log(`${ts} ${dir} ${size}b PARSE FAIL: ${err.message} raw=${hex.slice(0, 80)}`);
  }
  if (truncated !== undefined) {
    console.log('  (frame truncated in log; preview only)');
  }
}