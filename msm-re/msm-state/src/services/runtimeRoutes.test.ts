import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { gameDataDir } from './gameAssets.js';
import { createStateServer } from './server.js';
import type { LiveSession } from './liveSession.js';

test('runtime routes serve browser module/WASM without accessing game session', async () => {
  const session = new Proxy({}, { get() { throw new Error('runtime route accessed session'); } }) as LiveSession;
  const server = createStateServer(session);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${origin}/api/runtime/ae-sampler.wasm`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/wasm');
    const { instance } = await WebAssembly.instantiateStreaming(response, {});
    assert.equal((instance.exports.ae_abi_version as () => number)(), 1);
    const module = await fetch(`${origin}/api/runtime/ae-sampler.js`);
    assert.equal(module.status, 200);
    assert.match(module.headers.get('content-type') ?? '', /javascript/);
    assert.match(await module.text(), /export class WasmAeSampler/);
    const preview = await fetch(`${origin}/api/runtime/animationPreview.js`);
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /from ['"]\.\/wasmAeSampler\.js['"]/);
    assert.equal((await fetch(`${origin}/api/runtime/wasmAeSampler.js`)).status, 200);
    const audioModule = await fetch(`${origin}/api/runtime/songPreview.js`);
    assert.equal(audioModule.status, 200);
    assert.match(await audioModule.text(), /export class SongPreview/);
    if (existsSync(join(gameDataDir(), 'audio/music/01-B_Monster_01.ogg'))) {
      const audio = await fetch(`${origin}/api/audio/music/01-B_Monster_01.ogg`);
      assert.equal(audio.status, 200); assert.equal(audio.headers.get('content-type'), 'audio/ogg');
      assert.equal(Buffer.from(await audio.arrayBuffer()).subarray(0, 4).toString(), 'OggS');
    }
    for (const path of ['missing.ogg', 'x.mid', 'x.ogg/extra', '%2e%2e%2fsecret.ogg']) {
      assert.equal((await fetch(`${origin}/api/audio/music/${path}`)).status, 404);
    }
    for (const path of ['other.wasm', '.auth-token.json', 'ae-sampler.wasm/extra', '__proto__', 'constructor']) {
      assert.equal((await fetch(`${origin}/api/runtime/${path}`)).status, 404);
    }
    assert.equal((await fetch(`${origin}/api/runtime/ae-sampler.wasm`, { method: 'POST' })).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
