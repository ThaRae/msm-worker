# PC protocol reference

This reference is for contributors working on authentication, binary framing
and state sync. It records observations from MSM PC **5.7.0**, not a
stable public API. Game or service updates will probably invalidate parts of it.

Start with the [setup guide](../README.md) for normal use or the
[dashboard guide](dashboard.md) for the interface. BBB means Big Blue Bubble;
SFS refers to the SmartFoxServer-style binary messages used by the game.
Addresses below refer to the inspected 5.7.0 executable.

## Authentication pipeline

The client connects in four stages:

1. **Steam ticket** — `GetAuthSessionTicket` via the game's
   `steam_api.dll`. The ticket embeds the steamid as
   `[accountId u32 LE][01 00 10 01]`.
2. **Auth** — `POST https://auth.bbbgame.net/auth/api/token`
   (msm_buildAuthTokenRequest @ 0x755A40). Form fields `g=27`,
   `u=<steamid>`, `p=<ticket hex>`, `t=steam`, device info... plus header
   `use-proper-json: true`. Returns `access_token` + `user_game_id`.
3. **Pregame** — `POST https://msmpc.bbbgame.net/pregame_setup.php` with
   the raw token in `Authorization` (no "Bearer"). Returns
   `serverIp = "tomcat|ssl|<host>[|port]"` parsed like
   `sfs_SFSTomcatClient_connect` @ 0xDAA720.
4. **Game socket** — `wss://<host>/msm/socket`. In the captured sessions, the gateway silently
   ignored connections unless the handshake carries **both** spellings of
   each custom header: `client-version` + `client_version`,
   `access-key` + `access_key`, plus the game's `User-Agent`
   (`MSMPC/5.7.0 (pc; 10.0.19045)`). The original research also inspected the game's TLS behavior;
   see `src/services/gameServer.ts` for this project's connection settings.

## Wire format (SmartFoxServer "tomcat" variant)

Everything is big-endian.

- Client -> server: `[i64 seq][u16 cmdLen][cmd][SFSObject]`. The seq
  starts at 0 for USER_LOGIN (`sfs_SFSTomcatClient_login` @ 0xDAABA0 —
  the SFSWriter ctor writes the seq prefix).
- Server -> client: `[u16 cmdLen][cmd][SFSObject]` — **no seq prefix**
  (verified by mitm; the seq-first interpretation can even misparse short
  frames, e.g. `CID` as `cid`).
- SFSObject: tag 18, u16 key count, then per entry u16 keyLen, key,
  value-tag + value (`sfs_SFSWriter_writeValue` @ 0xE72C20). Object keys
  serialize sorted (std::map). Strings are u16-length UTF-8. Longs are
  i64. Tags: 1 bool, 2 byte (1 byte), 3 short (u16 — writer case 3 /
  reader case 3 at 0xDA4F20; do NOT confuse with byte), 4 i32, 5 i64,
  6 f32, 7 f64, 8 string, 10 byte array (u32 length), 12 int array
  (u16 count + i32 each — the count is verified against the reader; a
  u32 count makes the server parse zero elements and silently no-op,
  which is how the first live `gs_open_card_packs` attempt failed),
  16 string array, 17 array, 18 object.

## Session flow

1. On connect the server pushes `CID {cid}` (command counter), then
   `USER_LOGIN {data:{session}, success, user}`, `game_settings`,
   `gs_initialized {bbb_id}` and one `client_keep_alive` (empty object).
2. Client sends `USER_LOGIN {user, password:"", zone:"MySingingMonsters",
   data:{...}}` (net_NetworkHandler_onConnected_doLogin @ 0xB432A0).
   `data` fields for a fresh session: `client_version`, `last_updated`
   (i64), `last_update_version`, `client_device="PCDevice"`, `client_os`,
   `client_platform="pc"`, `client_lang=""`, `raw_device_id`,
   `token`, `access_key`, `attempt_recovery=false`, `last_session_id=""`,
   `last_command_id=-1`, `attempt_reconnect=false`,
   `client_subplatform="steam"`.
3. Client-driven sync dance (captured from the live client): each request
   `{last_updated: 0}` gets a same-named response — `db_store_v2`,
   `db_scratch_offs`, `db_battle`, `db_attuner_gene`, `db_minigames`,
   `db_items`, `gs_quest`, `gs_timed_events`, `gs_rare_monster_data`,
   `gs_epic_monster_data`, `gs_monster_island_2_island_data`,
   `gs_cant_breed`, `gs_player` (the full account object), then
   `gs_process_unclaimed_purchases` (empty object). The game also sends
   `db_precheck {last_updated, precheck:[db names]}` first; it is only an
   optimization and can be omitted for a full fetch.
4. The server answers each request and follows it with
   `CID {cid: <processed count>}`. Trailing pushes like `gs_get_friends`
   arrive after the dance. Client must answer `keep_alive` (empty object)
   every 30s.

## State requests

msm-state only sends the login sync and the read requests below. Gameplay
commands (collecting, breeding, buying, selling and so on) are out of scope
for this project and are not documented here.

Every payload must use the exact value types the client sends. A missing or
mistyped field makes the server handler throw and the gateway close the
socket with `1011 SERVER_PROCESS_ERROR`.

- `gs_player`: `last_updated` **long** (0 for a full fetch). Answers the
  full account object (`player_object`), roughly 500 KB for a large account.
- `db_items`: `last_updated` **long**. A tiny response that always carries
  a fresh `server_time`, used to keep the local server clock in sync.
- `gs_timed_events`: no fields. Part of the login sync (sub_CAE520)
  and the source of the global event schedule, `timed_event_list`:
  `{id, event_type, event_id, start_date, end_date, data[]}`. The
  `Encore` type carries `data[0] = {encore_type, reward_track_id,
  rolls_over, label}` (live example: id 84679 "Encore - Baking",
  encore_type 2, reward track 4, rolls over). `CostumeAvailability`
  rows repeat per costume; anniversary sales repeat per entity.
- `gs_player_encore_state` (from the client Lua binding
  refreshPlayerEncoreState, sub_8A3EB0): no fields, answers
  `{current_encore_state: {event_id, total_points}}`. `total_points`
  is the same 0..1 fraction the client's encore bar shows.

Mines refill on a per-structure window from `db_structure`'s
`extra.time`: the regular Mine (and Plant Island's premium variant) is
**12 hours**, the Mini Mine everywhere else is **23 hours** (the
client's `mineTime` script call only exposes elapsed time since
`last_collection`). The dashboard shows a per-mine Ready badge and a
fills-in countdown from that window.

Responses reuse the request command name and carry `{success, ...}` (or
`{success:false, message}` on game-logic failures such as a full nursery).
