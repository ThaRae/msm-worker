/**
 * msm-state: view My Singing Monsters game state without launching the game.
 *
 * Pipeline (reversed from MSM_native.exe):
 *   steam ticket (wine helper or headless steam-user) -> auth.bbbgame.net
 *   -> pregame_setup.php -> wss game socket -> USER_LOGIN -> state pushes.
 *
 * The access token is cached (default <msm-re>/.auth-token.json) and reused
 * while fresh. "msm-state steam-login" stores a Steam refresh-token JWT
 * once; after that every ticket mint is headless and Steam never needs to
 * run at all.
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { mintSteamTicket, steamIdFromTicket } from './lib/ticket.js';
import { acquireToken, defaultTokenCachePath, saveStoredToken } from './services/auth.js';
import { fetchAccessToken } from './services/authApi.js';
import {
  mintTicketHeadless,
  saveSteamRefreshToken,
  defaultSteamDataDir,
  defaultSteamTokenPath,
  type HeadlessMint,
} from './services/steamHeadless.js';
import { fetchPregameSetup, parseGameServer } from './services/pregame.js';
import { GameServerConnection } from './services/gameServer.js';
import { sfsToJson } from './lib/packet.js';
import type { GamePacket } from './lib/packet.js';
import { TICKET_HELPER_DEFAULTS } from './lib/config.js';
import { LiveSession } from './services/liveSession.js';
import { createStateServer } from './services/server.js';
import { defaultCatalogsDir } from './services/catalogs.js';
import { serveMcpStdio } from './services/mcp/protocol.js';
import {
  projectEvents,
  projectIslandDetail,
  projectIslandSummary,
  projectOverview,
  projectStatus,
  StateView,
} from './services/mcp/stateView.js';
import { createMcpHandlers, MCP_SERVER_NAME } from './services/mcp/tools.js';

/** Ticket input: minted via wine, or loaded from a hex file. */
type TicketSource = {
  ticket: Buffer;
  steamId: string;
};

/**
 * Acquire the Steam ticket: mint a fresh one via wine, or load a saved hex
 * file. --steamid only overrides the id reported to the auth API (useful
 * when replaying a saved ticket); the ticket itself is always required.
 */
function loadTicket(options: { steamid?: string; ticketFile?: string }): TicketSource {
  if (options.ticketFile !== undefined) {
    const ticket = Buffer.from(readFileSync(options.ticketFile, 'utf8').trim(), 'hex');
    return { ticket, steamId: options.steamid ?? steamIdFromTicket(ticket) };
  }
  const minted = mintSteamTicket();
  process.stderr.write(`minted ticket for steamid ${minted.steamId}\n`);
  return { ticket: minted.ticket, steamId: options.steamid ?? minted.steamId };
}

/** Resolve after quietMs without inbound packets, capped by maxMs. */
async function waitForQuiet(
  connection: GameServerConnection,
  options: { quietMs: number; maxMs: number },
): Promise<void> {
  return new Promise((resolve) => {
    let quietTimer: NodeJS.Timeout | undefined;
    let maxTimer: NodeJS.Timeout | undefined;
    let unsubscribe: () => void = () => undefined;
    const finish = (): void => {
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      if (maxTimer !== undefined) clearTimeout(maxTimer);
      unsubscribe();
      resolve();
    };
    const armQuiet = (): void => {
      if (quietTimer !== undefined) clearTimeout(quietTimer);
      quietTimer = setTimeout(finish, options.quietMs);
      quietTimer.unref();
    };
    unsubscribe = connection.onPacket(() => {
      armQuiet();
    });
    maxTimer = setTimeout(finish, options.maxMs);
    maxTimer.unref();
    armQuiet();
  });
}

/** One line per command: count and total bytes, via a single reduce. */
function summarizePackets(packets: GamePacket[]): string {
  const summary = packets.reduce<Map<string, number>>((acc, packet) => {
    acc.set(packet.cmd, (acc.get(packet.cmd) ?? 0) + 1);
    return acc;
  }, new Map());
  return [...summary.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cmd, count]) => `${cmd} x${String(count)}`)
    .join('\n');
}

function dumpDirFor(options: { dump?: string }): string | undefined {
  if (options.dump === undefined) return undefined;
  mkdirSync(options.dump, { recursive: true });
  return options.dump;
}

const program = new Command();

program
  .name('msm-state')
  .description('View My Singing Monsters game state without launching the game.')
  .option('--steamid <id>', 'override the steamid reported to auth (for replaying a saved ticket)')
  .option('--ticket-file <path>', 'use a saved ticket hex file instead of minting')
  .option('--token-cache <path>', 'where the access-token cache lives', defaultTokenCachePath())
  .option('--steam-token <path>', 'where the Steam refresh-token login lives', defaultSteamTokenPath())
  .option('--fresh-auth', 'skip the token cache and mint a new Steam ticket');

/** The auth-related global options every token-consuming command shares. */
type AuthCliOptions = {
  steamid?: string;
  ticketFile?: string;
  tokenCache?: string;
  steamToken?: string;
  freshAuth?: boolean;
};

/**
 * Read a password without echo: in non-terminal mode readline never
 * echoes input, so nothing the user types ends up on screen or in the
 * shell's history.
 */
function promptPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

program
  .command('ticket')
  .description('mint a Steam ticket via the CrossOver bottle and print it')
  .action(() => {
    const { ticket, steamId } = loadTicket(program.opts());
    process.stdout.write(`steamid=${steamId}\n`);
    process.stdout.write(`${ticket.toString('hex')}\n`);
  });

program
  .command('auth')
  .description('get an access token (cached when still fresh) and print it')
  .action(async () => {
    const options = program.opts<AuthCliOptions>();
    const auth = await acquireToken({
      steamid: options.steamid,
      ticketFile: options.ticketFile,
      tokenCacheFile: options.tokenCache ?? defaultTokenCachePath(),
      steamTokenFile: options.steamToken,
      fresh: options.freshAuth,
    });
    process.stderr.write(auth.fromCache ? 'using cached token\n' : 'minted a fresh ticket\n');
    process.stdout.write(`${JSON.stringify({ ...auth.token, from_cache: auth.fromCache, stale: auth.stale ?? false }, null, 2)}\n`);
  });

program
  .command('login')
  .description('mint a ticket (headless if a Steam login is saved) and cache the access token')
  .action(async () => {
    const options = program.opts<AuthCliOptions>();
    const auth = await acquireToken({
      steamid: options.steamid,
      ticketFile: options.ticketFile,
      tokenCacheFile: options.tokenCache ?? defaultTokenCachePath(),
      steamTokenFile: options.steamToken,
      // login exists to refresh the cache, so never hand back a cached one.
      fresh: true,
    });
    const expiresAt = new Date(auth.token.expires_at * 1000);
    const hoursLeft = (auth.token.expires_at - Date.now() / 1000) / 3600;
    process.stdout.write(
      `cached token for ${auth.token.user_game_id[0] ?? '?'} — expires ${expiresAt.toISOString()} (in ${hoursLeft.toFixed(1)}h)\n` +
      `cache file: ${options.tokenCache ?? defaultTokenCachePath()}\n`,
    );
  });

/**
 * Prompt for the password and mint a ticket, retrying when Steam rejects
 * the logon in a way another attempt can fix — the CM occasionally
 * answers InvalidPassword for a token that works seconds later, and a
 * mistyped 2FA code needs a fresh attempt.
 */
async function promptSteamMint(account: string, dataDirectory: string): Promise<HeadlessMint> {
  const retryableEresults = [5, 84, 88]; // InvalidPassword, RateLimitExceeded, TwoFactorCodeMismatch
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    const password = await promptPassword(`Steam password for ${account} (input hidden): `);
    const mint = await mintTicketHeadless({
      credentials: { accountName: account, password },
      dataDirectory,
    }).catch((error: Error & { eresult?: number }) => {
      const retryable = error.eresult !== undefined && retryableEresults.includes(error.eresult) && attempt < maxAttempts;
      if (!retryable) throw error;
      process.stderr.write(`${error.message} — retrying (${attempt} of ${maxAttempts})\n`);
      return undefined;
    });
    if (mint !== undefined) return mint;
  }
}

program
  .command('steam-login')
  .description('one-time: log into Steam directly (no Steam client) so future tickets mint headlessly')
  .requiredOption('--account <name>', 'Steam account name')
  .action(async (cmd: { account: string }) => {
    const options = program.opts<AuthCliOptions>();
    const mint = await promptSteamMint(cmd.account, defaultSteamDataDir());
    const steamTokenFile = options.steamToken ?? defaultSteamTokenPath();
    if (mint.refreshToken !== undefined) {
      saveSteamRefreshToken(steamTokenFile, mint.refreshToken);
    } else {
      process.stderr.write('no refresh token returned; steam-login will need the password again\n');
    }
    const token = await fetchAccessToken(mint.steamId, mint.ticket).finally(mint.close);
    saveStoredToken(options.tokenCache ?? defaultTokenCachePath(), token, mint.steamId);
    const expiresAt = new Date(token.expires_at * 1000);
    process.stdout.write(
      `headless Steam login OK for ${mint.steamId}\n` +
      (mint.refreshToken !== undefined ? `saved Steam refresh token: ${steamTokenFile}\n` : '') +
      `cached game token (expires ${expiresAt.toISOString()})\n`,
    );
  });

program
  .command('state')
  .description('log in to the game server and dump the state it pushes')
  .option('--quiet-ms <ms>', 'stop after this long without packets', '8000')
  .option('--max-ms <ms>', 'hard cap on collection time', '60000')
  .option('--dump <dir>', 'write each raw frame to <dir> as hex files')
  .option('--json', 'print all packets as one JSON document')
  .action(async (rawOptions: Record<string, string>) => {
    const options = program.opts<AuthCliOptions>();
    const auth = await acquireToken({
      steamid: options.steamid,
      ticketFile: options.ticketFile,
      tokenCacheFile: options.tokenCache ?? defaultTokenCachePath(),
      steamTokenFile: options.steamToken,
      fresh: options.freshAuth,
    });
    const userGameId = auth.token.user_game_id[0];
    if (userGameId === undefined) {
      throw new Error('auth response contained no user_game_id');
    }
    process.stderr.write(`logged in as ${userGameId} (${auth.fromCache ? 'cached token' : 'fresh mint'})\n`);

    const pregame = await fetchPregameSetup(auth.token.access_token);
    const endpoint = parseGameServer(pregame.serverIp);
    process.stderr.write(`game server ${endpoint.host}:${String(endpoint.port)}\n`);

    const dump = dumpDirFor(rawOptions);
    let dumpIndex = 0;
    const rawTap =
      dump === undefined
        ? undefined
        : (raw: Uint8Array, direction: 'in' | 'out'): void => {
            const name = `${String(dumpIndex).padStart(4, '0')}_${direction}.hex`;
            dumpIndex += 1;
            writeFileSync(`${dump}/${name}`, Buffer.from(raw).toString('hex'));
          };
    const connection = new GameServerConnection(endpoint, {
      onPacket: () => undefined,
      onRaw: rawTap,
    });

    // Capture everything from the wire, including the login reply, CID
    // frames and the sync dance responses.
    const packets: GamePacket[] = [];
    connection.onPacket((packet) => {
      packets.push(packet);
    });

    await connection.opened();
    await connection.login(userGameId, auth.token.access_token);
    process.stderr.write('login accepted; syncing state\n');

    await connection.runSync();
    process.stderr.write(`sync complete (${String(packets.length)} packets); waiting for trailing pushes\n`);

    await waitForQuiet(connection, {
      quietMs: Number(rawOptions.quietMs),
      maxMs: Number(rawOptions.maxMs),
    });
    connection.close();
    await connection.waitClosed();

    if (rawOptions.json !== undefined) {
      const doc = packets.map((packet) => ({
        cmd: packet.cmd,
        seq: packet.seq.toString(),
        data: packet.data === undefined ? undefined : sfsToJson(packet.data),
      }));
      process.stdout.write(`${JSON.stringify(doc, null, 2)}\n`);
    } else {
      process.stdout.write(`${summarizePackets(packets)}\n`);
    }
  });

program
  .command('watch')
  .description('run the live read-only dashboard for account state, islands and audio')
  .option('--port <port>', 'HTTP port for the dashboard', '7331')
  .option('--poll-ms <ms>', 'background state refresh interval', '30000')
  .option('--catalogs <dir>', 'catalog JSON directory', defaultCatalogsDir())
  .action(async (rawOptions: Record<string, string>) => {
    const options = program.opts<AuthCliOptions>();
    const session = new LiveSession({
      steamid: options.steamid,
      ticketFile: options.ticketFile,
      catalogsDir: rawOptions.catalogs ?? defaultCatalogsDir(),
      tokenCacheFile: options.tokenCache ?? defaultTokenCachePath(),
      steamTokenFile: options.steamToken,
      freshAuth: options.freshAuth,
    });

    const server = createStateServer(session);
    const port = Number(rawOptions.port);
    server.listen(port, '127.0.0.1', () => {
      process.stderr.write(`dashboard at http://127.0.0.1:${String(port)}\n`);
    });

    // Initial connect + sync so the first page load has data; afterwards
    // the poller keeps the player object fresh and reconnects on drops.
    session.refresh().catch((error: unknown) => {
      process.stderr.write(`initial sync failed: ${error instanceof Error ? error.message : String(error)}\n`);
    });

    const pollMs = Number(rawOptions.pollMs);
    const poller = setInterval(() => {
      session.refresh().catch(() => undefined);
    }, pollMs);
    poller.unref();
  });

/**
 * Build a live game session from the shared auth options, using the
 * requested catalog directory.
 */
function makeSession(
  options: AuthCliOptions,
  catalogsDir: string,
): LiveSession {
  return new LiveSession({
    steamid: options.steamid,
    ticketFile: options.ticketFile,
    catalogsDir,
    tokenCacheFile: options.tokenCache ?? defaultTokenCachePath(),
    steamTokenFile: options.steamToken,
    freshAuth: options.freshAuth,
  });
}

/** Write stdout and wait for the buffer to flush before a one-shot exit. */
function writeStdout(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

program
  .command('mcp')
  .description('run a read-only Model Context Protocol (stdio) server so AI clients can read account state')
  .option('--catalogs <dir>', 'catalog JSON directory', defaultCatalogsDir())
  .option('--poll-ms <ms>', 'background state refresh interval while idle', '30000')
  .option('--no-connect', 'do not log in until the first tool call arrives')
  .action((rawOptions: Record<string, unknown>) => {
    const options = program.opts<AuthCliOptions>();
    // stdout is the JSON-RPC channel: any incidental library logging must
    // never corrupt a protocol frame, so route console.log to stderr.
    console.log = (...args: unknown[]): void => {
      process.stderr.write(`${args.map((arg) => String(arg)).join(' ')}\n`);
    };
    const catalogsDir = typeof rawOptions.catalogs === 'string' ? rawOptions.catalogs : defaultCatalogsDir();
    const session = makeSession(options, catalogsDir);
    const handlers = createMcpHandlers(session);

    if (rawOptions.connect !== false) {
      session.refresh().catch((error: unknown) => {
        process.stderr.write(`initial sync failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
      const pollMs = Number(rawOptions.pollMs ?? 30000);
      if (Number.isFinite(pollMs) && pollMs > 0) {
        const poller = setInterval(() => {
          session.refresh().catch(() => undefined);
        }, pollMs);
        poller.unref();
      }
    }

    serveMcpStdio(handlers);
    process.stderr.write(`${MCP_SERVER_NAME} MCP server on stdio (Ctrl-C to stop)\n`);
  });

program
  .command('overview')
  .description('log in, sync and print a compact JSON overview of the account')
  .option('--catalogs <dir>', 'catalog JSON directory', defaultCatalogsDir())
  .option('--island <id>', 'also include one island\'s full detail')
  .action(async (rawOptions: Record<string, unknown>) => {
    const options = program.opts<AuthCliOptions>();
    const catalogsDir = typeof rawOptions.catalogs === 'string' ? rawOptions.catalogs : defaultCatalogsDir();
    const session = makeSession(options, catalogsDir);
    try {
      const view = new StateView(session);
      const api = await view.api({ refresh: true });
      const snapshot: Record<string, unknown> = {
        status: projectStatus(session),
        ...projectOverview(api),
        events: projectEvents(api, session.serverNow()),
        islands: api.islands.map(projectIslandSummary),
      };
      if (typeof rawOptions.island === 'string') {
        const island = api.islands.find((entry) => entry.userIslandId === rawOptions.island);
        snapshot.island = island === undefined ? null : projectIslandDetail(island);
      }
      await writeStdout(`${JSON.stringify(snapshot, null, 2)}\n`);
    } finally {
      session.close();
    }
    process.exit(0);
  });

await program.parseAsync();