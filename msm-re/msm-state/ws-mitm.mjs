/**
 * Local MITM for the MSM game websocket.
 *
 * The game's sfs::SetupTlsHandshake calls SSL_CTX_set_verify with mode 1
 * (SSL_VERIFY_NONE, sub_E0DAF0), so a self-signed cert is accepted. We
 * point the CrossOver bottle's hosts file at 127.0.0.1, terminate TLS
 * here, log the real client's handshake headers and every frame, then
 * proxy to the real server so the game keeps working.
 *
 * Usage: sudo node ws-mitm.mjs   (port 443 needs root)
 */

import https from 'node:https';
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';

const HOST = 'msm-pc-prod-v2.bbbgame.net';
/**
 * Upstream is dialed by IP: /etc/hosts will point HOST at 127.0.0.1 for the
 * redirect, so resolving by name here would loop back into this proxy.
 * SNI + Host header keep the virtual hosting correct at the real server.
 * DNS for the name returns two round-robin IPs; 16.59.221.3 is verified
 * reachable (the game itself was connected to it).
 */
const UPSTREAM_IP = '16.59.221.3';
const LOG = fileURLToPath(new URL('../mitm-ws/mitm.log', import.meta.url));

function log(line) {
  appendFileSync(LOG, line);
  process.stdout.write(line);
}

const server = https.createServer(
  {
    key: readFileSync(fileURLToPath(new URL('../mitm-ws/key.pem', import.meta.url))),
    cert: readFileSync(fileURLToPath(new URL('../mitm-ws/cert.pem', import.meta.url))),
  },
  (req, res) => {
    log(`[http] ${req.method} ${req.url}\n`);
    res.writeHead(404);
    res.end();
  },
);

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  log(`\n=== UPGRADE ${req.method} ${req.url} ===\n`);
  for (const [name, value] of Object.entries(req.headers)) {
    log(`  ${name}: ${value}\n`);
  }

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    // Forward the game's custom headers upstream; ws adds its own
    // handshake plumbing (Sec-WebSocket-Key/Version, Upgrade, etc).
    const hopByHop = new Set([
      'host',
      'connection',
      'upgrade',
      'sec-websocket-key',
      'sec-websocket-version',
      'sec-websocket-extensions',
      'sec-websocket-accept',
      'sec-websocket-protocol',
    ]);
    const forwardHeaders = Object.fromEntries(
      Object.entries(req.headers).filter(([name]) => !hopByHop.has(name)),
    );

    const upstream = new WebSocket(`wss://${UPSTREAM_IP}/msm/socket`, {
      headers: { ...forwardHeaders, host: HOST },
      servername: HOST,
    });

    const stamp = () => new Date().toISOString().slice(11, 23);

    // The client's first frames can arrive before upstream TLS finishes;
    // buffer them so nothing (especially USER_LOGIN) gets dropped.
    const pending = [];
    let upstreamReady = false;

    const wireTap = (label, ws) => {
      ws.on('message', (data) => {
        const hex = Buffer.from(data).toString('hex');
        log(`[${stamp()} ${label} ${hex.length / 2}b] ${hex.slice(0, 800)}${hex.length > 800 ? '...' : ''}\n`);
      });
      ws.on('close', () => log(`[${stamp()} ${label} closed]\n`));
      ws.on('error', (err) => log(`[${stamp()} ${label} error] ${err.message}\n`));
    };

    wireTap('C2S', clientWs);
    wireTap('S2C', upstream);

    clientWs.on('message', (data) => {
      if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: true });
      } else {
        pending.push(data);
      }
    });
    upstream.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data, { binary: true });
      }
    });

    upstream.on('open', () => {
      upstreamReady = true;
      log(`[${stamp()} upstream connected, flushing ${pending.length} buffered frames]\n`);
      for (const frame of pending.splice(0)) {
        upstream.send(frame, { binary: true });
      }
    });
    const die = () => {
      clientWs.close();
      upstream.close();
    };
    clientWs.on('close', die);
    upstream.on('close', die);
    clientWs.on('error', die);
    upstream.on('error', die);
  });
});

server.listen(443, '127.0.0.1', () => {
  log(`[mitm] listening on 127.0.0.1:443 for ${HOST}\n`);
});