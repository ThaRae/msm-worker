import type { IslandSong } from './islandSong.js';
import type { Animation, Matrix2d } from './aeAnim.js';
import type { IslandDraw, IslandScene } from '../services/gameAssets.js';

export type RuntimeSprite = Omit<IslandDraw, 'z' | 'm' | 'title' | 'instanceId' | 'opacity'>;
export type RuntimeSpriteBank = {
  /** Asset XML order, not alphabetically sorted. Native index parity pending. */
  names: string[];
  sprites: RuntimeSprite[];
  wholeTexture: boolean;
};
export type RuntimeRig = {
  clip: Animation;
  duration: number;
  loopStart: number;
  sources: Record<string, RuntimeSpriteBank>;
};
export type RuntimeInstance = {
  id: string;
  rig: string;
  origin: Matrix2d;
  z: number;
  title: string;
};
export type IslandRuntime = {
  version: 1;
  song?: IslandSong;
  rigs: Record<string, RuntimeRig>;
  instances: RuntimeInstance[];
  diagnostics: string[];
};
export type RuntimeIslandScene = IslandScene & { runtime: IslandRuntime };
