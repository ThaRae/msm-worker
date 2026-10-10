/**
 * WebSocket client for the MSM game server ("tomcat" transport).
 *
 * Mirrors sfs::SFSTomcatClient from MSM_native.exe:
 * - connect (0xDAA720) opens wss://<host>/msm/socket with the client
 *   version, access key and user agent as WS handshake headers.
 * - on open, net_NetworkHandler_onConnected_doLogin (0xB432A0) sends the
 *   USER_LOGIN packet; the server replies USER_LOGIN with session data and
 *   then pushes game state as extension commands.
 * - keep_alive (0xDAB1F0) is sent periodically with no payload object.
 */

import WebSocket from 'ws';
import { encodePacket, decodePacket, type GamePacket } from '../lib/packet.js';
import { newSfsObject } from '../lib/sfs.js';
import type { SfsObject } from '../types/sfs.js';
import { CLIENT_CONFIG, USER_AGENT, bbbAccessKey } from '../lib/config.js';
import type { GameServerEndpoint } from './pregame.js';

export class GameServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameServerError';
  }
}

type PacketListener = (packet: GamePacket, raw: Uint8Array) => void;

/**
 * The client-driven sync dance the game performs right after login
 * (captured via mitm of the live 5.7.0 client). Each request carries
 * last_updated=0 for a full fetch; the server answers each with a
 * response of the same command name, in order.
 *
 * The game also sends db_precheck {last_updated, precheck: [db names]}
 * first, but that is only an optimization to skip unchanged stores; the
 * game requests db_store_v2/db_scratch_offs/db_items unconditionally
 * regardless of the precheck result, so a fresh fetcher can omit it.
 */
const SYNC_REQUESTS = [
  'db_store_v2',
  'db_scratch_offs',
  'db_battle',
  'db_attuner_gene',
  'db_minigames',
  'db_items',
  'gs_quest',
  'gs_timed_events',
  'gs_rare_monster_data',
  'gs_epic_monster_data',
  'gs_monster_island_2_island_data',
  'gs_cant_breed',
  'gs_player',
] as const;

/** The one sync request with no last_updated argument. */
const SYNC_FINAL_REQUEST = 'gs_process_unclaimed_purchases';

/** Build the nested login object (field values from a live mitm capture). */
export function buildLoginObject(userGameId: string, accessToken: string): SfsObject {
  const data = newSfsObject();
  data.entries.set('client_version', CLIENT_CONFIG.clientVersion);
  // Timestamp-like fields are SFS longs (tag 5), hence bigints. The game
  // sends -1 for last_command_id on a fresh session (never connected).
  data.entries.set('last_updated', BigInt(Date.now()));
  data.entries.set('last_update_version', CLIENT_CONFIG.clientVersion);
  data.entries.set('client_device', CLIENT_CONFIG.deviceModel);
  data.entries.set('client_os', CLIENT_CONFIG.osVersion);
  data.entries.set('client_platform', CLIENT_CONFIG.platform);
  data.entries.set('client_lang', '');
  data.entries.set('raw_device_id', CLIENT_CONFIG.deviceId);
  data.entries.set('token', accessToken);
  data.entries.set('access_key', bbbAccessKey());
  data.entries.set('attempt_recovery', false);
  data.entries.set('last_session_id', '');
  data.entries.set('last_command_id', -1n);
  data.entries.set('attempt_reconnect', false);
  data.entries.set('client_subplatform', 'steam');

  const login = newSfsObject();
  login.entries.set('user', userGameId);
  login.entries.set('password', '');
  login.entries.set('zone', CLIENT_CONFIG.sfsZone);
  login.entries.set('data', data);
  return login;
}

export class GameServerConnection {
  private readonly socket: WebSocket;
  private readonly rawTap: ((raw: Uint8Array, direction: 'in' | 'out') => void) | undefined;
  private readonly packetListeners = new Set<PacketListener>();
  private nextSeq = 0n;
  private keepAliveTimer: NodeJS.Timeout | undefined;
  private closed = false;

  constructor(
    endpoint: GameServerEndpoint,
    options: {
      /** Called for every inbound packet after connection setup. */
      onPacket: PacketListener;
      /** Optional raw frame tap for --dump mode. */
      onRaw?: ((raw: Uint8Array, direction: 'in' | 'out') => void) | undefined;
    },
  ) {
    const scheme = endpoint.useSsl ? 'wss' : 'ws';
    this.rawTap = options.onRaw;
    this.socket = new WebSocket(
      `${scheme}://${endpoint.host}:${String(endpoint.port)}/msm/socket`,
      {
        headers: {
          // The real client sends both dash and underscore variants
          // (verified by mitm of the live game); the gateway drops
          // connections that don't match.
          'client-version': CLIENT_CONFIG.clientVersion,
          client_version: CLIENT_CONFIG.clientVersion,
          'access-key': bbbAccessKey(),
          access_key: bbbAccessKey(),
          'User-Agent': USER_AGENT,
        },
        // The game's websocketpp client offers no extensions; a strict
        // gateway may choke on the permessage-deflate offer ws sends by
        // default.
        perMessageDeflate: false,
      },
    );
    this.packetListeners.add(options.onPacket);
    this.socket.on('message', (raw) => {
      if (raw instanceof Buffer) {
        this.handleMessage(raw);
      }
    });
    this.socket.once('close', (code: number, reason: Buffer) => {
      this.closed = true;
      this.stopKeepAlive();
      // The close reason is the only diagnostic the gateway ever sends;
      // without it a drop looks like a random network failure.
      process.stderr.write(
        `ws closed code=${String(code)} reason=${JSON.stringify(reason.toString('utf8'))}\n`,
      );
    });
  }

  /** Wait until the WS handshake completes. */
  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('open', () => {
        resolve();
      });
      this.socket.once('error', (err: Error) => {
        reject(new GameServerError(`websocket error: ${err.message}`));
      });
    });
  }

  /** Subscribe to decoded inbound packets. Returns an unsubscribe function. */
  onPacket(listener: PacketListener): () => void {
    this.packetListeners.add(listener);
    return () => {
      this.packetListeners.delete(listener);
    };
  }

  /**
   * Send USER_LOGIN and resolve once the server answers with USER_LOGIN.
   * Rejects on USER_ERROR/USER_DISCONNECT or if the socket dies first.
   */
  login(userGameId: string, accessToken: string): Promise<GamePacket> {
    const reply = this.expectLoginReply();
    this.send('USER_LOGIN', buildLoginObject(userGameId, accessToken));
    this.startKeepAlive();
    return reply;
  }

  /** Send an arbitrary extension request (cmd + SFSObject). */
  sendRequest(cmd: string, data: SfsObject): void {
    this.send(cmd, data);
  }

  /** Send a request and resolve on the next response with the same cmd. */
  request(cmd: string, data: SfsObject, timeoutMs: number): Promise<GamePacket> {
    const reply = this.awaitResponse(cmd, timeoutMs);
    this.sendRequest(cmd, data);
    return reply;
  }

  /**
   * Replay the game's post-login sync dance, collecting every store and
   * gameplay dataset. Resolves after the final gs_process_unclaimed_purchases
   * response; trailing pushes (e.g. gs_get_friends) arrive afterwards.
   */
  async runSync(timeoutMs = 30_000): Promise<void> {
    const fullFetch = newSfsObject();
    fullFetch.entries.set('last_updated', 0n);
    for (const cmd of SYNC_REQUESTS) {
      await this.request(cmd, fullFetch, timeoutMs);
    }
    await this.request(SYNC_FINAL_REQUEST, newSfsObject(), timeoutMs);
  }

  waitClosed(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once('close', () => resolve());
    });
  }

  close(): void {
    this.stopKeepAlive();
    this.socket.close();
  }

  private expectLoginReply(): Promise<GamePacket> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.onPacket((packet) => {
        if (packet.cmd !== 'USER_LOGIN' && packet.cmd !== 'USER_ERROR' && packet.cmd !== 'USER_DISCONNECT') {
          return;
        }
        unsubscribe();
        this.socket.off('close', onClosed);
        if (packet.cmd === 'USER_LOGIN') {
          resolve(packet);
        } else {
          reject(new GameServerError(`login refused (${packet.cmd})`));
        }
      });
      const onClosed = (): void => {
        unsubscribe();
        reject(new GameServerError('socket closed before login reply'));
      };
      this.socket.once('close', onClosed);
    });
  }

  /** Resolve on the next inbound packet with this cmd; rejects on timeout/close. */
  private awaitResponse(cmd: string, timeoutMs: number): Promise<GamePacket> {
    return new Promise((resolve, reject) => {
      // A listener attached after ws emitted 'close' never fires, so an
      // already-dead socket must reject immediately instead of burning
      // the whole timeout.
      if (this.closed) {
        reject(new GameServerError(`socket already closed while waiting for ${cmd} response`));
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        reject(new GameServerError(`timed out waiting for ${cmd} response`));
      }, timeoutMs);
      const unsubscribe = this.onPacket((packet) => {
        if (packet.cmd !== cmd) return;
        cleanup();
        resolve(packet);
      });
      const onClosed = (): void => {
        cleanup();
        reject(new GameServerError(`socket closed while waiting for ${cmd} response`));
      };
      const cleanup = (): void => {
        clearTimeout(timer);
        unsubscribe();
        this.socket.off('close', onClosed);
      };
      this.socket.once('close', onClosed);
    });
  }

  private send(cmd: string, data?: SfsObject): void {
    const bytes = encodePacket(this.nextSeq, cmd, data);
    this.nextSeq += 1n;
    this.socket.send(bytes);
    this.rawTap?.(bytes, 'out');
  }

  private startKeepAlive(): void {
    // The client answers the server's client_keep_alive on a 30s timer;
    // the frame carries an empty SFSObject (verified via mitm: 8 seq +
    // "keep_alive" + tag 18 with zero entries).
    this.keepAliveTimer = setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.send('keep_alive', newSfsObject());
      }
    }, 30_000);
    this.keepAliveTimer.unref();
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== undefined) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  private handleMessage(raw: Buffer): void {
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    this.rawTap?.(bytes, 'in');
    const packet = decodePacket(bytes);
    for (const listener of this.packetListeners) {
      listener(packet, bytes);
    }
  }
}