/**
 * A long-lived game session for the dashboard: keeps the websocket open
 * after login and tracks the newest gs_player payload and server clock.
 * It is read-only: it never sends gameplay requests. If the socket drops, the next poll
 * transparently reconnects — reusing the cached access token while it is
 * fresh, and only minting a Steam ticket (which needs Steam running) when
 * that fails. Logging in takes over the session from the running game
 * client, which the server tolerates without data loss.
 */

import { fetchPregameSetup, parseGameServer, type GameServerEndpoint } from './pregame.js';
import { GameServerConnection } from './gameServer.js';
import { isSfsObject } from '../lib/sfs.js';
import { sfsToJson } from '../lib/packet.js';
import type { GamePacket } from '../lib/packet.js';
import { newSfsObject } from '../lib/sfs.js';
import type { PlayerJson } from './viewModel.js';
import { loadCatalogs, type Catalogs } from './catalogs.js';
import { acquireToken } from './auth.js';

export type SessionStatus = 'offline' | 'starting' | 'online';

export type SessionEvent = {
  atMs: number;
  kind: 'push' | 'request' | 'response' | 'error' | 'status';
  cmd: string;
  detail?: string | undefined;
};

/** Commands that are part of the login/sync plumbing, not activity. */
const NOISE_CMDS = new Set([
  'CID',
  'keep_alive',
  'client_keep_alive',
  'USER_LOGIN',
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
  'gs_process_unclaimed_purchases',
]);

const MAX_EVENTS = 100;
const REQUEST_TIMEOUT_MS = 20_000;

const truncate = (text: string, max = 300): string => (text.length <= max ? text : `${text.slice(0, max)}...`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Login/connection backoff after the gateway refuses a new socket. */
const CONNECT_BACKOFF_BASE_MS = 5_000;
const CONNECT_BACKOFF_MAX_MS = 60_000;
const THROTTLE_PATTERN = /too fast|too many|rate limit|throttl|slow down|flood|try again|busy/i;

export class LiveSession {
  private connection: GameServerConnection | undefined;
  private catalogs: Catalogs | undefined;
  private playerObject: PlayerJson | undefined;
  /** Global timed-event definitions from the gs_timed_events sync push
   * (encore schedule, costume availability, weekly monster availability...). */
  private timedEvents: Record<string, unknown>[] = [];
  /** Server epoch ms captured with the local wall clock it arrived at. */
  private serverTimeMs = 0;
  private serverTimeAtMs = 0;
  private status: SessionStatus = 'offline';
  private lastError: string | undefined;
  private lastSyncAtMs = 0;
  private events: SessionEvent[] = [];
  private starting: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  /** How the access token used for the current session was obtained. */
  private authInfo: { expiresAtMs: number; fromCache: boolean; stale: boolean } | undefined;
  /** Consecutive failed connection attempts since the last successful start. */
  private connectFailures = 0;
  /** Epoch ms before which we refuse to try connecting again (login throttle). */
  private cooldownUntilMs = 0;

  constructor(
    private readonly options: {
      steamid?: string | undefined;
      ticketFile?: string | undefined;
      catalogsDir: string;
      /** Access-token cache file; reconnects inside the token's ~2.8h
       * validity reuse it without touching Steam. */
      tokenCacheFile: string;
      /** Steam refresh-token file; when present, ticket mints go through
       * a headless Steam login instead of the wine helper. */
      steamTokenFile?: string | undefined;
      /** Skip the token cache on the next login (force a Steam mint). */
      freshAuth?: boolean | undefined;
    },
  ) {}

  getCatalogs(): Catalogs {
    // Catalogs are immutable content tables; load lazily so a missing
    // catalog dir fails on first use with the actionable error from loadCatalogs.
    if (this.catalogs === undefined) {
      this.catalogs = loadCatalogs(this.options.catalogsDir);
    }
    return this.catalogs;
  }

  getStatus(): {
    status: SessionStatus;
    lastError: string | undefined;
    lastSyncAtMs: number;
    authExpiresAtMs: number | undefined;
    authFromCache: boolean | undefined;
    authStale: boolean | undefined;
    /** Epoch ms until which new connections are refused after a login throttle. */
    cooldownUntilMs: number;
    cooldownRemainingMs: number;
    connectFailures: number;
  } {
    return {
      status: this.status,
      lastError: this.lastError,
      lastSyncAtMs: this.lastSyncAtMs,
      authExpiresAtMs: this.authInfo?.expiresAtMs,
      authFromCache: this.authInfo?.fromCache,
      authStale: this.authInfo?.stale,
      cooldownUntilMs: this.cooldownUntilMs,
      cooldownRemainingMs: Math.max(0, this.cooldownUntilMs - Date.now()),
      connectFailures: this.connectFailures,
    };
  }

  /**
   * True when the initial state has not arrived yet.
   */
  needsStateRefresh(): boolean {
    return this.playerObject === undefined;
  }

  getPlayerObject(): PlayerJson | undefined {
    return this.playerObject;
  }

  getTimedEvents(): Record<string, unknown>[] {
    return this.timedEvents;
  }

  getEvents(): SessionEvent[] {
    return this.events;
  }

  /**
   * Close the game socket and mark the session offline. The MCP server
   * exits with the process, but one-shot CLI commands use this so the
   * event loop drains instead of hanging on the open websocket.
   */
  close(): void {
    this.connection?.close();
    this.connection = undefined;
    this.status = 'offline';
  }

  /** Current server epoch ms, extrapolated from the last captured server_time. */
  serverNow(): number {
    if (this.serverTimeMs === 0) return Date.now();
    return this.serverTimeMs + (Date.now() - this.serverTimeAtMs);
  }

  /** Serialize refreshes so request/response pairs on the
   * shared socket never interleave in a confusing order. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private log(kind: SessionEvent['kind'], cmd: string, detail?: string): void {
    this.events.push({ atMs: Date.now(), kind, cmd, detail });
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
  }

  /** Connect and sync if we're not online yet; concurrent callers share one start. */
  ensureStarted(): Promise<void> {
    if (this.status === 'online' && this.connection !== undefined) return Promise.resolve();
    // After a refused login the gateway needs time before it accepts another
    // connection; retrying immediately only deepens the throttle (observed
    // close 1013 "SKIP" and HTTP 429 on the websocket handshake).
    const waitMs = this.cooldownUntilMs - Date.now();
    if (waitMs > 0) {
      return Promise.reject(
        new Error(`server refused connections (rate limit); cooling down ${Math.ceil(waitMs / 1000)}s`),
      );
    }
    if (this.starting !== undefined) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async start(): Promise<void> {
    this.status = 'starting';
    this.lastError = undefined;
    try {
      // Cached token first: reconnects inside the ~2.8h validity window
      // never touch Steam; a stale cache is the fallback when Steam is
      // off (the server has the final say on the reported expiry).
      const auth = await acquireToken({
        steamid: this.options.steamid,
        ticketFile: this.options.ticketFile,
        tokenCacheFile: this.options.tokenCacheFile,
        steamTokenFile: this.options.steamTokenFile,
        fresh: this.options.freshAuth,
      });
      const userGameId = auth.token.user_game_id[0];
      if (userGameId === undefined) {
        throw new Error('auth response contained no user_game_id');
      }
      this.authInfo = {
        expiresAtMs: auth.token.expires_at * 1000,
        fromCache: auth.fromCache,
        stale: auth.stale ?? false,
      };
      if (auth.stale) {
        this.log('status', 'auth', 'using cached token past its reported expiry');
      }
      const pregame = await fetchPregameSetup(auth.token.access_token);
      const endpoint = parseGameServer(pregame.serverIp);

      const connection = new GameServerConnection(endpoint, { onPacket: (packet) => this.handlePacket(packet) });
      this.connection = connection;
      connection.waitClosed().then(() => {
        if (this.connection === connection) {
          this.connection = undefined;
          this.status = 'offline';
          // A fresh session starts on the player's last active island,
          // which we don't know, so force an explicit switch first.
          this.log('status', 'disconnect');
        }
      });

      await connection.opened();
      await connection.login(userGameId, auth.token.access_token);
      await connection.runSync();
      this.status = 'online';
      this.connectFailures = 0;
      this.cooldownUntilMs = 0;
      this.log('status', 'online');
    } catch (error) {
      this.status = 'offline';
      const message = error instanceof Error ? error.message : String(error);
      this.connectFailures += 1;
      const backoff = Math.min(CONNECT_BACKOFF_MAX_MS, CONNECT_BACKOFF_BASE_MS * 2 ** (this.connectFailures - 1));
      this.cooldownUntilMs = Date.now() + backoff;
      this.lastError = `${message} (retrying in ${Math.round(backoff / 1000)}s)`;
      this.log('error', 'start', this.lastError);
      this.connection?.close();
      this.connection = undefined;
      throw new Error(this.lastError);
    }
  }

  private handlePacket(packet: GamePacket): void {
    if (packet.data === undefined) return;
    const serverTime = packet.data.entries.get('server_time');
    if (typeof serverTime === 'bigint') {
      this.serverTimeMs = Number(serverTime);
      this.serverTimeAtMs = Date.now();
    }
    if (packet.cmd === 'gs_player') {
      const playerObject = packet.data.entries.get('player_object');
      if (isSfsObject(playerObject)) {
        this.playerObject = sfsToJson(playerObject) as PlayerJson;
        this.lastSyncAtMs = Date.now();
      }
    }
    if (packet.cmd === 'gs_timed_events') {
      const json: unknown = sfsToJson(packet.data);
      const list = isRecord(json) ? json.timed_event_list : undefined;
      if (Array.isArray(list)) {
        this.timedEvents = list.filter(isRecord);
      }
    }
    if (!NOISE_CMDS.has(packet.cmd)) {
      this.log('push', packet.cmd, truncate(JSON.stringify(sfsToJson(packet.data))));
    }
  }

  /** Re-fetch the full player state and refresh the server clock. */
  async refresh(): Promise<void> {
    return this.serialize(() => this.refreshNow());
  }

  /** The actual fetch; must only be called from inside the queue, since
   * calling refresh() from a queued task would queue behind itself and
   * deadlock. */
  private async refreshNow(): Promise<void> {
    await this.ensureStarted();
    const connection = this.connection;
    if (connection === undefined) {
      throw new Error('session is not connected');
    }
    const fullFetch = newSfsObject();
    fullFetch.entries.set('last_updated', 0n);
    await connection.request('gs_player', fullFetch, REQUEST_TIMEOUT_MS);
    // db_items is a tiny response that always carries a fresh server_time.
    await connection.request('db_items', fullFetch, REQUEST_TIMEOUT_MS);
  }
}
