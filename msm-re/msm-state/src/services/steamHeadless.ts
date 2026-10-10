/**
 * Headless Steam logon via the steam-user package: mints the same
 * GetAuthSessionTicket blob that ticket_helper.exe produces, but over a
 * direct connection to a Steam CM — no Steam client, no wine.
 *
 * The only interactive step is the initial password logon (Steam Guard
 * codes prompt on stdin, handled by steam-user itself). On success Steam
 * hands back a refresh-token JWT; once that is persisted every later mint
 * is logOn({refreshToken}): no password, no guard, no Steam running.
 *
 * The ticket must be exchanged with the auth API while the connection
 * that minted it stays open — Steam cancels session tickets when their
 * minting session logs off — so the mint result carries a close() handle
 * the caller invokes after the exchange.
 */

import SteamUser from 'steam-user';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** My Singing Monsters on Steam (steam_appid.txt in the game folder). */
export const MSM_STEAM_APPID = 1419170;

export type SteamCredentials = {
  accountName: string;
  password: string;
};

export type HeadlessMint = {
  /** Raw GetAuthSessionTicket bytes — the hex form is the auth API's `p`. */
  ticket: Buffer;
  steamId: string;
  /**
   * Only a password logon produces one; save it with saveSteamRefreshToken
   * to make future mints non-interactive.
   */
  refreshToken?: string;
  /** Disconnect from Steam. Call only after the ticket was exchanged. */
  close: () => void;
};

/** msm-re root, shared with the game token cache location. */
function msmReRoot(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', '..', '..');
}

/** steam-user's own storage: machine auth tokens + cached app tickets. */
export function defaultSteamDataDir(): string {
  return join(msmReRoot(), '.steam-user-data');
}

/** Steam refresh-token JWT next to the game token cache. */
export function defaultSteamTokenPath(): string {
  return join(msmReRoot(), '.steam-refresh-token.json');
}

export function loadSteamRefreshToken(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`steam refresh token ${path} is not a JSON object`);
  }
  const token = (parsed as Record<string, unknown>).refresh_token;
  if (typeof token !== 'string' || token === '') {
    throw new Error(`steam refresh token ${path} is missing refresh_token`);
  }
  return token;
}

/** mode 600: this JWT is equivalent to the account password. */
export function saveSteamRefreshToken(path: string, token: string): void {
  writeFileSync(path, `${JSON.stringify({ refresh_token: token, saved_at: Date.now() }, null, 2)}\n`, { mode: 0o600 });
}

export type HeadlessMintOptions = {
  /** Interactive first-time login; Steam Guard prompts on stdin. */
  credentials?: SteamCredentials | undefined;
  /** Saved JWT — the non-interactive path. */
  refreshToken?: string | undefined;
  /** steam-user storage dir (machine tokens, app ticket cache). */
  dataDirectory: string;
  appid?: number | undefined;
};

/**
 * Log into Steam directly and mint an auth session ticket for the game.
 * Never rejects after the ticket is minted: once mint.close() is called
 * the connection drops, so resolve/reject races are settled once.
 */
export function mintTicketHeadless(options: HeadlessMintOptions): Promise<HeadlessMint> {
  if (options.credentials === undefined && options.refreshToken === undefined) {
    return Promise.reject(new Error('headless mint needs credentials or a refresh token'));
  }
  const appid = options.appid ?? MSM_STEAM_APPID;

  return new Promise((resolve, reject) => {
    const user = new SteamUser({ dataDirectory: options.dataDirectory });
    let refreshToken: string | undefined;
    let settled = false;

    // The ticket was minted by this CM session; Steam cancels tickets of
    // logged-off sessions, so close() stays in the caller's hands until
    // the auth API has accepted the ticket.
    const close = (): void => {
      user.logOff();
    };
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      outcome();
    };
    const fail = (error: Error): void => {
      settle(() => {
        close();
        reject(error);
      });
    };

    user.on('error', fail);
    // A dropped CM connection would otherwise leave the mint hanging
    // forever — the settled guard makes this a no-op once we've succeeded
    // (logOff also triggers 'disconnected').
    user.on('disconnected', (eresult: number, msg?: string) => {
      fail(new Error(`Steam connection lost during login (eresult ${eresult}${msg !== undefined ? `: ${msg}` : ''})`));
    });
    // Password logons emit the refresh-token JWT right before the logon
    // message goes out; refresh-token logons never re-emit it.
    user.on('refreshToken', (token: string) => {
      refreshToken = token;
    });
    user.on('loggedOn', () => {
      user.createAuthSessionTicket(appid)
        .then(({ sessionTicket }) => {
          const steamId = user.steamID?.getSteamID64();
          settle(() => {
            if (steamId === undefined) {
              close();
              reject(new Error('logged on to Steam but had no steamID when the ticket was minted'));
              return;
            }
            const mint: HeadlessMint = { ticket: sessionTicket, steamId, close };
            if (refreshToken !== undefined) mint.refreshToken = refreshToken;
            resolve(mint);
          });
        }, fail);
    });

    if (options.credentials !== undefined) {
      user.logOn({
        accountName: options.credentials.accountName,
        password: options.credentials.password,
        machineName: 'msm-state',
      });
    } else if (options.refreshToken !== undefined) {
      user.logOn({ refreshToken: options.refreshToken, machineName: 'msm-state' });
    }
  });
}