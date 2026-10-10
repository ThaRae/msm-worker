// Offline browser smoke test: synthetic player + local game art/audio only.
// Requires a separately installed Playwright (PLAYWRIGHT_MODULE may name its
// absolute ESM entry point). Never creates a LiveSession or authenticates.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStateServer } from '../dist/services/server.js';
import { loadCatalogs } from '../dist/services/catalogs.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const catalogs = loadCatalogs(join(root, '../catalogs'));
const player = { display_name: 'Offline renderer fixture', level: 20, coins_actual: 100,
  islands: [{ user_island_id: '1', island: 1, type: 1,
    monsters: [{ user_monster_id: '1', monster: 2, name: 'Fixture Potbelly', level: 1,
      pos_x: 18, pos_y: 18, scale: 1, flip: false, in_hotel: false }],
    structures: [], breeding: [], baking: [], eggs: [] }] };
const session = {
  getStatus: () => ({ status: 'ready', lastSyncAtMs: 0 }),
  serverNow: () => Date.now(), getEvents: () => [], getTimedEvents: () => [],
  getCatalogs: () => catalogs, getPlayerObject: () => player,
};
const server = createStateServer(session);
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${origin}/?renderer=wasm#/island/1`);
  await page.waitForFunction(() => mapPreviews['1'] && mapPreviews['1'].activeInstanceCount > 0);
  await page.waitForFunction(() => Object.values(mapImages).every((i) => i.complete));
  const tilePixels = await page.evaluate(() => {
    var tile = islandScenes['1'].draws.find((d) => d.shape === 'diamond');
    var canvas = document.createElement('canvas'); canvas.style.width = '192px';
    document.body.appendChild(canvas);
    paintMap(canvas, { draws: [Object.assign({}, tile, { m: [1, 0, 0, 1, 0, 0] })],
      viewBox: { x: 0, y: 0, w: tile.lw, h: tile.lh } });
    var ctx = canvas.getContext('2d');
    var alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
    var result = { corners: [alpha(2, 2), alpha(189, 2), alpha(2, 93), alpha(189, 93)], centre: alpha(96, 48) };
    canvas.style.width = '288px';
    paintMap(canvas, { draws: [Object.assign({}, tile, { m: [1, 0, 0, 1, 0, 0] }),
      Object.assign({}, tile, { m: [1, 0, 0, 1, 48, 24] })],
      viewBox: { x: 0, y: 0, w: 144, h: 72 } });
    result.sharedEdge = [56, 64, 72, 80, 88].map((x) => alpha(x * 2, (72 - x / 2) * 2));
    canvas.remove(); return result;
  });
  assert.deepEqual(tilePixels.corners, [0, 0, 0, 0], 'native diamond tiles must leave quad corners transparent');
  assert.ok(tilePixels.centre > 0, 'grass is drawn inside the diamond');
  assert.deepEqual(tilePixels.sharedEdge, [255, 255, 255, 255, 255], 'adjacent diamonds have no transparent antialias seams');
  assert.ok(await page.evaluate(() => !mapPreviews['1'].diagnostics.some((d) => /Unresolved sprite/.test(d))), 'empty scene nodes no longer disable scenery');
  const initial = await page.evaluate(() => ({ start: mapStartedAt['1'], status: document.getElementById('mapruntime-1').textContent }));
  assert.match(initial.status, /WASM preview/);
  await page.locator('canvas.map').click({ position: { x: 300, y: 300 } });
  assert.equal(await page.evaluate(() => mapPicked.island), '1', 'cell picking survives runtime rendering');
  assert.match(await page.locator('#mappick-1').textContent(), /Picked/);
  const first = await page.locator('canvas.map').screenshot();
  await page.waitForTimeout(600);
  const second = await page.locator('canvas.map').screenshot();
  assert.ok(!first.equals(second), 'actual rendered pixels must change');
  const artifactDir = process.env.PREVIEW_ARTIFACT_DIR || join(root, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  await page.locator('canvas.map').screenshot({ path: join(artifactDir, 'wasm-preview.png') });
  // Inspect the assembled rig at usable magnification, not just changing
  // pixels in a distant island-wide screenshot.
  await page.evaluate(() => {
    var draws = mapPreviews['1'].drawsAt(0).filter((d) => d.instanceId === 'monster:1');
    var points = draws.flatMap((d) => [[0, 0], [d.lw, 0], [0, d.lh], [d.lw, d.lh]].map(([x, y]) =>
      [d.m[0] * x + d.m[2] * y + d.m[4], d.m[1] * x + d.m[3] * y + d.m[5]]));
    var xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    var canvas = document.createElement('canvas'); canvas.id = 'alignment-fixture';
    canvas.style.cssText = 'position:fixed;left:0;top:0;width:480px;height:480px;background:#ddd;z-index:9999';
    document.body.appendChild(canvas);
    paintMap(canvas, Object.assign({}, islandScenes['1'], { sky: undefined, draws: draws,
      viewBox: { x: Math.min(...xs) - 10, y: Math.min(...ys) - 10,
        w: Math.max(...xs) - Math.min(...xs) + 20, h: Math.max(...ys) - Math.min(...ys) + 20 } }));
  });
  await page.locator('#alignment-fixture').screenshot({ path: join(artifactDir, 'rig-alignment.png') });
  await page.evaluate(() => document.getElementById('alignment-fixture').remove());

  await page.locator('[data-map-sound="1"]').click();
  await page.waitForFunction(() => mapAudio['1'] && mapAudio['1'].transport.started && mapAudio['1'].transport.scheduledCount > 0);
  assert.equal(await page.evaluate(() => mapAudio['1'].transport.sampleCount), 2, 'original Potbelly OGGs decode');
  await page.evaluate(() => {
    window.fixtureTransport = mapAudio['1'].transport;
    window.fixtureAnalyser = fixtureTransport.context.createAnalyser();
    fixtureTransport.master.connect(fixtureAnalyser);
  });
  await page.waitForFunction(() => {
    var data = new Float32Array(fixtureAnalyser.fftSize);
    fixtureAnalyser.getFloatTimeDomainData(data);
    return data.some((v) => Math.abs(v) > 0.00001);
  });

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => mapAnimationFrame), 0);
  await page.waitForFunction(() => fixtureTransport.context.state === 'suspended');
  const pausedAudioTime = await page.evaluate(() => fixtureTransport.elapsed);
  await page.waitForTimeout(250);
  assert.equal(await page.evaluate(() => fixtureTransport.elapsed), pausedAudioTime, 'hidden audio clock is frozen');
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const resumedStart = await page.evaluate(() => mapStartedAt['1']);
  assert.ok(resumedStart >= initial.start + 200, 'hidden time is excluded from playback');

  player.coins_actual += 1;
  await page.evaluate(() => poll(true));
  await page.waitForFunction(() => lastDoc.state.player.coins === 101);
  assert.equal(await page.evaluate(() => mapStartedAt['1']), resumedStart, 'DOM refresh must not reset playback');
  assert.ok(await page.evaluate(() => mapAudio['1'].transport === fixtureTransport), 'refresh retains audio transport');
  player.islands[0].monsters[0].scale = 1.2;
  await page.evaluate(() => poll(true));
  await page.waitForFunction(() => mapPreviews['1'] && islandScenes['1'].runtime.instances.some((i) => i.id === 'monster:1' && i.origin[0] === 1.2));
  assert.equal(await page.evaluate(() => mapStartedAt['1']), resumedStart, 'layout rebuild must preserve the clock');
  assert.ok(await page.evaluate(() => mapAudio['1'].transport === fixtureTransport), 'art-only layout rebuild retains audio');

  await page.evaluate(() => { location.hash = '#/overview'; });
  await page.waitForFunction(() => !mapAnimationFrame && !Object.keys(mapPreviews).length && !Object.keys(mapPending).length && !Object.keys(mapAudio).length);
  await page.waitForFunction(() => fixtureTransport.context.state === 'closed');
  await page.evaluate(() => { location.hash = '#/island/1'; });
  await page.waitForFunction(() => mapPreviews['1'] && mapPreviews['1'].activeInstanceCount > 0);
  await page.locator('[data-map-sound="1"]').click();
  await page.waitForFunction(() => mapAudio['1'] && mapAudio['1'].transport.started);
  player.islands[0].monsters[0].muted = true;
  await page.evaluate(() => poll(true));
  await page.waitForFunction(() => !mapAudio['1'] && islandScenes['1'] && !islandScenes['1'].runtime.song.events.length);
  assert.equal(await page.locator('[data-map-sound="1"]').isDisabled(), true, 'muted monsters produce no audio program');
  player.islands[0].monsters[0].muted = false;
  await page.evaluate(() => poll(true));
  await page.waitForFunction(() => islandScenes['1'] && islandScenes['1'].runtime.song.events.length && mapPreviews['1']);
  assert.equal(await page.evaluate(() => !!mapAudio['1']), false, 'unmuting never autoplays');
  await page.locator('a', { hasText: 'Use static map' }).click();
  await page.waitForFunction(() => !USE_WASM_MAP && islandScenes['1']);
  assert.equal(await page.evaluate(() => mapAnimationFrame), 0);

  await page.route('**/api/runtime/ae-sampler.wasm', (route) => route.abort());
  await page.goto(`${origin}/?renderer=wasm#/island/1`);
  await page.waitForFunction(() => document.getElementById('mapruntime-1')?.textContent.startsWith('Static fallback:'));
  assert.equal(await page.evaluate(() => !!islandScenes['1']), true);
  assert.deepEqual(errors, []);
  console.log(`Offline Chromium smoke passed; screenshot: ${join(artifactDir, 'wasm-preview.png')}`);
} finally {
  if (browser) await browser.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
