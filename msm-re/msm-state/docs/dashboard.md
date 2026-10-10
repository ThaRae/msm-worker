# Dashboard guide

The dashboard is a read-only view of an account: state, timers, an island map
with animation, and the game's music. Start it after completing
[setup](../README.md#quick-start):

```sh
node dist/cli.js watch
```

Open **http://127.0.0.1:7331** and keep the process running. Commands in this
page run from `msm-re/msm-state`. The dashboard holds a live session to read
state, but it never sends gameplay requests.

## Finding your way around

The sidebar groups islands by family. Search for an island; **Enter** selects
the first match. Readiness badges count ready eggs, finished breedings and bakes.

The **Overview** page shows currencies, account-wide timers (ready now and
coming up), events and the sticker book.

An **Island** page shows that island's monsters, structures, breeding and
nursery slots, bakeries, mines, market and map.

**Refresh** fetches the latest state immediately; otherwise the session polls
in the background. **Activity** opens a log of the requests and pushes on the
game socket.

## Statues and vessels

Wublin and Celestial rows show lifecycle state and egg requirements. Internally,
the presence of `boxed_eggs` distinguishes a statue still accepting eggs from
an awakened one. A collection timestamp alone does not distinguish them.

Amber vessels do not report their fill inventory. The dashboard treats their
reported requirements as outstanding until completion removes the requirements.

## Market

The store card mirrors the in-game market for the island: it filters stock for
the island, player level, prerequisites and timed offers, and shows costs,
footprints, build times and whether each row is available. Amber Island sells
vessels instead of nursery eggs.

Mines use their catalog refill windows: the inspected regular Mine is
**12 hours**, and Mini Mines are **23 hours**. These are 5.7.0 catalog findings.

## Paironormal island modes

Paironormal rows include the fused entry and its Major/Minor components.
The inspected player state does not report the current mirror mode, so the
dashboard tracks it in browser local storage, defaulting to Major.

## Sticker book and events

The sticker book shows album/page progress, duplicates, pack currency, unopened
packs and rewards that are ready to claim in game.

Events include the current Encore, owned clubboxes, event currencies and timed
availability windows. Optional event and card catalogs provide readable names.
Raw state is available at `GET /api/raw` for local research.

## Map, animation and sound

The map uses original local game art, catalog scenes and entity rest poses.
Clicking it highlights a grid cell. Entity tooltips show position; warehouse
structures and hotel monsters are excluded. Missing monster rigs can use
portraits, while unresolved structures may be omitted.

The [animated preview](wasm-preview.md) and [song preview](song-preview.md) are
optional. The static map remains the default. Missing game assets, unsupported
rigs or preview load failures are reported with fallback diagnostics.

## For contributors

`liveSession.ts` owns the persistent connection, serialized refresh queue,
server-clock tracking and reconnect backoff. `viewModel.ts` computes readiness
and display state. `server.ts` and `dashboardHtml.ts` provide the HTTP
interface and UI.

See [the protocol reference](protocol.md) for wire types,
[terrain notes](terrain-preview.md) for ground tiles, and
[rig transforms](rig-transforms.md) for sprite alignment.
