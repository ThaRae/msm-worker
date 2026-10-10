/**
 * Model-facing documentation. MCP_INSTRUCTIONS is short and always sent
 * in the initialize response; MCP_GUIDE is the full resource the model can
 * read on demand. The wire-level reversing notes stay in docs/protocol.md.
 */

export const MCP_SERVER_VERSION = '0.2.0';

export const MCP_INSTRUCTIONS = [
  'Read-only connection to a My Singing Monsters (Steam) account. Read msm://guide first.',
  'Start with msm_overview (currencies, headline counts, what is ready), then msm_list_islands / msm_get_island.',
  'Every id (userMonsterId, userEggId, userIslandId, userStructureId, ...) is the string id from the state tools.',
  'This server never sends gameplay requests; it only reads the state the game server pushes.',
].join('\n');

export const MCP_GUIDE = `# Reading My Singing Monsters state with the msm-state MCP server

You are connected to a My Singing Monsters (Steam, app 1419170) account in
**read-only** mode. Every value comes from the state BBB's game server pushes
after login; this server never sends gameplay requests.

## Rules

1. **Start broad.** Call \`msm_overview\` first, then \`msm_list_islands\`
   and \`msm_get_island\` for the island you care about. Never guess an id.
2. **Ids are strings.** \`userMonsterId\`, \`userEggId\`, \`userBreedingId\`,
   \`userStructureId\`, \`userBakingId\` and \`userIslandId\` are opaque string
   ids from the state (e.g. \"386\"). \`structureId\`, \`monsterId\`, \`foodId\`
   and \`storeItemId\` are catalog integer ids.
3. **One session only.** Holding this connection takes over the game session
   from a running client. A dropped socket reconnects automatically.
4. **Background refresh.** State refreshes on a timer; pass \`refresh: true\`
   or call \`msm_refresh\` when you need the latest values.

## Ids and islands

- \`userIslandId\` identifies one of the account's islands; \`islandVariantId\` /
  \`islandTypeId\` identify its kind (Mirror variants are variant ids 101+).
- Monster and structure ids are only unique **within an island**, but the
  state tools mark each row with its island.

## Reading statue rows

Dormant Wublins and Amber vessels do **not** report how many eggs are already
inside (\`boxFillKnown: false\` and no \`boxFilled\`), so an absent fill is not
"zero zapped". Celestials do ship boxed ids, so their \`boxFilled\` is real.
Dormant Wublins and Celestials expire: \`boxExpiresInMs\` / \`boxExpiresAtMs\`
count down from \`egg_timer_start\` plus the catalog \`time_to_fill_sec\`
window (\`boxFillMs\`). If the start is missing from state, only the window
length is present.

## Tools

- \`msm_overview\`: currencies, counts, everything ready, current events.
- \`msm_list_islands\` / \`msm_get_island\`: per-island monsters, structures,
  breedings, eggs and bakes.
- \`msm_get_store\`: the island's market as the client would show it.
- \`msm_get_card_album\`: sticker-book progress.
- \`msm_get_events\`: timed events and encores.
- \`msm_get_raw_player\`: any field the typed views do not surface yet.
`;
