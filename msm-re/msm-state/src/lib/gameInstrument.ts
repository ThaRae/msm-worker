export type GameInstrument = {
  version: number;
  soundTrack: string;
  animationTrack: string;
  danceTrack: string;
  headerWords: [number, number];
  samples: Array<{ packedNote: number; note: number; file: string; flags: number }>;
  animations: Array<{ words: [number, number]; clip: string; values: [number, number, number]; strings: string[] }>;
};

/** Native descriptor readers 0xB36F40 / 0xB37260. Strings are u32 length,
 * null-terminated payload, padded to four bytes. Unknown fields stay raw. */
export function parseGameInstrument(bytes: Uint8Array): GameInstrument {
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Instrument exceeds size limit');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 0;
  const require = (n: number) => { if (n < 0 || p + n > bytes.length) throw new Error('Truncated instrument'); };
  const u32 = () => { require(4); const n = v.getUint32(p, true); p += 4; return n; };
  const f32 = () => { require(4); const n = v.getFloat32(p, true); p += 4; return n; };
  const string = () => {
    const n = u32(); if (n > 65536) throw new Error('Instrument string exceeds limit');
    const padded = Math.ceil(n / 4) * 4; require(padded);
    const b = bytes.subarray(p, p + n); p += padded;
    const zero = b.indexOf(0);
    return new TextDecoder().decode(zero < 0 ? b : b.subarray(0, zero));
  };
  const count = () => { const n = u32(); if (n > 4096) throw new Error('Instrument collection exceeds limit'); return n; };
  if (string() !== 'budd') throw new Error('Not an instrument descriptor');
  const version = u32(); if (version !== 1) throw new Error('Unsupported instrument version');
  const soundTrack = string(), animationTrack = string(), danceTrack = string();
  const headerWords: [number, number] = [u32(), u32()];
  const samples: GameInstrument['samples'] = [];
  for (let i = 0, n = count(); i < n; i += 1) {
    const packedNote = u32(); samples.push({ packedNote, note: packedNote & 255, file: string(), flags: u32() });
  }
  const animations: GameInstrument['animations'] = [];
  for (let i = 0, n = count(); i < n; i += 1) {
    const words: [number, number] = [u32(), u32()], clip = string();
    const values: [number, number, number] = [f32(), f32(), f32()];
    const strings = Array.from({ length: count() }, string);
    animations.push({ words, clip, values, strings });
    p = Math.ceil(p / 4) * 4;
  }
  if (p !== bytes.length) throw new Error('Trailing instrument data');
  return { version, soundTrack, animationTrack, danceTrack, headerWords, samples, animations };
}
