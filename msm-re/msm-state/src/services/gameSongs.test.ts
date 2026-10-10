import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseGameInstrument } from '../lib/gameInstrument.js';
import { parseGameMidi } from '../lib/gameMidi.js';
import { buildApiState } from './viewModel.js';
import { loadCatalogs } from './catalogs.js';
import { gameDataDir } from './gameAssets.js';
import { audioSamplePath, buildIslandSong } from './gameSongs.js';

const root = gameDataDir();
const available = existsSync(join(root, 'xml_bin', '001_B.bin')) && existsSync('../catalogs/db_island_v2.json');

test('audio sample paths restrict extension, separators and traversal', () => {
  assert.equal(audioSamplePath('/game', '01-B_Monster_01.ogg'), '/game/audio/music/01-B_Monster_01.ogg');
  for (const s of ['../secret.ogg', 'a/b.ogg', 'a.wav', '%2e%2e.ogg', 'x.ogg/secret', '.ogg']) assert.throws(() => audioSamplePath('/game', s));
});
test('real native instrument descriptor preserves sample and animation note mappings', { skip: !available }, () => {
  const bytes = readFileSync(join(root, 'xml_bin', '001_B.bin'));
  const instrument = parseGameInstrument(bytes);
  assert.equal(instrument.soundTrack, 'B_Monster'); assert.equal(instrument.animationTrack, 'B_Animation');
  assert.deepEqual(instrument.headerWords, [120, 1]);
  assert.deepEqual(instrument.samples.map((s) => [s.note, s.packedNote, s.file]), [
    [72, 0xff48, 'audio/music/01-B_Monster_01.ogg'], [73, 0xff49, 'audio/music/01-B_Monster_02.ogg'],
  ]);
  assert.equal(instrument.animations[2]!.clip, '01-B_Dance_01');
  for (let i = 0; i < bytes.length; i += 1) assert.throws(() => parseGameInstrument(bytes.subarray(0, i)));
});
test('all installed island MIDI files parse without needing a login', { skip: !available }, () => {
  const files = readdirSync(join(root, 'audio', 'music')).filter((f) => f.endsWith('.mid'));
  assert.ok(files.length >= 43);
  for (const file of files) assert.ok(parseGameMidi(readFileSync(join(root, 'audio', 'music', file))).tracks.length, file);
});
test('Plant song uses only owned, audible monsters and unconditional castle bass', { skip: !available }, () => {
  const catalogs = loadCatalogs('../catalogs');
  const island = buildApiState({ islands: [{ user_island_id: '1', island: 1, type: 1,
    monsters: [{ user_monster_id: '1', monster: 2, level: 1, pos_x: 18, pos_y: 18 }], structures: [] }] }, catalogs, 0).islands[0]!;
  const song = buildIslandSong(island, catalogs, root);
  assert.equal(song.events.length, 16); assert.ok(song.duration > 178 && song.duration < 179);
  assert.equal(song.events[0]!.note, 73); assert.equal(song.events[0]!.gain, 1);
  assert.equal(song.events[0]!.url, '/api/audio/music/01-B_Monster_02.ogg');
  assert.ok(song.events[0]!.start > 0 && song.events[0]!.start < 0.001);
  assert.ok(song.events[0]!.end > 6.85 && song.events[0]!.end < 6.86);
  island.monsters[0]!.muted = true;
  assert.equal(buildIslandSong(island, catalogs, root).events.length, 0);
  island.monsters[0]!.muted = false; island.monsters[0]!.inHotel = true;
  assert.equal(buildIslandSong(island, catalogs, root).events.length, 0);
});
