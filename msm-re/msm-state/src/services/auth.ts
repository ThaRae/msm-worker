/**
 * Access-token acquisition with a local cache, so the dashboard can run
 * without Steam being open.
 *
 * The auth API never issues a refresh_token for Steam logins (the client
 * only uses that flow for named accounts; see msm_buildAuthBindRequest
 * @0x75B160), but its access_token is stable across mints — the same
* account+device always gets the same token bytes back, only `expires_at`
 * (epoch seconds, ~2.8h out) moves. That makes the token a server-side
 * session id: caching it and replaying it is exactly what the game client
 * would do with its SecureStorage copy, and reconnects inside the validity
 * window never need Steam at all.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mintSteamTicket, steamIdFromTicket, TicketError } from '../lib/ticket.js';
import { fetchAccessToken, type AuthTokenResponse } from './authApi.js';
import {
  loadSteamRefreshToken,
  mintTicketHeadless,
  defaultSteamDataDir,
  defaultSteamTokenPath,
} from './steamHeadless.js';

export type StoredToken = {
  access_token: string;
  token_type: string;
  /** Epoch seconds, as the auth API reports it. */
  expires_at: number;
  user_game_id: string[];
  steam_id: string;
  /** Epoch ms of when this token was last refreshed. */
  saved_at: number;
};

/** A cached token this close to expiry is treated as expired. */
const EXPIRY_MARGIN_SEC = 120;

export class TokenCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenCacheError';
  }
}

/** Default cache file next to the msm-state package (<msm-re>/.auth-token.json). */
export function defaultTokenCachePath(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', '..', '..', '.auth-token.json');
}

export function loadStoredToken(path: string): StoredToken | undefined {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new TokenCacheError(`token cache ${path} is not a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.access_token !== 'string' || typeof raw.expires_at !== 'number') {
    throw new TokenCacheError(`token cache ${path} is missing access_token/expires_at`);
  }
  return {
    access_token: raw.access_token,
    token_type: typeof raw.token_type === 'string' ? raw.token_type : 'bearer',
    expires_at: raw.expires_at,
    user_game_id: Array.isArray(raw.user_game_id) ? raw.user_game_id.map(String) : [],
    steam_id: typeof raw.steam_id === 'string' ? raw.steam_id : '',
    saved_at: typeof raw.saved_at === 'number' ? raw.saved_at : 0,
  };
}

/** Persist mode 600: the token is a bearer credential for the account. */
export function saveStoredToken(path: string, token: AuthTokenResponse, steamId: string): StoredToken {
  const stored: StoredToken = {
    access_token: token.access_token,
    token_type: token.token_type,
    expires_at: token.expires_at,
    user_game_id: token.user_game_id,
    steam_id: steamId,
    saved_at: Date.now(),
  };
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
  return stored;
}

export function isTokenFresh(stored: StoredToken, nowSec: number, marginSec = EXPIRY_MARGIN_SEC): boolean {
  return stored.expires_at - nowSec > marginSec;
}

export type AcquireTokenOptions = {
  /** Saved ticket hex file; skips minting via wine (ticket replay). */
  ticketFile?: string | undefined;
  /** Overrides the steamid reported to the auth API. */
  steamid?: string | undefined;
  /** Where the access-token cache lives. */
  tokenCacheFile: string;
  /** Force a new mint even when the cached token is still fresh. */
  fresh?: boolean | undefined;
  /** Steam refresh-token JWT; when present, tickets are minted without Steam. */
  steamTokenFile?: string | undefined;
  /** steam-user storage dir for machine tokens / app ticket cache. */
  steamDataDir?: string | undefined;
};

export type AcquiredToken = {
  /** Auth API response shape; from cache when `fromCache` is set. */
  token: AuthTokenResponse;
  steamId: string;
  /** True when no Steam ticket was minted for this call. */
  fromCache: boolean;
  /** True when the cached token was already past its reported expiry. */
  stale?: boolean;
};

const toAuthResponse = (stored: StoredToken): AuthTokenResponse => ({
  ok: true,
  user_game_id: stored.user_game_id,
  login_types: ['steam'],
  access_token: stored.access_token,
  token_type: stored.token_type,
  expires_at: stored.expires_at,
  device_updated: false,
});

/**
 * Get a usable access token, touching Steam as little as possible:
 *
 * 1. fresh cached token -> return it (Steam can stay closed),
 * 2. otherwise mint a ticket and exchange it — headless via a saved
 *    Steam refresh token when we have one, else the wine helper (Steam
 *    client running),
 * 3. if minting fails but a stale cached token exists, return that and
 *    let the server have the final say on the reported expiry.
 */
export async function acquireToken(options: AcquireTokenOptions): Promise<AcquiredToken> {
  if (!options.fresh) {
    const stored = loadStoredToken(options.tokenCacheFile);
    if (stored !== undefined && isTokenFresh(stored, Math.floor(Date.now() / 1000))) {
      return { token: toAuthResponse(stored), steamId: stored.steam_id, fromCache: true };
    }
  }

  try {
    const { token, steamId } = await mintAndExchange(options);
    saveStoredToken(options.tokenCacheFile, token, steamId);
    return { token, steamId, fromCache: false };
  } catch (error) {
    // Steam off (TicketError from the wine mint) or auth API trouble
    // (e.g. the 429 rate limit): a cached session token is still worth
    // a try — the game server, not the client, decides if it's too old.
    // With --fresh the caller explicitly refused the cache, so rethrow.
    const stored = options.fresh ? undefined : loadStoredToken(options.tokenCacheFile);
    const recoverable = (error instanceof TicketError || isAuthFailure(error)) && stored !== undefined;
    if (!recoverable) throw error;
    return {
      token: toAuthResponse(stored),
      steamId: stored.steam_id,
      fromCache: true,
      stale: !isTokenFresh(stored, Math.floor(Date.now() / 1000)),
    };
  }
}

function isAuthFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'AuthApiError';
}

/**
 * Mint a ticket and exchange it for an access token. Sources are tried in
 * order — ticket replay, headless Steam (needs a saved refresh token),
 * wine helper (needs the Steam client) — and the first success wins.
 */
async function mintAndExchange(options: AcquireTokenOptions): Promise<{ token: AuthTokenResponse; steamId: string }> {
  if (options.ticketFile !== undefined) {
    const ticket = Buffer.from(readFileSync(options.ticketFile, 'utf8').trim(), 'hex');
    const steamId = options.steamid ?? steamIdFromTicket(ticket);
    return { token: await fetchAccessToken(steamId, ticket), steamId };
  }

  const steamTokenFile = options.steamTokenFile ?? defaultSteamTokenPath();
  const dataDirectory = options.steamDataDir ?? defaultSteamDataDir();
  const attempts: Array<() => Promise<{ token: AuthTokenResponse; steamId: string }>> = [];

  let steamToken: string | undefined;
  // A corrupt refresh-token file should not block the wine path, but it
  // should not be silent either.
  try {
    steamToken = loadSteamRefreshToken(steamTokenFile);
  } catch (error) {
    process.stderr.write(`ignoring unreadable ${steamTokenFile}: ${error instanceof Error ? error.message : String(error)}\n`);
  }
  if (steamToken !== undefined) {
    attempts.push(() => {
      process.stderr.write('minting ticket via headless Steam login\n');
      return mintTicketHeadless({ refreshToken: steamToken, dataDirectory }).then(async (mint) => {
        // close() only after the exchange: Steam cancels session tickets
        // when their minting session logs off.
        const token = await fetchAccessToken(mint.steamId, mint.ticket).finally(mint.close);
        return { token, steamId: mint.steamId };
      });
    });
  }

  attempts.push(() => {
    const minted = mintSteamTicket();
    process.stderr.write(`minted ticket for steamid ${minted.steamId}\n`);
    const steamId = options.steamid ?? minted.steamId;
    return fetchAccessToken(steamId, minted.ticket).then((token) => ({ token, steamId }));
  });

  const errors: unknown[] = [];
  for (const attempt of attempts) {
    const outcome = await attempt().catch((error: unknown) => {
      errors.push(error);
      return undefined;
    });
    if (outcome !== undefined) return outcome;
  }
  // Keep the stale-fallback classification working: if any source failed
  // for a reason the fallback understands (Steam off, auth API down),
  // surface that error rather than an aggregate.
  const recoverable = errors.find((error) => error instanceof TicketError || isAuthFailure(error));
  throw recoverable ?? errors[0] ?? new Error('no ticket source available');
}