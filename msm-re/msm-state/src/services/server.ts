/**
 * Local HTTP server for the dashboard: serves the page, the aggregated
 * state document, and asset/audio routes. It is read-only: there are no
 * gameplay endpoints. Built on node:http so
 * the tool keeps zero runtime dependencies beyond ws/commander.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveSession, type SessionEvent } from './liveSession.js';
import { buildApiState } from './viewModel.js';
import { DASHBOARD_HTML } from './dashboardHtml.js';
import { assetManifestFor, buildIslandScene, buildRuntimeIslandScene, gameDataDir } from './gameAssets.js';
import { audioSamplePath } from './gameSongs.js';
type StateDocument = {
  status: { status: string; lastError: string | undefined; lastSyncAtMs: number };
  serverNowMs: number;
  events: SessionEvent[];
  state: ReturnType<typeof buildApiState>;
};

export function createStateServer(session: LiveSession): ReturnType<typeof createServer> {
  const stateDocument = (): StateDocument => ({
    status: session.getStatus(),
    serverNowMs: session.serverNow(),
    events: session.getEvents(),
    state: buildApiState(session.getPlayerObject(), session.getCatalogs(), session.serverNow(), session.getTimedEvents()),
  });

  const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(payload);
  };

  return createServer((req, res) => {
    void handle(req, res);
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    // Exact allowlist: exposes only our experimental runtime, never arbitrary
    // project files or game resources. Independent of authentication/state.
    const runtimeFiles: Record<string, { path: URL; mime: string }> = {
      '/api/runtime/ae-sampler.wasm': {
        path: new URL('../../public/runtime/ae-sampler.wasm', import.meta.url), mime: 'application/wasm',
      },
      '/api/runtime/ae-sampler.js': {
        path: new URL('../lib/wasmAeSampler.js', import.meta.url), mime: 'text/javascript; charset=utf-8',
      },
      '/api/runtime/wasmAeSampler.js': {
        path: new URL('../lib/wasmAeSampler.js', import.meta.url), mime: 'text/javascript; charset=utf-8',
      },
      '/api/runtime/songPreview.js': {
        path: new URL('../lib/songPreview.js', import.meta.url), mime: 'text/javascript; charset=utf-8',
      },
      '/api/runtime/animationPreview.js': {
        path: new URL('../lib/animationPreview.js', import.meta.url), mime: 'text/javascript; charset=utf-8',
      },
    };
    const runtimeFile = Object.hasOwn(runtimeFiles, url.pathname) ? runtimeFiles[url.pathname] : undefined;
    if (req.method === 'GET' && runtimeFile !== undefined) {
      try {
        const payload = readFileSync(fileURLToPath(runtimeFile.path));
        res.writeHead(200, { 'content-type': runtimeFile.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(payload);
      } catch {
        sendJson(res, 503, { ok: false, error: 'runtime build unavailable; run npm run build' });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, stateDocument());
      return;
    }

    // Raw login state as the server sent it — the ground truth used to
    // reverse new fields (encore events, clubbox, minigames...) before
    // they get a typed view.
    if (req.method === 'GET' && url.pathname === '/api/raw') {
      sendJson(res, 200, {
        player: session.getPlayerObject() ?? {},
        timedEvents: session.getTimedEvents(),
      });
      return;
    }

    // Sprite metadata for the island map (portraits + structure bodies),
    // resolved from the game's own asset files, limited to what the
    // player owns.
    if (req.method === 'GET' && url.pathname === '/api/assets/manifest') {
      sendJson(res, 200, assetManifestFor(session.getCatalogs(), session.getPlayerObject()));
      return;
    }

    const islandView = /^\/api\/islands\/(\d+)\/(view|runtime)$/.exec(url.pathname);
    if (req.method === 'GET' && islandView !== null) {
      const userIslandId = islandView[1] ?? '';
      const state = stateDocument().state;
      const island = state.islands.find((entry) => entry.userIslandId === userIslandId);
      if (island === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown island' });
        return;
      }
      try {
        sendJson(res, 200, islandView[2] === 'runtime'
          ? buildRuntimeIslandScene(island, session.getCatalogs())
          : buildIslandScene(island, session.getCatalogs()));
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // Game textures, served straight from the CrossOver bottle. Every
    // path segment is restricted to word chars (no dots, no slashes),
    // which makes traversal from this route impossible; AVIF is decoded
    // natively by the browser.
    const assetMatch = /^\/api\/assets\/((?:[\w-]+\/)*[\w-]+\.avif)$/.exec(url.pathname);
    if (req.method === 'GET' && assetMatch !== null) {
      const file = join(gameDataDir(), 'gfx', assetMatch[1] ?? '');
      if (!existsSync(file)) {
        sendJson(res, 404, { ok: false, error: 'no such asset' });
        return;
      }
      res.writeHead(200, {
        'content-type': 'image/avif',
        // Textures only change when the game updates; the manifest is
        // re-fetched per page load, so a long client cache is safe.
        'cache-control': 'public, max-age=86400',
      });
      res.end(readFileSync(file));
      return;
    }

    const audioMatch = /^\/api\/audio\/music\/([\w-]+\.ogg)$/.exec(url.pathname);
    if (req.method === 'GET' && audioMatch !== null) {
      try {
        const file = audioSamplePath(gameDataDir(), audioMatch[1]!);
        if (statSync(file).size > 24 * 1024 * 1024) throw new Error('Sample exceeds limit');
        const payload = readFileSync(file);
        res.writeHead(200, { 'content-type': 'audio/ogg', 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' });
        res.end(payload);
      } catch { sendJson(res, 404, { ok: false, error: 'no such audio sample' }); }
      return;
    }

    sendJson(res, 404, { ok: false, error: `no route for ${req.method ?? '?'} ${url.pathname}` });
  }
}