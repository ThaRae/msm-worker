/** Bounded Standard MIDI File reader. Timing interpretation is deliberately
 * separate: the native loader is not a general tempo-map MIDI player. */
export type MidiNote = { tick: number; channel: number; note: number; velocity: number; on: boolean };
export type MidiTrack = { name: string; endTick: number; notes: MidiNote[]; markers: Array<{ tick: number; text: string }> };
export type GameMidi = { format: number; ppq: number; tracks: MidiTrack[]; tempos: Array<{ tick: number; microseconds: number }> };

export function parseGameMidi(bytes: Uint8Array): GameMidi {
  if (bytes.length > 16 * 1024 * 1024) throw new Error('MIDI exceeds size limit');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0, end = bytes.length;
  const require = (n: number) => { if (n < 0 || p + n > end) throw new Error('Truncated MIDI'); };
  const byte = () => { require(1); return bytes[p++]!; };
  const u16 = () => { require(2); const n = view.getUint16(p); p += 2; return n; };
  const u32 = () => { require(4); const n = view.getUint32(p); p += 4; return n; };
  const text = (n: number) => { require(n); const s = new TextDecoder().decode(bytes.subarray(p, p + n)); p += n; return s; };
  const vlq = () => {
    let n = 0;
    for (let i = 0; i < 4; i += 1) { const b = byte(); n = n * 128 + (b & 127); if (b < 128) return n; }
    throw new Error('Invalid MIDI variable-length quantity');
  };
  if (text(4) !== 'MThd') throw new Error('Not a MIDI file');
  const headerLength = u32();
  if (headerLength < 6) throw new Error('Invalid MIDI header');
  require(headerLength);
  const headerEnd = p + headerLength;
  const format = u16(), count = u16(), ppq = u16();
  if (format > 1 || count === 0 || count > 512 || (format === 0 && count !== 1)) throw new Error('Unsupported MIDI format');
  if (ppq === 0 || (ppq & 0x8000) !== 0) throw new Error('Unsupported MIDI time division');
  p = headerEnd;
  const tracks: MidiTrack[] = [], tempos: GameMidi['tempos'] = [];
  let eventCount = 0;
  for (let i = 0; i < count; i += 1) {
    end = bytes.length;
    if (text(4) !== 'MTrk') throw new Error('Missing MIDI track');
    const size = u32(); require(size); end = p + size;
    const track: MidiTrack = { name: '', endTick: 0, notes: [], markers: [] };
    let tick = 0, running = 0, ended = false;
    while (p < end) {
      if (++eventCount > 500_000) throw new Error('MIDI exceeds event limit');
      tick += vlq();
      if (!Number.isSafeInteger(tick)) throw new Error('MIDI tick overflow');
      let status = byte();
      if (status < 128) { p -= 1; if (running === 0) throw new Error('Missing MIDI running status'); status = running; }
      if (status === 0xff) {
        running = 0;
        const kind = byte(), length = vlq(); require(length);
        if (kind === 0x51) {
          if (length !== 3) throw new Error('Invalid MIDI tempo');
          const microseconds = byte() * 65536 + byte() * 256 + byte();
          if (microseconds === 0) throw new Error('Invalid MIDI tempo');
          tempos.push({ tick, microseconds });
        } else if (kind === 3 || kind === 6) {
          const s = text(length);
          if (kind === 3) track.name = s; else track.markers.push({ tick, text: s });
        } else {
          p += length;
          if (kind === 0x2f) { if (length !== 0) throw new Error('Invalid MIDI end marker'); ended = true; break; }
        }
      } else if (status === 0xf0 || status === 0xf7) {
        running = 0; const length = vlq(); require(length); p += length;
      } else {
        if (status >= 0xf0) throw new Error('Unsupported MIDI status');
        running = status;
        const kind = status >> 4, a = byte(), b = kind === 0xc || kind === 0xd ? 0 : byte();
        if (a >= 128 || b >= 128) throw new Error('Invalid MIDI channel data');
        if (kind === 8 || kind === 9) track.notes.push({ tick, channel: status & 15, note: a, velocity: b, on: kind === 9 && b !== 0 });
      }
    }
    if (!ended) throw new Error('Missing MIDI end marker');
    track.endTick = tick; tracks.push(track); p = end;
  }
  if (p !== bytes.length) throw new Error('Trailing MIDI data');
  return { format, ppq, tracks, tempos };
}

/** Native 0x4C37B0 retains the last tempo encountered while reading tracks;
 * note-on ticks are nudged +1, note-off ticks -1. No tempo-map integration.
 * Bracket markers remain unshifted. Consumers must not use this for generic MIDI. */
export function nativeMidiTiming(midi: GameMidi): { secondsPerBeat: number; secondsAt: (tick: number, on?: boolean) => number } {
  const lastTempo = midi.tempos.at(-1);
  if (!lastTempo) throw new Error('MIDI has no explicit tempo');
  const secondsPerBeat = Math.fround(lastTempo.microseconds / 1_000_000);
  return { secondsPerBeat, secondsAt: (tick, on) => Math.fround(Math.fround((tick + (on === undefined ? 0 : on ? 1 : -1)) / midi.ppq) * secondsPerBeat) };
}
