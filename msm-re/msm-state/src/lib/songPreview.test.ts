import test from 'node:test';
import assert from 'node:assert/strict';
import { SongPreview } from './songPreview.js';
import type { IslandSong } from './islandSong.js';

function fakeAudio() {
  const sources: Array<{ startAt: number | undefined; stopAt: number | undefined; buffer: unknown; connect: () => void; disconnect: () => void; start: (t: number) => void; stop: (t?: number) => void }> = [];
  const audio = {
    currentTime: 10, state: 'running', destination: {},
    createGain: () => ({ gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {}, disconnect: () => {} }),
    createBufferSource: () => {
      const source = { buffer: undefined as unknown, startAt: undefined as number | undefined, stopAt: undefined as number | undefined,
        connect() {}, disconnect() {}, start(t: number) { this.startAt = t; }, stop(t?: number) { this.stopAt = t; } };
      sources.push(source); return source;
    },
    decodeAudioData: async () => ({ length: 100, numberOfChannels: 2 }),
    resume: async () => { audio.state = 'running'; }, suspend: async () => { audio.state = 'suspended'; }, close: async () => { audio.state = 'closed'; },
  };
  return { audio, sources, context: audio as unknown as AudioContext };
}
const song: IslandSong = { version: 1, midi: 'fixture.mid', duration: 3, diagnostics: [],
  events: [0, 0.25, 1, 2].map((start) => ({ start, end: start + 0.5, gain: 1, url: '/api/audio/music/fixture.ogg', track: 'B', note: 72 })) };

test('original samples preload once, audio-clock lookahead schedules without drift or missed-note bursts', async (t) => {
  let fetched = 0;
  t.mock.method(globalThis, 'fetch', async () => { fetched += 1; return new Response(new Uint8Array([1])); });
  const { audio, context, sources } = fakeAudio();
  const transport = new SongPreview(song, context);
  try {
    await transport.start(); assert.equal(fetched, 1); assert.equal(transport.sampleCount, 1);
    assert.equal(transport.scheduledCount, 1); assert.equal(sources[0]!.startAt, 10.08);
    assert.equal(sources[0]!.stopAt, 10.08 + 0.5 + 0.02);
    audio.currentTime = 10.2; transport.pump(); assert.equal(transport.scheduledCount, 2);
    assert.equal(sources[1]!.startAt, 10.33);
    transport.suspend(); audio.currentTime = 11; transport.pump(); assert.equal(transport.scheduledCount, 2);
    transport.resume(); audio.currentTime = 12; transport.pump(); assert.equal(transport.scheduledCount, 3);
    assert.equal(sources[2]!.startAt, 12.08);
    assert.match(transport.diagnostics.join(), /missed notes skipped/);
    audio.currentTime = 20; transport.pump(); assert.equal(transport.finished, true); assert.equal(transport.elapsed, 3);
  } finally { transport.dispose(); }
  assert.equal(audio.state, 'closed'); assert.equal(transport.sampleCount, 0); assert.equal(transport.started, false);
});
test('audio failure closes transport and leaves no retained decoded resources', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }));
  const { audio, context } = fakeAudio(); const transport = new SongPreview(song, context);
  await assert.rejects(transport.start(), /Sample load failed/);
  assert.equal(audio.state, 'closed'); assert.equal(transport.sampleCount, 0);
});
test('transport rejects hostile payloads before loading any audio', () => {
  for (const change of [{ start: NaN }, { gain: 100 }, { url: '/api/audio/music/../secret.ogg' }, { end: 10 }]) {
    assert.throws(() => new SongPreview({ ...song, events: [{ ...song.events[0]!, ...change }] }, fakeAudio().context), /Invalid song event/);
  }
});
