# MCP server setup and tool reference

The Model Context Protocol (MCP) lets an AI client discover tools and call them.
`msm-state` provides **read-only** account tools over standard input and
output (stdio). It uses the same session and view model as the dashboard and
never sends gameplay requests.

Start with [package setup](../README.md#quick-start). The implementation was
researched against MSM PC **5.7.0**; game and service updates can break it.

## Before connecting a client

From `msm-re/msm-state`, install dependencies, build and complete Steam login:

```sh
npm ci
npm run build
node dist/cli.js steam-login --account "YOUR_STEAM_ACCOUNT"
node dist/cli.js overview
```

The build requires LLVM with `wasm32` support. Load your local environment as
shown in the [root guide](../../../README.md#local-settings) before login.
A saved Steam refresh token lets later sessions mint tickets headlessly.
Without it, the fallback needs the CrossOver Steam helper and a running client.

Run one live MCP server per account. Connecting can displace the official game
or another tool's session. The tools expose real account data, so keep their
output private.

## Client configuration

Configure the client to launch **node**, with an absolute path to the compiled
CLI and `mcp` as the next argument. For clients that accept a `mcpServers` JSON
configuration, the entry looks like this:

```json
{
  "mcpServers": {
    "msm-state": {
      "command": "node",
      "args": ["/absolute/path/to/msm-worker/msm-re/msm-state/dist/cli.js", "mcp"],
      "env": {
        "MSM_DEVICE_ID": "YOUR_DEVICE_ID",
        "MSM_ACCESS_KEY": "YOUR_CLIENT_ACCESS_KEY"
      }
    }
  }
}
```

Replace the placeholders. GUI clients may not inherit the environment from the
terminal where you loaded `.env`, so supply the same values through the
client's environment settings.

The server writes protocol messages to stdout and diagnostics to stderr.
For offline discovery, add `--no-connect` to the arguments:

```sh
node dist/cli.js mcp --no-connect
```

This command waits for JSON-RPC messages from an MCP client; it is not a text
chat interface. It delays login until a tool needs account data.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `--catalogs <dir>` | `msm-re/catalogs` | Catalog names, recipes, costs and markets. |
| `--poll-ms <ms>` | `30000` | Background state refresh interval. |
| `--no-connect` | Connect at startup | Delay live connection until a tool needs it. |
| `--token-cache <path>` | `msm-re/.auth-token.json` | Override the game-token file. |
| `--steam-token <path>` | `msm-re/.steam-refresh-token.json` | Override the Steam login file. |
| `--fresh-auth` | Reuse fresh cache | Force a new Steam ticket and game token. |

Auth options are global CLI flags; place them before `mcp` in the argument list.

## Tools

| Tool | Description |
| --- | --- |
| `msm_status` | Connection, auth-token and last-sync status. |
| `msm_get_guide` | The reading guide for this server. |
| `msm_overview` | Currencies, counts, everything ready, encore, sticker book, recipes, island summaries. Start here. |
| `msm_list_islands` | One compact row per island with readiness counts. |
| `msm_get_island` | Monsters, structures, breedings, eggs and bakes for one island (paged). |
| `msm_get_store` | The market as one island sees it (structures + monsters, with gates). |
| `msm_get_card_album` | Sticker-book progress, claimable pages, unopened packs, packs for sale. |
| `msm_get_events` | Encore event, clubboxes, tokens, global timed-event schedule. |
| `msm_get_raw_player` | Any raw `gs_player` field by dotted path (`mailbox`, `islands.0.monsters`, ...). |
| `msm_refresh` | Force a fresh `gs_player` fetch now. |

Most tools accept an optional `refresh` boolean. Without it, they use the
cached, background-polled state. `msm_status` and `msm_get_guide` do not need
an account-state read.

## Resources and prompts

- `msm://guide`: the reading guide (markdown).
- Prompt `summarize-msm`: asks the model to read the overview and islands and
  summarize the account.

The initialize response also carries a short `instructions` string for clients
that surface it automatically.

## CLI equivalent

Agents that can only run shell commands can use the same engine directly:

```bash
node dist/cli.js overview                 # compact JSON account snapshot
node dist/cli.js overview --island 1      # ... plus one island's full detail
```

## Connection behavior

Repeated new WebSocket logins against 5.7.0-era servers were refused with
`1013 "SKIP"` and then HTTP `429`. These are observations, not promised limits.
The session backs off refused connections from 5 to 60 seconds and reports the
cooldown in `msm_status`. Keep one server running instead of repeatedly
reconnecting.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Client cannot start the server | Verify the Node executable and absolute `dist/cli.js` path; build first. |
| Discovery works but account reads fail | Check saved Steam credentials, `MSM_DEVICE_ID`, `MSM_ACCESS_KEY` and network access. |
| Protocol parsing fails | Ensure wrappers do not print banners or logs to stdout. |
| Account keeps reconnecting | Stop competing live clients and wait for cooldown. |

Keep game tokens, Steam refresh tokens and raw state output private. See the
[root guide](../../../README.md#account-access-and-private-files) for file handling.

## Implementation map

| File | Purpose |
| --- | --- |
| [`src/services/mcp/protocol.ts`](../src/services/mcp/protocol.ts) | MCP/JSON-RPC stdio server, version negotiation, resources/prompts routing. |
| [`src/services/mcp/stateView.ts`](../src/services/mcp/stateView.ts) | Compact projections and the cached state view. |
| [`src/services/mcp/tools.ts`](../src/services/mcp/tools.ts) | Tool definitions and handlers, resources and prompts. |
| [`src/services/mcp/guide.ts`](../src/services/mcp/guide.ts) | Model-facing guide and initialize instructions. |
| [`src/cli.ts`](../src/cli.ts) | `mcp` and `overview` commands. |
