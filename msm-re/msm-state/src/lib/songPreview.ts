import type { IslandSong } from './islandSong.js';

/** Web Audio host for exact-key original samples. The audio clock owns note
 * scheduling; interval callbacks only fill a short lookahead, never set tempo.
 * One full arrangement, not the game's adaptive loop/animation controller. */
export class SongPreview {
  readonly diagnostics: string[];
  scheduledCount = 0;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices = new Set<AudioBufferSourceNode>();
  private readonly abort = new AbortController();
  private readonly master: GainNode;
  private timer: ReturnType<typeof setInterval> | undefined;
  private origin: number | undefined;
  private next = 0;
  private disposed = false;
  private starting = false;

  constructor(readonly song: IslandSong, private readonly context: AudioContext) {
    if (song.version !== 1 || !Number.isFinite(song.duration) || song.duration <= 0 || song.duration > 3600 || song.events.length > 50_000) throw new Error('Invalid song preview');
    let last = -1;
    for (const e of song.events) {
      if (![e.start, e.end, e.gain].every(Number.isFinite) || e.start < last || e.start < 0 || e.start >= song.duration || e.end < e.start || e.end > song.duration || e.gain < 0 || e.gain > 2 || !/^\/api\/audio\/music\/[\w-]+\.ogg$/.test(e.url)) throw new Error('Invalid song event');
      last = e.start;
    }
    this.diagnostics = [...song.diagnostics];
    this.master = context.createGain(); this.master.gain.value = 0.35;
    this.master.connect(context.destination);
  }

  get elapsed(): number { return this.origin === undefined ? 0 : Math.max(0, Math.min(this.song.duration, this.context.currentTime - this.origin)); }
  get started(): boolean { return this.origin !== undefined && !this.disposed; }
  get finished(): boolean { return this.started && this.elapsed >= this.song.duration; }
  get sampleCount(): number { return this.buffers.size; }

  /** Must be invoked directly from a user gesture, before its first await. */
  async start(): Promise<void> {
    if (this.disposed || this.starting || this.started) throw new Error('Song transport already used');
    this.starting = true;
    try {
      await this.context.resume();
      const urls = [...new Set(this.song.events.map((e) => e.url))];
      if (urls.length > 96) throw new Error('Too many audio samples');
      let cursor = 0, decodedBytes = 0;
      await Promise.all(Array.from({ length: Math.min(4, urls.length) }, async () => {
        while (cursor < urls.length) {
          const url = urls[cursor++]!;
          const response = await fetch(url, { signal: this.abort.signal });
          if (!response.ok) throw new Error(`Sample load failed (${response.status})`);
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength > 24 * 1024 * 1024) throw new Error('Audio sample exceeds limit');
          const buffer = await this.context.decodeAudioData(bytes);
          if (this.disposed) throw new Error('Song load cancelled');
          decodedBytes += buffer.length * buffer.numberOfChannels * 4;
          if (decodedBytes > 256 * 1024 * 1024) throw new Error('Decoded audio exceeds memory limit');
          this.buffers.set(url, buffer);
        }
      }));
      if (this.disposed) throw new Error('Song load cancelled');
      this.origin = this.context.currentTime + 0.08;
      this.timer = setInterval(() => this.pump(), 25);
      this.pump();
    } catch (error) { this.dispose(); throw error; }
  }

  /** Exposed for deterministic clock tests; normally driven by the interval. */
  pump(): void {
    if (!this.started || this.context.state !== 'running' || this.origin === undefined) return;
    if (this.finished) { if (this.timer !== undefined) clearInterval(this.timer); this.timer = undefined; return; }
    const now = this.context.currentTime, horizon = now + 0.2;
    while (this.next < this.song.events.length) {
      const event = this.song.events[this.next]!;
      const when = this.origin + event.start;
      if (when >= horizon) break;
      this.next += 1;
      // Never burst missed notes after a suspended timer / main-thread stall.
      if (when < now) {
        if (!this.diagnostics.includes('Scheduler stall: missed notes skipped.')) this.diagnostics.push('Scheduler stall: missed notes skipped.');
        continue;
      }
      const source = this.context.createBufferSource(), gain = this.context.createGain();
      source.buffer = this.buffers.get(event.url)!;
      source.connect(gain); gain.connect(this.master);
      gain.gain.setValueAtTime(event.gain, when);
      const end = this.origin + event.end;
      gain.gain.setValueAtTime(event.gain, end);
      gain.gain.linearRampToValueAtTime(0, end + 0.02);
      source.onended = () => { this.voices.delete(source); source.disconnect(); gain.disconnect(); };
      this.voices.add(source);
      source.start(when); source.stop(end + 0.02);
      this.scheduledCount += 1;
    }
  }

  suspend(): void { if (!this.disposed) void this.context.suspend().catch(() => {}); }
  resume(): void { if (!this.disposed) void this.context.resume().catch(() => {}); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.abort.abort();
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const source of this.voices) { try { source.stop(); } catch {} }
    this.voices.clear(); this.buffers.clear(); this.master.disconnect();
    void this.context.close().catch(() => {});
  }
}

export function createSongPreview(song: IslandSong): SongPreview {
  const context = new AudioContext();
  try { return new SongPreview(song, context); }
  catch (error) { void context.close().catch(() => {}); throw error; }
}
