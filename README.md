# My Singing Monsters: protocol and asset reverse engineering

A reverse-engineering study of the PC client of *My Singing Monsters*
(Steam, version **5.7.0**), and a read-only toolkit built from the findings.

By **Ryan**. Development was AI-assisted; the reversing, protocol analysis and
design decisions are my own.

## What I reverse-engineered

- **Authentication pipeline.** Steam session ticket → BBB auth token →
  pregame server discovery → WebSocket game socket, recovered from the
  client binary in IDA and confirmed with TLS interception.
- **Binary wire protocol.** The SmartFoxServer-style framing and typed object
  encoding the game uses, including undocumented quirks such as handshake
  headers that must be sent in two spellings and an array-length field whose
  width silently changes server behavior.
- **State sync.** The login "sync dance" and the ~500 KB account object the
  server pushes, mapped into typed views (islands, monsters, timers, events).
- **Animation format.** The game's skeletal animation data, reimplemented as a
  freestanding C sampler compiled to WebAssembly to render animated islands in
  the browser.
- **Music.** Island songs rebuilt from the game's MIDI and instrument samples.

The write-ups live in [`msm-re/msm-state/docs`](msm-re/msm-state/docs), starting
with the [protocol reference](msm-re/msm-state/docs/protocol.md).

## What's in the repository

`msm-re/msm-state` is a TypeScript CLI with:

- a local **dashboard** that shows account state, timers, an animated island
  map and the island's music,
- an **MCP server** that exposes the same state to AI clients as read-only tools,
- a raw **packet dump** command for protocol research,
- a test suite covering the codec, view model, renderer and MCP wiring.

The toolkit is **read-only**. It logs in to your own account and reads the
state the server sends. It does not send gameplay requests, automate play, or
modify or redistribute the game client.

## Getting started

| What you want to do | Where to go |
| --- | --- |
| Set up the CLI or run the dashboard | [msm-state setup](msm-re/msm-state/README.md) |
| Understand the dashboard | [Dashboard guide](msm-re/msm-state/docs/dashboard.md) |
| Connect an AI client | [MCP setup and tool reference](msm-re/msm-state/docs/mcp.md) |
| Animated islands and original audio | [Animated preview](msm-re/msm-state/docs/wasm-preview.md) and [song preview](msm-re/msm-state/docs/song-preview.md) |
| Protocol and renderer internals | [Protocol reference](msm-re/msm-state/docs/protocol.md) and [runtime roadmap](msm-re/msm-state/docs/wasm-runtime.md) |

Game installations, game assets, binaries and personal credentials are not
included. Future game or service updates will probably break the tools; treat
the documented behavior as findings from version 5.7.0.

## Local settings

From the repository root, copy the example file:

```sh
cp .env.example .env
```

Edit `.env`, then load it into the shell where you run the tools:

```sh
set -a
source .env
set +a
```

The tools read environment variables; they do **not** load `.env` on their own.

| Setting | Purpose |
| --- | --- |
| `MSM_DEVICE_ID` | Your own device ID from local game login data. |
| `MSM_ACCESS_KEY` | The shared access key the PC client sends. It is not published in this repository; recover it from your own copy of the client (see `src/lib/config.ts`). |

## Account access and private files

A live connection can disconnect another client using the same account, so run
one session at a time. Game tokens, Steam refresh tokens and Steam machine data
stay local, and `.gitignore` excludes them along with login saves, account
snapshots, network captures, logs and game files. Command output can include
account data, so keep it private.

## Disclaimer

This is an unofficial research project and is not affiliated with or endorsed
by Big Blue Bubble. *My Singing Monsters* and related names are trademarks of
their owners. Use it only with your own account.
