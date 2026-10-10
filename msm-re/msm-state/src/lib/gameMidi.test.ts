import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGameMidi, nativeMidiTiming } from './gameMidi.js';

function midi(events: number[]): Uint8Array {
  const b = Buffer.alloc(22 + events.length);
  b.write('MThd'); b.writeUInt32BE(6, 4); b.writeUInt16BE(1, 8); b.writeUInt16BE(1, 10); b.writeUInt16BE(480, 12);
  b.write('MTrk', 14); b.writeUInt32BE(events.length, 18); b.set(events, 22); return b;
}
const events = [0, 255, 81, 3, 7, 161, 32, 0, 255, 3, 1, 66,
  0, 0x90, 72, 100, 0x83, 0x60, 72, 0, 0, 255, 6, 1, 93, 0, 255, 47, 0];

test('MIDI track names, running status, zero-velocity release and bracket markers', () => {
  const m = parseGameMidi(midi(events));
  assert.equal(m.ppq, 480); assert.equal(m.tracks[0]!.name, 'B');
  assert.deepEqual(m.tracks[0]!.notes.map((n) => [n.tick, n.on]), [[0, true], [480, false]]);
  assert.deepEqual(m.tracks[0]!.markers, [{ tick: 480, text: ']' }]);
  const timing = nativeMidiTiming(m);
  assert.equal(timing.secondsAt(0, true), Math.fround(Math.fround(1 / 480) * 0.5));
  assert.equal(timing.secondsAt(480, false), Math.fround(Math.fround(479 / 480) * 0.5));
  assert.equal(timing.secondsAt(480), 0.5);
});
test('native timing retains last encountered tempo, rather than integrating changes', () => {
  const m = parseGameMidi(midi([0, 255, 81, 3, 7, 161, 32, 0x83, 0x60, 255, 81, 3, 15, 66, 64, 0, 255, 47, 0]));
  assert.equal(nativeMidiTiming(m).secondsAt(480), 1);
  assert.throws(() => nativeMidiTiming({ ...m, tempos: [] }), /explicit tempo/);
});
test('MIDI reader rejects every truncation and malformed/unsupported inputs', () => {
  const b = midi(events);
  for (let n = 0; n < b.length; n += 1) assert.throws(() => parseGameMidi(b.subarray(0, n)));
  assert.throws(() => parseGameMidi(midi([0, 72, 100])), /running status/);
  assert.throws(() => parseGameMidi(midi([0x80, 0x80, 0x80, 0x80, 0, 255, 47, 0])), /variable-length/);
  const smpte = Uint8Array.from(b); smpte[12] = 0xe8;
  assert.throws(() => parseGameMidi(smpte), /time division/);
  assert.throws(() => parseGameMidi(midi([0, 255, 81, 2, 1, 2, 0, 255, 47, 0])), /tempo/);
});
