# msm-state

Read a My Singing Monsters Steam account, view it in a local dashboard, or
expose read-only account tools to an AI client, without launching the game.
The Steam app ID is `1419170`. Everything here was reverse-engineered against
MSM PC **5.7.0**; future game or service updates will probably break it.

msm-state is **read-only**. It logs in, syncs the state the server pushes and
renders it. It does not send gameplay requests (collecting, breeding, buying,
selling and so on) and does not modify the game client.

## Requirements

- Node.js **20 or later**, npm, and network access to Steam and the game servers.
- A Steam account with access to My Singing Monsters.
- LLVM `clang` with a `wasm32` backend and `wasm-ld`. The default build compiles
  both TypeScript and the animation sampler; WASM is not an optional build step.
- For game art, animation and audio: local game files in the CrossOver Steam
  bottle path described below. Headless account authentication does not require
  a running Steam client or CrossOver.

Run the commands below from `msm-re/msm-state`, unless another directory is
specified. Quoted example account names and paths are placeholders to replace.

## Quick start

First follow the root [local settings guide](../../README.md#local-settings).
Load `.env` before changing into this package directory, especially if you want
to retain your game's device identity.

```sh
cd msm-re/msm-state
npm ci
npm run build
node dist/cli.js steam-login --account "YOUR_STEAM_ACCOUNT"
node dist/cli.js overview
node dist/cli.js watch
```

The first login prompts for your password with hidden input and for a Steam
Guard code if required. It saves a Steam refresh token and a game access token
under `msm-re/`, with owner-only permissions. Later commands reuse those files.

Open **http://127.0.0.1:7331** for the dashboard. Leave `watch` running while
you use it; press **Ctrl+C** to stop it. It listens on localhost and polls every
30 seconds by default. A new game session may disconnect the official client
or another tool using the same account.

## Choose an interface

| Interface | Command | Details |
| --- | --- | --- |
| Account overview | `node dist/cli.js overview` | Compact JSON snapshot. |
| Local dashboard | `node dist/cli.js watch` | [Dashboard guide](docs/dashboard.md). |
| AI tools over stdio | `node dist/cli.js mcp` | [MCP setup](docs/mcp.md). |
| Full packet dump | `node dist/cli.js state --json` | Research output that can contain private account data. |

For command-specific options, use `node dist/cli.js COMMAND --help`.

## Other commands

```sh
node dist/cli.js login               # obtain and cache a game token
node dist/cli.js auth                # print the auth response; keep output private
node dist/cli.js state --dump frames/  # save raw frames for local research
node dist/cli.js overview --island 1
```

Catalog IDs describe a content type; instance IDs describe an owned item. The
[protocol reference](docs/protocol.md) records the underlying wire fields.

## Authentication and cached credentials

| Local file | Purpose |
| --- | --- |
| `msm-re/.auth-token.json` | Game bearer token and expiry. |
| `msm-re/.steam-refresh-token.json` | Long-lived Steam login credential. |
| `msm-re/.steam-user-data/` | Steam client cache and machine/session data. |

The credential files are excluded from version control. Treat the Steam
refresh token like a password. Headless login connects directly to Steam to
mint tickets, then keeps that connection alive until the game auth endpoint
has accepted the ticket.

Fresh game tokens are reused. If a new mint fails and a cache exists, the tool
may try the stale token and report `authStale`; acceptance depends on the server.
Observed token stability and expiry behavior are described in the
[protocol reference](docs/protocol.md), not guaranteed by this project.

Global options can relocate credentials or force a fresh mint:

```sh
node dist/cli.js --fresh-auth login
node dist/cli.js --token-cache "/absolute/path/game-token.json" overview
node dist/cli.js --steam-token "/absolute/path/steam-token.json" watch
```

Without a saved Steam refresh token, ticket minting falls back to a local
`ticket_helper.exe` in the CrossOver **Steam** bottle. This advanced fallback
requires Steam to be running and signed in; the binary is not distributed here.
`node dist/cli.js ticket` uses that helper directly.

## Catalogs and local game assets

Catalog JSON files live in `msm-re/catalogs/`. They supply names, costs,
recipes, markets and other content metadata. `--catalogs` can select another
directory. The included catalogs are snapshots, not automatically updated data.

Research scripts can refresh them, but open a live game session:

| Script | Catalogs |
| --- | --- |
| `node fetch-catalogs.mjs` | Monsters, structures and islands. |
| `node fetch-foods.mjs` | Bakery recipes. |
| `node fetch-events-catalogs.mjs` | Reward tracks and clubbox acts. |
| `node fetch-store-catalogs.mjs` | Cards, albums and card-store items. |

The current asset loader looks for the game's `data` directory at:

```text
~/Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/My Singing Monsters/data
```

There is currently no CLI option for a different game asset root. Account
commands can use headless authentication elsewhere, but the art/audio loader
still assumes this macOS path. Missing optional catalogs or assets can omit
features or produce fallback diagnostics.

## Animated map and audio previews

The static map is the default. On an island, select **Try WASM preview** for
experimental animation, then **Play original samples** for opt-in audio.

- [Animated map](docs/wasm-preview.md): use, fallbacks and browser checks.
- [Song preview](docs/song-preview.md): sample playback and timing limits.
- [Runtime roadmap](docs/wasm-runtime.md): implemented features and remaining work.

These previews use local original assets. Native-equivalent rendering,
adaptive song loops and synchronized singing clips have not been established.

## Development and verification

```sh
npm run build
npm test
```

`npm test` rebuilds the project and runs the Node test suite, including compiled
WASM tests. Some tests use local installed assets or need a localhost listener;
results depend on those resources and permissions.

`npm run test:renderer` runs an offline browser smoke test with local assets,
Playwright and Chromium. See [preview verification](docs/wasm-preview.md#verification)
for prerequisites and output files. It does not open a live game session.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Build cannot find a wasm32 compiler | Install/provide LLVM with `wasm32` and `wasm-ld`; set `WASM_CLANG` to its `clang` executable if needed. |
| No saved Steam login | Run `steam-login` once, with `.env` loaded. |
| Another client repeatedly disconnects | Stop duplicate live clients and keep one game session. |
| Login returns `429`, `1013` or `SKIP` | Allow the reconnect cooldown to finish; repeated restarts create more logins. |
| Missing art or sound | Check the CrossOver asset path and the preview's diagnostics. |
| `MSM_ACCESS_KEY is not set` | Set it in `.env`; see the root [local settings guide](../../README.md#local-settings). |
| Behavior changes after an update | Compare against the 5.7.0 findings before updating constants. |

## Documentation and source map

[Protocol](docs/protocol.md) · [Dashboard](docs/dashboard.md) ·
[MCP](docs/mcp.md) · [WASM sampler](docs/ae-sampler.md) ·
[Terrain](docs/terrain-preview.md) · [Rig transforms](docs/rig-transforms.md)

| Source | Responsibility |
| --- | --- |
| `src/cli.ts` | CLI commands and startup. |
| `src/lib/sfs.ts`, `packet.ts`, `ticket.ts` | Binary codec, frames and helper-based tickets. |
| `src/services/auth.ts`, `authApi.ts`, `steamHeadless.ts`, `pregame.ts` | Token acquisition, Steam login and server discovery. |
| `src/services/liveSession.ts`, `gameServer.ts` | Persistent read-only connection and state sync. |
| `src/services/catalogs.ts`, `viewModel.ts` | Catalogs and reader-friendly state projections. |
| `src/services/server.ts`, `dashboardHtml.ts`, `gameAssets.ts` | Dashboard HTTP routes, UI and asset loading. |
| `src/services/mcp/` | MCP transport, read-only tools and guidance. |
| `runtime/ae_sampler.c` | Freestanding animation sampler compiled to WASM. |
