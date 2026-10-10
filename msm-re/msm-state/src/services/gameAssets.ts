/**
 * Builds the island viewer's draw list from the game's own files.
 *
 * Placement: cell (c, r) centres at ((c+r)*48, (r-c)*24) so the back
 * of the island (high col, low row) is at the top of the screen, matching
 * the in-game camera. Structures are AEAnim rest poses scaled to the
 * plot about the stage centre. Monsters are portrait icons.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import {
  layerWorldMatrices,
  multiplyMatrix,
  parseAeAnim,
  pickAnimation,
  scaleAboutMatrix,
  translateMatrix,
  type AeAnim,
  type Animation,
  type Matrix2d,
} from '../lib/aeAnim.js';
import type { Catalogs } from './catalogs.js';
import { buildIslandSong } from './gameSongs.js';
import type { IslandView } from './viewModel.js';
import type { IslandRuntime, RuntimeIslandScene, RuntimeRig, RuntimeSpriteBank } from '../lib/islandRuntime.js';

export type SpriteAsset = {
  /** URL the dashboard loads the texture from (/api/assets/...). */
  url: string;
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  ow: number;
  oh: number;
  texW: number;
  texH: number;
};

export type AssetManifest = {
  monsters: Record<string, SpriteAsset>;
  structures: Record<string, SpriteAsset>;
  /** Catalog name for every monster id, so UI labels can resolve eggs the player has never owned. */
  names: Record<string, string>;
};

/** One sprite the island canvas draws, already in island pixel space. */
export type IslandDraw = {
  /** Experimental runtime replaces these rest-pose draws by instance ID. */
  instanceId?: string;
  opacity?: number;
  /** Physical atlas pixels to logical rig pixels (hires sheets use 0.5). */
  pixelScale?: number;
  /** Native GfxDiamondSprite clips grass to edge midpoints of its quad. */
  shape?: 'diamond';
  z: number;
  /** Maps local image pixels (0..lw, 0..lh) into island space. */
  m: [number, number, number, number, number, number];
  url: string;
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  ox: number;
  oy: number;
  lw: number;
  lh: number;
  texW: number;
  texH: number;
  /**
   * TexturePacker packed this frame rotated 90° clockwise (`r="y"`).
   * The canvas undoes that before placing the sprite on the layer.
   */
  rotated: boolean;
  title?: string;
};

export type IslandScene = {
  tileW: number;
  tileH: number;
  viewBox: { x: number; y: number; w: number; h: number };
  sky?: string | undefined;
  draws: IslandDraw[];
};

export function gameDataDir(): string {
  return join(
    homedir(),
    'Library', 'Application Support', 'CrossOver', 'Bottles', 'Steam',
    'drive_c', 'Program Files (x86)', 'Steam', 'steamapps', 'common',
    'My Singing Monsters', 'data',
  );
}

type AtlasFrame = {
  x: number; y: number; w: number; h: number;
  ox: number; oy: number; ow: number; oh: number;
  rotated: boolean;
};
type Atlas = { url: string; width: number; height: number; pixelScale: number; frames: Map<string, AtlasFrame> };

type TileDef = { x: number; y: number; w: number; h: number; url: string; texW: number; texH: number };
type IslandGrid = {
  width: number;
  height: number;
  tileW: number;
  tileH: number;
  cells: Array<{ name: string; x: number; y: number }>;
};

const wholeFileAsset = (url: string): SpriteAsset =>
  ({ url, fx: 0, fy: 0, fw: 0, fh: 0, ow: 0, oh: 0, texW: 0, texH: 0 });

const gfxUrl = (rel: string): string => `/api/assets/${rel.replace(/^gfx\//, '').replace(/\.png$/i, '')}.avif`;

function gfxExists(rel: string): boolean {
  const clean = rel.replace(/^gfx\//, '').replace(/\.png$/i, '') + '.avif';
  return existsSync(join(gameDataDir(), 'gfx', clean));
}

/** Parse a TexturePacker XML atlas: texture path plus every frame rect. */
function parseAtlas(xmlPath: string): Atlas | undefined {
  if (!existsSync(xmlPath)) return undefined;
  const xml = readFileSync(xmlPath, 'utf8');
  const head = /<TextureAtlas\s+imagePath="([^"]+)"[^>]*width="(\d+)"[^>]*height="(\d+)"/.exec(xml);
  if (head === null || head[1] === undefined) return undefined;
  const texture = head[1].replace(/^gfx\//, '').replace(/\.png$/, '') + '.avif';
  const frames = new Map<string, AtlasFrame>();
  // Most TexturePacker sheets use self-closing <sprite .../>, but ones with
  // per-sprite vertex data (nucleus_sheet, castle_paironormal_sheet) wrap a
  // <vertices> child, so match the opening tag either way.
  for (const match of xml.matchAll(/<sprite\s+([^>]*?)\s*\/?>/g)) {
    const attrs = new Map<string, string>();
    for (const attr of (match[1] ?? '').matchAll(/([a-zA-Z]+)="([^"]*)"/g)) {
      attrs.set(attr[1] ?? '', attr[2] ?? '');
    }
    const name = attrs.get('n');
    if (name === undefined) continue;
    const num = (key: string): number => Number(attrs.get(key) ?? 0);
    const rotated = attrs.get('r') === 'y';
    frames.set(name, {
      x: num('x'), y: num('y'), w: num('w'), h: num('h'),
      ox: num('oX'), oy: num('oY'), ow: num('oW'), oh: num('oH'),
      rotated,
    });
  }
  const pixelScale = /<TextureAtlas\b[^>]*\bhires="true"/.test(xml) ? 0.5 : 1;
  return { url: `/api/assets/${texture}`, width: Number(head[2] ?? 0), height: Number(head[3] ?? 0), pixelScale, frames };
}

class BinReader {
  constructor(private readonly buf: Buffer, private offset = 0) {}

  u32(): number {
    const value = this.buf.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u16(): number {
    const value = this.buf.readUInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  i16(): number {
    const value = this.buf.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  str(): string {
    const len = this.u32();
    const raw = this.buf.toString('latin1', this.offset, this.offset + len).replace(/\0.*$/s, '');
    this.offset += (len + 3) & ~3;
    return raw;
  }

  skip(n: number): void {
    this.offset += n;
  }

  get pos(): number {
    return this.offset;
  }
}

/**
 * tileset_*.bin is a pointer at a packed-tile .bin (islandNN_grass.bin).
 * That file starts with a gfx/ path and then name + x/y/w/h per tile.
 */
function parseTileset(tilesetFile: string): Map<string, TileDef> {
  const tiles = new Map<string, TileDef>();
  const tilesetPath = join(gameDataDir(), 'xml_bin', tilesetFile);
  if (!existsSync(tilesetPath)) return tiles;
  const pointer = new BinReader(readFileSync(tilesetPath));
  const grassRel = pointer.str().replace(/^xml_bin\//, '');
  const grassPath = join(gameDataDir(), 'xml_bin', grassRel);
  if (!existsSync(grassPath)) return tiles;
  const grass = new BinReader(readFileSync(grassPath));
  const texture = grass.str();
  if (!gfxExists(texture)) return tiles;
  const url = gfxUrl(texture);
  const count = grass.u32();
  for (let i = 0; i < count; i += 1) {
    const name = grass.str();
    const x = grass.u16();
    const y = grass.u16();
    const w = grass.u16();
    const h = grass.u16();
    tiles.set(name, { x, y, w, h, url, texW: 0, texH: 0 });
  }
  return tiles;
}

/**
 * islandNN_grid.bin header is eight i16s (grid/tile/view) then two
 * unused u32s and a tile list: name + cell x/y + 20 bytes of flags.
 */
function parseGrid(gridFile: string): IslandGrid | undefined {
  const path = join(gameDataDir(), 'xml_bin', gridFile);
  if (!existsSync(path)) return undefined;
  const buf = readFileSync(path);
  const reader = new BinReader(buf);
  const width = reader.i16();
  const height = reader.i16();
  const tileW = reader.i16();
  const tileH = reader.i16();
  reader.skip(8);
  reader.u32();
  reader.u32();
  reader.u32();
  const count = reader.u32();
  const cells: IslandGrid['cells'] = [];
  for (let i = 0; i < count && reader.pos + 8 < buf.length; i += 1) {
    const name = reader.str();
    const x = reader.u16();
    const y = reader.u16();
    reader.skip(20);
    cells.push({ name, x, y });
  }
  return { width, height, tileW, tileH, cells };
}

const animMemo = new Map<string, AeAnim | undefined>();
const atlasMemo = new Map<string, Atlas | undefined>();

function loadAnim(file: string): AeAnim | undefined {
  if (animMemo.has(file)) return animMemo.get(file);
  const path = join(gameDataDir(), 'xml_bin', file);
  let parsed: AeAnim | undefined;
  if (existsSync(path)) {
    try {
      parsed = parseAeAnim(readFileSync(path));
    } catch {
      parsed = undefined;
    }
  }
  animMemo.set(file, parsed);
  return parsed;
}

function loadAtlas(sheetName: string): Atlas | undefined {
  if (atlasMemo.has(sheetName)) return atlasMemo.get(sheetName);
  const atlas = parseAtlas(join(gameDataDir(), 'xml_resources', basename(sheetName)));
  atlasMemo.set(sheetName, atlas);
  return atlas;
}

/**
 * In-game camera: +col and +row run along the screen diagonal so a
 * high-col, low-row cell (the back of the island) sits at the top.
 * (col-row, col+row) put that same cell on the right.
 */
function isoX(col: number, row: number, tileW: number): number {
  return (col + row) * (tileW / 2);
}

function isoY(col: number, row: number, tileH: number): number {
  return (row - col) * (tileH / 2);
}

/**
 * The client's GameEntity::setPosition (sub_C559F0 @ 0xC559F0) places an
 * entity's animation so its stage centre sits on the entity's own grid
 * cell: `pos_x`/`pos_y` is the anchor, the footprint size never enters
 * the transform. (The +1 and grid-height terms the client adds are a
 * constant screen-space translation, so they cancel here.)
 */
function entityAnchor(posX: number, posY: number, tileW: number, tileH: number): { x: number; y: number } {
  return { x: isoX(posX, posY, tileW), y: isoY(posX, posY, tileH) };
}

type ResolvedSprite = {
  pixelScale?: number;
  url: string;
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  ox: number;
  oy: number;
  lw: number;
  lh: number;
  texW: number;
  texH: number;
  rotated: boolean;
};

function resolveLayerSprite(anim: AeAnim, layer: Animation['layers'][number], frameSprite: string): ResolvedSprite | undefined {
  // Layers normally name a source by id, but a few packs (structure_castle_05,
  // button_video) ship ids that do not match their own layer references, so
  // fall back to the source-table index (65535 marks a sourceless layer).
  const source = anim.sources.find((src) => src.id === layer.sourceId) ?? anim.sources[layer.sourceId];
  // Atlas keys sometimes keep the .png suffix (stair_shaper_sheet has
  // island24_lantern.png) and sometimes drop it (breeding_sheet has
  // structure_body), so try both spellings of both the frame and layer name.
  const rawSprite = frameSprite || layer.name;
  const spriteName = rawSprite.replace(/\.png$/i, '');
  const layerName = layer.name.replace(/\.png$/i, '');
  if (source !== undefined && source.name.endsWith('.xml')) {
    const atlas = loadAtlas(source.name);
    let frame =
      atlas?.frames.get(rawSprite) ??
      atlas?.frames.get(spriteName) ??
      atlas?.frames.get(layer.name) ??
      atlas?.frames.get(layerName);
    // A few anims misspell an atlas key (obstacle_rock01_island_15 vs
    // obstacle_rock01_island15); fall back to a punctuation-insensitive match.
    if (frame === undefined && atlas !== undefined) {
      const want = spriteName.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [key, value] of atlas.frames) {
        if (key.toLowerCase().replace(/[^a-z0-9]/g, '') === want) {
          frame = value;
          break;
        }
      }
    }
    if (atlas === undefined || frame === undefined) return undefined;
    const origW = frame.ow || (frame.rotated ? frame.h : frame.w);
    const origH = frame.oh || (frame.rotated ? frame.w : frame.h);
    const lw = origW * atlas.pixelScale;
    const lh = origH * atlas.pixelScale;
    if (lw <= 0 || lh <= 0) return undefined;
    return {
      url: atlas.url,
      fx: frame.x, fy: frame.y, fw: frame.w, fh: frame.h,
      ox: frame.ox * atlas.pixelScale, oy: frame.oy * atlas.pixelScale, lw, lh,
      pixelScale: atlas.pixelScale,
      texW: atlas.width, texH: atlas.height,
      rotated: frame.rotated,
    };
  }
  if (source !== undefined && (source.name.startsWith('gfx/') || source.name.endsWith('.png'))) {
    if (!gfxExists(source.name)) return undefined;
    const lw = layer.width || source.width;
    const lh = layer.height || source.height;
    if (lw <= 0 || lh <= 0) return undefined;
    return {
      url: gfxUrl(source.name),
      fx: 0, fy: 0, fw: 0, fh: 0,
      ox: 0, oy: 0, lw, lh,
      texW: 0, texH: 0,
      rotated: false,
    };
  }
  return undefined;
}

function compileRuntimeRig(file: AeAnim, clip: Animation): RuntimeRig {
  if (clip.native === undefined) throw new Error('missing native clip metadata');
  const decode = (word: number): number => {
    const b = Buffer.alloc(4); b.writeUInt32LE(word); return b.readFloatLE();
  };
  let duration = 0;
  const sources: Record<string, RuntimeSpriteBank> = {};
  for (const layer of clip.layers) {
    if (layer.native?.type !== 1) throw new Error('nested/sound/particle layers are not ported');
    if (layer.native.blend !== 0) throw new Error('non-normal blend mode is not ported');
    if (layer.frames.length > 4096) throw new Error('layer exceeds WASM sampler capacity');
    for (const frame of layer.frames) {
      if (frame.native === undefined) throw new Error('missing native keyframe metadata');
      const time = decode(frame.native.words[0]!);
      if (!Number.isFinite(time)) throw new Error('invalid keyframe time');
      duration = Math.max(duration, time);
      const color = frame.native.afterSprite >>> 0;
      if ((color & 255) !== 255 && (color >>> 8) !== 0xffffff) throw new Error('color tint is not ported');
    }
    const key = String(layer.sourceId);
    if (sources[key] !== undefined || layer.sourceId === 65535) continue;
    const source = file.sources.find((s) => s.id === layer.sourceId) ?? file.sources[layer.sourceId];
    if (source === undefined) throw new Error('unresolved texture source');
    // Bank dimensions come from the original sprite, not one particular layer.
    const bankLayer = { ...layer, width: 0, height: 0 };
    const names = source.name.endsWith('.xml')
      ? [...(loadAtlas(source.name)?.frames.keys() ?? [])] : [source.name];
    const sprites = names.map((name) => resolveLayerSprite(file, bankLayer, name));
    if (names.length === 0 || sprites.some((s) => s === undefined)) throw new Error('unresolved atlas/texture');
    sources[key] = { names, sprites: sprites as NonNullable<typeof sprites[number]>[], wholeTexture: !source.name.endsWith('.xml') };
  }
  const loopStart = decode(clip.native.words[0]);
  if (!Number.isFinite(loopStart)) throw new Error('invalid loop-start metadata');
  if (loopStart >= 0 && duration > 0 && loopStart >= duration) throw new Error('unsupported loop range');
  return { clip, duration, loopStart, sources };
}

/** Opt-in payload: deduplicated selected clips plus static fallback draws. */
export function buildRuntimeIslandScene(island: IslandView, catalogs: Catalogs): RuntimeIslandScene {
  const runtime: IslandRuntime = {
    version: 1, rigs: {}, instances: [],
    diagnostics: [
      'Experimental: Canvas2D adapter; parent anchors and hires density corrected from native evidence; placement and atlas index order await native frame comparison.',
      'No costumes/remaps or gameplay-driven clip queues. Selected catalog clips only; singing animation synchronization is not ported.',
    ],
  };
  try { runtime.song = buildIslandSong(island, catalogs, gameDataDir()); }
  catch (error) { runtime.diagnostics.push(`Audio unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  return { ...buildIslandScene(island, catalogs, runtime), runtime };
}

function drawFromAnim(
  file: AeAnim,
  clip: Animation,
  origin: Matrix2d,
  zBase: number,
  title: string,
  instanceId?: string,
): IslandDraw[] {
  const worlds = layerWorldMatrices(clip);
  const draws: IslandDraw[] = [];
  // AE stores layers front-to-back; paint the last (shadow, island
  // body) first so mouths and props sit on top.
  for (const [index, layer] of [...clip.layers].reverse().entries()) {
    const frame = layer.frames[0];
    if (frame === undefined || frame.opacity <= 0) continue;
    const local = worlds.get(layer.id);
    if (local === undefined) continue;
    const sprite = resolveLayerSprite(file, layer, frame.sprite);
    if (sprite === undefined) continue;
    const m = multiplyMatrix(origin, local);
    draws.push({
      z: zBase + index * 0.001,
      m: [m[0], m[1], m[2], m[3], m[4], m[5]],
      ...sprite,
      title,
      ...(instanceId === undefined ? {} : { instanceId }),
    });
  }
  return draws;
}

/** Stage centre on the entity's cell, then scaled about that point. */
function entityOrigin(
  centre: { x: number; y: number },
  clip: Animation,
  flip: boolean,
  scale: number,
): Matrix2d {
  const toOrigin = translateMatrix(-clip.stageW / 2, -clip.stageH / 2);
  const flipped = flip ? multiplyMatrix(scaleAboutMatrix(-1, 1, 0, 0), toOrigin) : toOrigin;
  return multiplyMatrix(
    translateMatrix(centre.x, centre.y),
    multiplyMatrix([scale, 0, 0, scale, 0, 0], flipped),
  );
}

const rowsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    : [];

/** Portrait sprite for a monster: a standalone AVIF under gfx/breeding. */
export function monsterPortrait(monsterId: number, catalogs: Catalogs): SpriteAsset | undefined {
  const name = catalogs.monsterPortraits.get(monsterId);
  if (name === undefined) return undefined;
  const rel = `breeding/${name}.avif`;
  return existsSync(join(gameDataDir(), 'gfx', rel)) ? wholeFileAsset(`/api/assets/${rel}`) : undefined;
}

/**
 * Manifest limited to portraits the monster table shows. Structure
 * sprites now come from the per-island scene, not a single body guess.
 */
export function assetManifestFor(catalogs: Catalogs, playerObject: Record<string, unknown> | undefined): AssetManifest {
  const manifest: AssetManifest = {
    monsters: {},
    structures: {},
    names: Object.fromEntries(catalogs.monsters),
  };
  if (playerObject === undefined) return manifest;
  const seen = new Set<number>();
  for (const island of rowsOf(playerObject.islands)) {
    for (const monster of rowsOf(island.monsters)) {
      const id = typeof monster.monster === 'number' ? monster.monster : -1;
      if (id < 0 || seen.has(id)) continue;
      seen.add(id);
      const asset = monsterPortrait(id, catalogs);
      if (asset !== undefined) manifest.monsters[String(id)] = asset;
    }
  }
  return manifest;
}

/**
 * Full draw list for one island: sky, scene overlay, grass tiles, then
 * every structure and roaming monster composed from its AEAnim rest pose.
 */
export function buildIslandScene(island: IslandView, catalogs: Catalogs, runtime?: IslandRuntime): IslandScene {
  const graphic = catalogs.islandGraphics.get(island.islandVariantId);
  const grid = graphic === undefined ? undefined : parseGrid(graphic.gridFile);
  const tileW = grid?.tileW || 96;
  const tileH = grid?.tileH || 48;
  const draws: IslandDraw[] = [];
  const rigIds = new Map<Animation, string>();
  const addRig = (file: AeAnim, clip: Animation, origin: Matrix2d, z: number, title: string, id: string): void => {
    draws.push(...drawFromAnim(file, clip, origin, z, title, runtime === undefined ? undefined : id));
    if (runtime === undefined) return;
    let rig = rigIds.get(clip);
    if (rig === undefined) {
      try {
        const resource = compileRuntimeRig(file, clip);
        rig = `rig${rigIds.size}`;
        rigIds.set(clip, rig);
        runtime.rigs[rig] = resource;
      } catch (error) {
        runtime.diagnostics.push(`${title}: static fallback — ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }
    runtime.instances.push({ id, rig, origin, z, title });
  };

  if (graphic !== undefined && gfxExists(graphic.sky)) {
    // Sky is a backdrop; the canvas letterboxes it behind the island.
  }

  if (graphic !== undefined) {
    const scene = loadAnim(graphic.sceneFile);
    const clip = scene === undefined ? undefined : pickAnimation(scene, graphic.sceneFile.replace(/\.bin$/, ''));
    if (scene !== undefined && clip !== undefined && grid !== undefined) {
      const cx = isoX((grid.width - 1) / 2, (grid.height - 1) / 2, tileW);
      const cy = isoY((grid.width - 1) / 2, (grid.height - 1) / 2, tileH);
      // Scene comps are authored at half the grid's pixel size (Plant
      // Island 1872x1200 vs a 3744-wide view), so scale 2 about the
      // island centre.
      const scale = tileW === 96 ? 2 : 1;
      const origin = multiplyMatrix(
        translateMatrix(cx, cy),
        multiplyMatrix([scale, 0, 0, scale, 0, 0], translateMatrix(-clip.stageW / 2, -clip.stageH / 2)),
      );
      addRig(scene, clip, origin, -2000, island.name, 'scene');
    }

    const tiles = parseTileset(graphic.tilesetFile);
    if (grid !== undefined) {
      for (const cell of grid.cells) {
        const tile = tiles.get(cell.name);
        if (tile === undefined) continue;
        const x = isoX(cell.x, cell.y, tileW) - tileW / 2;
        const y = isoY(cell.x, cell.y, tileH) - tileH / 2;
        draws.push({
          z: cell.y - cell.x - 1000,
          m: [1, 0, 0, 1, x, y],
          url: tile.url,
          fx: tile.x, fy: tile.y, fw: tile.w, fh: tile.h,
          ox: 0, oy: 0, lw: tileW, lh: tileH, shape: 'diamond',
          texW: 0, texH: 0, rotated: false,
        });
      }
    }
  }

  for (const structure of island.structures) {
    if (structure.inWarehouse) continue;
    const row = catalogs.structures.get(structure.structureId);
    const file = row === undefined ? undefined : loadAnim(row.graphicFile);
    const clip = file === undefined ? undefined : pickAnimation(file, row?.anim ?? '');
    if (file === undefined || clip === undefined) continue;
    const anchor = entityAnchor(structure.posX, structure.posY, tileW, tileH);
    const origin = entityOrigin(anchor, clip, structure.flip, structure.scale);
    // Depth is the anchor cell's screen row; the game draws back-to-front.
    addRig(file, clip, origin, structure.posY - structure.posX, structure.name, `structure:${structure.userStructureId}`);
  }

  for (const monster of island.monsters) {
    if (monster.inHotel) continue;
    const anchor = entityAnchor(monster.posX, monster.posY, tileW, tileH);
    // Monsters are drawn from their real AEAnim rig (body/head/limbs),
    // exactly like the game — not as a flat portrait.
    const graphic = catalogs.monsterGraphics.get(monster.monsterId);
    const file = graphic === undefined || graphic.file === '' ? undefined : loadAnim(graphic.file);
    const clip = file === undefined ? undefined : pickAnimation(file, graphic?.anim ?? 'Idle');
    if (file !== undefined && clip !== undefined) {
      const origin = entityOrigin(anchor, clip, monster.flip, monster.scale);
      addRig(file, clip, origin, monster.posY - monster.posX + 0.5, monster.monsterName, `monster:${monster.userMonsterId}`);
      continue;
    }
    // Fallback when the rig cannot be resolved: the square portrait.
    const portrait = monsterPortrait(monster.monsterId, catalogs);
    if (portrait === undefined) continue;
    const size = tileW * 0.75;
    draws.push({
      z: monster.posY - monster.posX + 0.5,
      m: [1, 0, 0, 1, anchor.x - size / 2, anchor.y - size],
      url: portrait.url,
      fx: 0, fy: 0, fw: 0, fh: 0,
      ox: 0, oy: 0, lw: size, lh: size,
      texW: 0, texH: 0, rotated: false,
      title: monster.monsterName,
    });
  }

  draws.sort((a, b) => a.z - b.z);

  const boundsOf = (list: IslandDraw[]): { minX: number; minY: number; maxX: number; maxY: number } => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const draw of list) {
      const [a, b, c, d, e, f] = draw.m;
      const corners: Array<[number, number]> = [[0, 0], [draw.lw, 0], [0, draw.lh], [draw.lw, draw.lh]];
      for (const [lx, ly] of corners) {
        const x = a * lx + c * ly + e;
        const y = b * lx + d * ly + f;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return { minX, minY, maxX, maxY };
  };

  // Tiles and entities define the playable island. The scene overlay's
  // island-body layers sit over that area and carry the rocky edges, while
  // the cloud banks are centred far outside it — so include a scene layer
  // only when its centre falls inside the playable area.
  const core = boundsOf(draws.filter((draw) => draw.z > -1500));
  const islandBounds = Number.isFinite(core.minX) ? core : { minX: -200, minY: -200, maxX: 200, maxY: 200 };
  const framed = draws.filter((draw) => {
    if (draw.z > -1500) return true;
    const b = boundsOf([draw]);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return cx >= islandBounds.minX && cx <= islandBounds.maxX && cy >= islandBounds.minY && cy <= islandBounds.maxY;
  });
  const bounds = boundsOf(framed.length > 0 ? framed : draws);
  const minX = Number.isFinite(bounds.minX) ? bounds.minX : -200;
  const minY = Number.isFinite(bounds.minY) ? bounds.minY : -200;
  const maxX = Number.isFinite(bounds.maxX) ? bounds.maxX : 200;
  const maxY = Number.isFinite(bounds.maxY) ? bounds.maxY : 200;
  const pad = 40;
  return {
    tileW,
    tileH,
    viewBox: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 },
    sky: graphic !== undefined && gfxExists(graphic.sky) ? gfxUrl(graphic.sky) : undefined,
    draws,
  };
}
