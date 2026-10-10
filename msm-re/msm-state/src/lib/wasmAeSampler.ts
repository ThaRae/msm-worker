import type { AnimLayer } from './aeAnim.js';

type SamplerExports = {
  memory: WebAssembly.Memory;
  ae_abi_version(): number;
  ae_capacity(): number;
  ae_input(): number;
  ae_output(): number;
  ae_sample(count: number, time: number): number;
};

export type SampledLayer = {
  x: number; y: number;
  scaleX: number; scaleY: number;
  rotation: number; opacity: number;
  color: readonly [number, number, number];
  /** null = no sprite key has become active; keep the host's initial sprite. */
  sprite: { from: string; to: string; fraction: number } | null;
};

/** Browser/Node wrapper around the freestanding native-rule WASM sampler.
 * Time is in the asset's native time units. No looping or controller updates
 * are implied. Each sampler owns its scratch memory; calls are synchronous.
 */
export class WasmAeSampler {
  private constructor(private readonly core: SamplerExports) {}

  static async create(bytes: Uint8Array<ArrayBuffer>): Promise<WasmAeSampler> {
    // Compile explicitly first: the bytes-first instantiate overload is
    // ambiguous in TS 5.9 (it can resolve to the Module overload whose
    // result has no .instance), so split compile and instantiate.
    const module = new WebAssembly.Module(bytes);
    const instance = await WebAssembly.instantiate(module, {});
    const e = instance.exports as unknown as SamplerExports;
    for (const name of ['ae_abi_version', 'ae_capacity', 'ae_input', 'ae_output', 'ae_sample'] as const) {
      if (typeof e[name] !== 'function') throw new Error(`Missing WASM export ${name}`);
    }
    if (!(e.memory instanceof WebAssembly.Memory) || e.ae_abi_version() !== 1) {
      throw new Error('Unsupported AE sampler ABI');
    }
    const size = e.memory.buffer.byteLength;
    if (e.ae_capacity() !== 4096 || e.ae_input() % 4 !== 0 || e.ae_output() % 4 !== 0 ||
        e.ae_input() < 0 || e.ae_output() < 0 ||
        e.ae_input() + e.ae_capacity() * 52 > size || e.ae_output() + 72 > size) {
      throw new Error('Invalid AE sampler memory layout');
    }
    return new WasmAeSampler(e);
  }

  /** Pack and validate immutable rig data once, not on every rendered frame. */
  prepare(layer: AnimLayer): (time: number) => SampledLayer {
    if (layer.frames.length > this.core.ae_capacity()) throw new Error('AE layer exceeds sampler capacity');
    const input = new Uint32Array(layer.frames.length * 13);
    for (let i = 0; i < layer.frames.length; i += 1) {
      const raw = layer.frames[i]!.native;
      if (raw === undefined || raw.words.length !== 11) throw new Error('AE sampling requires native keyframe records');
      if (raw.words.some((w) => !Number.isInteger(w) || w < 0 || w > 0xffffffff) ||
          !Number.isInteger(raw.beforeSprite) || raw.beforeSprite < -0x80000000 || raw.beforeSprite > 0x7fffffff ||
          !Number.isInteger(raw.afterSprite) || raw.afterSprite < -0x80000000 || raw.afterSprite > 0x7fffffff) {
        throw new Error('Invalid native AE keyframe words');
      }
      input.set(raw.words, i * 13);
      input[i * 13 + 11] = raw.beforeSprite >>> 0;
      input[i * 13 + 12] = raw.afterSprite >>> 0;
    }
    const sprites = layer.frames.map((f) => f.sprite);
    // Exercise the C-side validation before accepting the prepared resource.
    this.samplePacked(input, sprites, 0);
    return (time) => this.samplePacked(input, sprites, time);
  }

  sample(layer: AnimLayer, time: number): SampledLayer {
    return this.prepare(layer)(time);
  }

  private samplePacked(input: Uint32Array, sprites: string[], time: number): SampledLayer {
    if (!Number.isFinite(time) || !Number.isFinite(Math.fround(time))) throw new Error('Invalid animation time');
    new Uint32Array(this.core.memory.buffer, this.core.ae_input(), input.length).set(input);
    const status = this.core.ae_sample(sprites.length, time);
    if (status !== 0) throw new Error(`AE sampler rejected layer (${status})`);
    const v = new Float32Array(this.core.memory.buffer, this.core.ae_output(), 18);
    const from = v[15]!;
    const to = v[16]!;
    return {
      x: v[0]!, y: v[1]!, scaleX: v[3]! / 100, scaleY: v[4]! / 100,
      rotation: v[6]!, opacity: v[9]!, color: [v[12]!, v[13]!, v[14]!],
      sprite: from < 0 ? null : {
        from: sprites[from]!, to: sprites[to]!, fraction: v[17]!,
      },
    };
  }
}

/** Native 0x4CC960: interpolation between resolved atlas indices, truncating
 * the signed difference toward zero. Never interpolate sprite name strings.
 */
export function sampleAtlasIndex(from: number, to: number, fraction: number): number {
  if (![from, to].every((n) => Number.isInteger(n) && n >= -32768 && n <= 32767) ||
      !Number.isFinite(fraction) || fraction < 0 || fraction > 1) throw new Error('Invalid atlas index interpolation');
  return from + Math.trunc(Math.fround(Math.fround(fraction) * Math.fround(to - from)));
}
