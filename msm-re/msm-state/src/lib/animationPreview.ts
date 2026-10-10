export { createSongPreview } from './songPreview.js';
import { WasmAeSampler, sampleAtlasIndex, type SampledLayer } from './wasmAeSampler.js';
import type { AnimLayer, Matrix2d } from './aeAnim.js';
import type { IslandDraw } from '../services/gameAssets.js';
import type { RuntimeIslandScene, RuntimeRig, RuntimeSpriteBank } from './islandRuntime.js';

/** Preview timeline only; not the native stateful clip/event controller. */
export function previewClipTime(elapsed: number, duration: number, loopStart: number): number {
  if (![elapsed, duration, loopStart].every(Number.isFinite) || elapsed < 0 || duration < 0) throw new Error('Invalid preview timeline');
  if (duration === 0) return 0;
  if (elapsed < duration) return elapsed;
  if (loopStart < 0) return duration;
  if (loopStart >= duration) throw new Error('Invalid preview loop');
  return loopStart + (elapsed - duration) % (duration - loopStart);
}

function multiply(p: Matrix2d, q: Matrix2d): Matrix2d {
  return [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
}

/** Native 0x4CED20 / 0x4CC960: children inherit the parent's anchor-adjusted
 * untrimmed space. Atlas trim offsets affect drawing, never joint positions. */
export function previewWorldMatrices(layers: AnimLayer[], poses: SampledLayer[]): Map<number, Matrix2d> {
  if (layers.length !== poses.length) throw new Error('Pose/layer count mismatch');
  const byId = new Map(layers.map((l, i) => [l.id, i]));
  if (byId.size !== layers.length) throw new Error('Duplicate layer ID');
  const parents = new Map<number, Matrix2d>();
  const visiting = new Set<number>();
  const local = (i: number): Matrix2d => {
    const p = poses[i]!;
    const rad = p.rotation * Math.PI / 180;
    const a = Math.cos(rad) * p.scaleX, b = Math.sin(rad) * p.scaleX;
    const c = -Math.sin(rad) * p.scaleY, d = Math.cos(rad) * p.scaleY;
    const l = layers[i]!;
    return [a, b, c, d, p.x - a * l.anchorX - c * l.anchorY, p.y - b * l.anchorX - d * l.anchorY];
  };
  const parentSpace = (i: number): Matrix2d => {
    if (parents.has(i)) return parents.get(i)!;
    if (visiting.has(i)) throw new Error('Cyclic layer hierarchy');
    visiting.add(i);
    const l = layers[i]!;
    const parent = l.parent < 0 ? undefined : byId.get(l.parent);
    if (l.parent >= 0 && parent === undefined) throw new Error('Missing parent layer');
    const m = parent === undefined ? local(i) : multiply(parentSpace(parent), local(i));
    visiting.delete(i); parents.set(i, m); return m;
  };
  const result = new Map<number, Matrix2d>();
  for (let i = 0; i < layers.length; i += 1) {
    const l = layers[i]!;
    result.set(l.id, parentSpace(i));
  }
  return result;
}

function spriteIndex(bank: RuntimeSpriteBank, name: string, fallback: string): number {
  if (bank.wholeTexture) return 0;
  for (const key of [name, name.replace(/\.png$/i, ''), fallback, fallback.replace(/\.png$/i, '')]) {
    const index = bank.names.indexOf(key);
    if (index >= 0) return index;
  }
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const index = bank.names.findIndex((n) => n.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized);
  if (index < 0) throw new Error(`Unresolved sprite ${name}`);
  return index;
}

type PreparedRig = { rig: RuntimeRig; sample: Array<(time: number) => SampledLayer> };

/** Evaluates a versioned island payload with actual WASM sampling. No DOM,
 * socket, timers or audio here: lifecycle/clock are owned by the dashboard. */
export class AnimationPreview {
  readonly diagnostics: string[];
  activeInstanceCount = 0;
  private readonly prepared = new Map<string, PreparedRig>();
  private readonly failed = new Set<string>();

  constructor(private readonly scene: RuntimeIslandScene, sampler: WasmAeSampler) {
    if (scene.runtime.version !== 1) throw new Error('Unsupported island runtime ABI');
    this.diagnostics = [...scene.runtime.diagnostics];
    for (const [id, rig] of Object.entries(scene.runtime.rigs)) {
      try { this.prepared.set(id, { rig, sample: rig.clip.layers.map((l) => sampler.prepare(l)) }); }
      catch (error) { this.fail(id, error); }
    }
  }

  private fail(id: string, error: unknown): void {
    if (!this.failed.has(id)) this.diagnostics.push(`${id}: static fallback — ${error instanceof Error ? error.message : String(error)}`);
    this.failed.add(id);
  }

  drawsAt(elapsed: number): IslandDraw[] {
    const animated: IslandDraw[] = [];
    const replaced = new Set<string>();
    // Shared rigs are sampled once per frame, then placed per instance.
    const evaluated = new Map<string, IslandDraw[]>();
    for (const instance of this.scene.runtime.instances) {
      const resource = this.prepared.get(instance.rig);
      if (resource === undefined || this.failed.has(instance.rig)) continue;
      try {
        let localDraws = evaluated.get(instance.rig);
        if (localDraws === undefined) {
          const { rig, sample } = resource;
          const time = previewClipTime(elapsed, rig.duration, rig.loopStart);
          const poses = sample.map((evaluate) => evaluate(time));
          const worlds = previewWorldMatrices(rig.clip.layers, poses);
          localDraws = [];
          for (let i = rig.clip.layers.length - 1; i >= 0; i -= 1) {
            const layer = rig.clip.layers[i]!;
            const pose = poses[i]!;
            const bank = rig.sources[String(layer.sourceId)];
            if (bank === undefined || !layer.frames.length || pose.opacity <= 0) continue;
            const selection = pose.sprite;
            // Native 0x4CC960 does not change the sheet sprite before its
            // first key or with no sprite keys. A fresh sheet starts at index 0
            // (not a guessed layer-name lookup); empty.xml is a real null sprite.
            const from = selection === null ? 0 : spriteIndex(bank, selection.from, layer.name);
            const to = selection === null ? 0 : spriteIndex(bank, selection.to, layer.name);
            const index = bank.wholeTexture ? 0 : sampleAtlasIndex(from, to, selection?.fraction ?? 0);
            const sprite = bank.sprites[index];
            if (sprite === undefined) throw new Error('Atlas index out of bounds');
            const m = worlds.get(layer.id)!;
            localDraws.push({ ...sprite, z: (rig.clip.layers.length - 1 - i) * 0.001,
              m: [...m],
              opacity: Math.max(0, Math.min(1, pose.opacity / 100)) });
          }
          evaluated.set(instance.rig, localDraws);
        }
        for (const draw of localDraws) {
          const m = multiply(instance.origin, draw.m);
          animated.push({ ...draw, m: [...m], z: instance.z + draw.z, instanceId: instance.id, title: instance.title });
        }
        replaced.add(instance.id);
      } catch (error) { this.fail(instance.rig, error); }
    }
    this.activeInstanceCount = replaced.size;
    return [...this.scene.draws.filter((d) => d.instanceId === undefined || !replaced.has(d.instanceId)), ...animated]
      .sort((a, b) => a.z - b.z);
  }
}

let samplerPromise: Promise<WasmAeSampler> | undefined;
export async function createAnimationPreview(scene: RuntimeIslandScene): Promise<AnimationPreview> {
  samplerPromise ??= fetch('/api/runtime/ae-sampler.wasm')
    .then(async (response) => {
      if (!response.ok) throw new Error(`WASM load failed (${response.status})`);
      return WasmAeSampler.create(new Uint8Array(await response.arrayBuffer()));
    }).catch((error: unknown) => { samplerPromise = undefined; throw error; });
  return new AnimationPreview(scene, await samplerPromise);
}
