import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseGameMidi, nativeMidiTiming } from '../lib/gameMidi.js';
import { parseGameInstrument } from '../lib/gameInstrument.js';
import type { IslandSong } from '../lib/islandSong.js';
import type { Catalogs } from './catalogs.js';
import type { IslandView } from './viewModel.js';

export function audioSamplePath(dataDir: string, name: string): string {
  if (!/^[\w-]+\.ogg$/.test(name)) throw new Error('Invalid audio sample name');
  return join(dataDir, 'audio', 'music', name);
}

export function buildIslandSong(island: IslandView, catalogs: Catalogs, dataDir: string): IslandSong {
  const catalog = catalogs.islandSongs?.get(island.islandVariantId);
  if (!catalog || !/^[\w-]+\.mid$/.test(catalog.midi)) throw new Error('No supported island MIDI');
  const midi = parseGameMidi(readFileSync(join(dataDir, 'audio', 'music', catalog.midi)));
  if (midi.format !== 1) throw new Error('Song preview requires named format-1 tracks');
  const timing = nativeMidiTiming(midi);
  const duration = timing.secondsAt(Math.max(...midi.tracks.map((t) => t.endTick)));
  if (duration <= 0 || duration > 3600) throw new Error('Invalid song duration');
  const song: IslandSong = { version: 1, midi: catalog.midi, duration, events: [], diagnostics: [
    'Full arrangement preview: native adaptive loop skipping, singing animations, pan, duplicate balancing and time-machine pitch are not ported.',
  ] };
  const files = new Set<string>();
  for (const m of island.monsters) {
    if (m.inHotel || m.muted) continue;
    if (m.boxNeeds?.length || m.modes?.length) { song.diagnostics.push(`${m.name}: statue/mode controller unsupported`); continue; }
    const file = catalog.monsters.get(m.monsterId);
    if (file) files.add(file); else song.diagnostics.push(`${m.name}: no instrument mapping`);
  }
  for (const s of island.structures) {
    if (s.inWarehouse || s.isUpgrading) continue;
    // Only the castle bass is unconditional. Clubbox, time machine, island
    // awakening and other structure controllers must not sound merely by ownership.
    if (s.structureType !== 'castle') continue;
    const file = catalog.structures.get(s.structureId); if (file) files.add(file);
  }
  for (const file of files) {
    try {
      if (!/^[\w-]+\.bin$/.test(file)) throw new Error('Unsupported descriptor name');
      const instrument = parseGameInstrument(readFileSync(join(dataDir, 'xml_bin', file)));
      const matches = midi.tracks.filter((t) => t.name === instrument.soundTrack);
      if (matches.length !== 1) throw new Error('Missing/ambiguous sound track');
      const track = matches[0]!;
      const samples = new Map<number, string>();
      for (const sample of instrument.samples) {
        const match = /^audio\/music\/([\w-]+\.ogg)$/.exec(sample.file);
        if (!match || sample.note > 127 || sample.flags !== 0 || samples.has(sample.note)) throw new Error('Unsupported sample mapping');
        const path = audioSamplePath(dataDir, match[1]!);
        if (statSync(path).size > 24 * 1024 * 1024) throw new Error('Sample exceeds size limit');
        samples.set(sample.note, `/api/audio/music/${match[1]}`);
      }
      const pending = new Map<number, IslandSong['events']>();
      const events: IslandSong['events'] = [];
      for (const note of track.notes) {
        const time = timing.secondsAt(note.tick, note.on);
        if (!note.on) {
          for (const event of pending.get(note.note) ?? []) event.end = Math.min(duration, Math.max(event.start, time));
          pending.delete(note.note); continue;
        }
        const url = samples.get(note.note);
        // Native nearest-key pitch mapping is not guessed: exact keys only.
        if (!url) throw new Error(`Unsupported unmapped MIDI note ${note.note}`);
        if (time >= duration) continue;
        const event = { start: time, end: duration, url, gain: note.velocity / 100, track: track.name, note: note.note };
        events.push(event);
        const voices = pending.get(note.note) ?? []; voices.push(event); pending.set(note.note, voices);
      }
      song.events.push(...events);
    } catch (error) { song.diagnostics.push(`${file}: silent fallback — ${error instanceof Error ? error.message : String(error)}`); }
  }
  song.events.sort((a, b) => a.start - b.start);
  if (song.events.length > 50_000 || new Set(song.events.map((e) => e.url)).size > 96) throw new Error('Song exceeds preview limits');
  return song;
}
