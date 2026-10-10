/**
 * MCP tool registry for the live game session.
 *
 * Every tool is read-only: tools return compact projections of the synced
 * account state (see stateView.ts). Nothing here sends gameplay requests.
 */

import type { LiveSession } from '../liveSession.js';
import { MCP_GUIDE, MCP_INSTRUCTIONS, MCP_SERVER_VERSION } from './guide.js';
import {
  getByPath,
  projectCardAlbum,
  projectEvents,
  projectIslandDetail,
  projectIslandSummary,
  projectOverview,
  projectStatus,
  projectStore,
  StateView,
} from './stateView.js';
import type {
  JsonObject,
  McpPromptDefinition,
  McpPromptResult,
  McpResourceDefinition,
  McpServerHandlers,
  McpToolDefinition,
  McpToolResult,
} from './protocol.js';

export const MCP_SERVER_NAME = 'msm-state';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const REFRESH_PROPERTY = {
  type: 'boolean',
  description:
    'Force a fresh gs_player fetch from the game server before answering (default false; the session keeps state fresh in the background).',
} as const;

const ISLAND_ID_PROPERTY = {
  anyOf: [{ type: 'string', pattern: '^-?\\d+$' }, { type: 'integer' }],
  description: 'Island instance id (user_island_id) from msm_list_islands.',
} as const;

const READ_TOOLS: McpToolDefinition[] = [
  {
    name: 'msm_status',
    title: 'Session status',
    description:
      'Connection, auth-token and last-sync status of the live game session. Use it to check that the session is online.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'msm_get_guide',
    title: 'Read the guide',
    description:
      'Return the reading guide for this server. Read this once at the start.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'msm_overview',
    title: 'Account overview',
    description:
      'Currencies, headline counts, everything ready to collect/hatch/finish, the current encore event, sticker-book progress and bakery recipes. The best first call; use msm_list_islands for per-island rows.',
    inputSchema: { type: 'object', properties: { refresh: REFRESH_PROPERTY }, additionalProperties: false },
  },
  {
    name: 'msm_list_islands',
    title: 'List islands',
    description: 'One compact row per island (id, name, family, counts of monsters/eggs/breedings/mines/bakes).',
    inputSchema: { type: 'object', properties: { refresh: REFRESH_PROPERTY }, additionalProperties: false },
  },
  {
    name: 'msm_get_island',
    title: 'Island detail',
    description:
      'Full detail for one island: monster rows (level, happiness, staleness, statue zap needs), structures, breedings, eggs and bakes. The market is omitted unless you ask for the "store" section. Monster lists are paged with limit/offset. Dormant Wublin statues set boxFillKnown false — missing boxFilled is not zero zapped eggs. Dormant Wublin/Celestial rows also carry boxFillMs and, when egg_timer_start is present, boxExpiresInMs / boxExpiresAtMs.',
    inputSchema: {
      type: 'object',
      properties: {
        userIslandId: ISLAND_ID_PROPERTY,
        sections: {
          type: 'array',
          items: { type: 'string', enum: ['monsters', 'structures', 'breeding', 'eggs', 'baking', 'store'] },
          description: 'Sections to return; defaults to everything except store.',
        },
        monsterFilter: { type: 'string', description: 'Case-insensitive substring match on a monster\'s species or nickname.' },
        limit: { type: 'integer', description: 'Max rows per section (default all; use for large islands).' },
        offset: { type: 'integer', description: 'Row offset per section (default 0).' },
        refresh: REFRESH_PROPERTY,
      },
      required: ['userIslandId'],
      additionalProperties: false,
    },
  },
  {
    name: 'msm_get_store',
    title: 'Island market',
    description:
      'The market as one island sees it: structures/decorations (catalog id, cost, size, build time, requirements) and monsters (costs, hatch time, beds, limited-time windows). Pass purchasableOnly to hide rows gated by level or prerequisites.',
    inputSchema: {
      type: 'object',
      properties: {
        userIslandId: ISLAND_ID_PROPERTY,
        purchasableOnly: { type: 'boolean', description: 'Only rows the player can buy right now (default false).' },
        limit: { type: 'integer', description: 'Max rows per list.' },
        offset: { type: 'integer', description: 'Row offset per list (default 0).' },
        refresh: REFRESH_PROPERTY,
      },
      required: ['userIslandId'],
      additionalProperties: false,
    },
  },
  {
    name: 'msm_get_card_album',
    title: 'Sticker book',
    description:
      'Sticker-book progress: card currency, collected/duplicate counts, per-page progress and claimable rewards, unopened packs, and the packs for sale.',
    inputSchema: { type: 'object', properties: { refresh: REFRESH_PROPERTY }, additionalProperties: false },
  },
  {
    name: 'msm_get_events',
    title: 'Events and clubboxes',
    description: 'Current encore event with progress, owned clubboxes and hype, tokens, and the global timed-event schedule.',
    inputSchema: { type: 'object', properties: { refresh: REFRESH_PROPERTY }, additionalProperties: false },
  },
  {
    name: 'msm_get_raw_player',
    title: 'Raw player field',
    description:
      'Read any field of the raw gs_player object that the typed views do not surface, via a dotted path (e.g. "mailbox", "islands.0.monsters", "achievements"). Large values are returned as a preview; narrow the path.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Dotted path into the player object; empty returns the whole object.' },
        maxChars: { type: 'integer', description: 'Max serialized characters before a preview is returned (default 200000).' },
        refresh: REFRESH_PROPERTY,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'msm_refresh',
    title: 'Force a state refresh',
    description: 'Re-fetch the full player state from the server now and report status plus headline counts.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function normalizeJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === 'object' && value !== null) {
    const out: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) out[key] = normalizeJson(entry);
    return out;
  }
  return value;
}

function jsonResult(value: unknown): McpToolResult {
  const safe = normalizeJson(value);
  const text = JSON.stringify(safe, null, 2) ?? 'null';
  const result: McpToolResult = { content: [{ type: 'text', text }] };
  if (typeof safe === 'object' && safe !== null && !Array.isArray(safe)) {
    result.structuredContent = safe as JsonObject;
  }
  return result;
}

const argBool = (value: unknown, fallback = false): boolean => (typeof value === 'boolean' ? value : fallback);
const argInt = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return undefined;
};
const argString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const idText = (value: unknown): string | undefined => {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isInteger(value)) return String(value);
  return undefined;
};

export function createMcpHandlers(session: LiveSession): McpServerHandlers {
  const view = new StateView(session);
  const tools = [...READ_TOOLS];

  const callTool = async (name: string, args: JsonObject): Promise<McpToolResult> => {
    const refresh = argBool(args.refresh, false);
    switch (name) {
      case 'msm_status':
        return jsonResult(projectStatus(session));
      case 'msm_get_guide':
        return jsonResult({ guide: MCP_GUIDE });
      case 'msm_refresh': {
        await view.api({ refresh: true });
        const api = await view.api();
        return jsonResult({ status: projectStatus(session), summary: api.summary });
      }
      case 'msm_overview': {
        const api = await view.api({ refresh });
        return jsonResult({ status: projectStatus(session), ...projectOverview(api), events: projectEvents(api, session.serverNow()) });
      }
      case 'msm_list_islands': {
        const api = await view.api({ refresh });
        return jsonResult({ islands: api.islands.map(projectIslandSummary) });
      }
      case 'msm_get_island': {
        const userIslandId = idText(args.userIslandId);
        if (userIslandId === undefined) throw new Error('msm_get_island requires "userIslandId" (call msm_list_islands first)');
        const api = await view.api({ refresh });
        const island = api.islands.find((entry) => entry.userIslandId === userIslandId);
        if (island === undefined) throw new Error(`unknown island "${userIslandId}"; call msm_list_islands`);
        const sections = Array.isArray(args.sections)
          ? args.sections.filter((section): section is string => typeof section === 'string')
          : undefined;
        return jsonResult(projectIslandDetail(island, {
          sections,
          monsterFilter: argString(args.monsterFilter),
          limit: argInt(args.limit),
          offset: argInt(args.offset),
        }));
      }
      case 'msm_get_store': {
        const userIslandId = idText(args.userIslandId);
        if (userIslandId === undefined) throw new Error('msm_get_store requires "userIslandId"');
        const api = await view.api({ refresh });
        const island = api.islands.find((entry) => entry.userIslandId === userIslandId);
        if (island === undefined) throw new Error(`unknown island "${userIslandId}"; call msm_list_islands`);
        return jsonResult(projectStore(island, {
          purchasableOnly: argBool(args.purchasableOnly, false),
          limit: argInt(args.limit),
          offset: argInt(args.offset),
        }));
      }
      case 'msm_get_card_album': {
        const api = await view.api({ refresh });
        return jsonResult({ cardAlbum: api.cardAlbum === null ? null : projectCardAlbum(api.cardAlbum) });
      }
      case 'msm_get_events': {
        const api = await view.api({ refresh });
        return jsonResult(projectEvents(api, session.serverNow()));
      }
      case 'msm_get_raw_player': {
        const path = argString(args.path) ?? '';
        const maxChars = argInt(args.maxChars) ?? 200_000;
        if (refresh) await view.api({ refresh: true });
        else await view.api();
        const player = session.getPlayerObject();
        if (player === undefined) throw new Error('no player state loaded yet');
        const value = getByPath(player, path);
        const serialized = JSON.stringify(normalizeJson(value), null, 2) ?? 'null';
        if (serialized.length > maxChars) {
          return jsonResult({
            path,
            truncated: true,
            chars: serialized.length,
            maxChars,
            preview: serialized.slice(0, maxChars),
          });
        }
        return jsonResult({ path, truncated: false, value });
      }
      default:
        throw new Error(`unknown tool "${name}"`);
    }
  };

  const resources: McpResourceDefinition[] = [
    {
      uri: 'msm://guide',
      name: 'msm-guide',
      title: 'msm-state reading guide',
      description: 'How to read account state with the read-only tools.',
      mimeType: 'text/markdown',
    },
  ];

  const readResource = async (uri: string): Promise<{ uri: string; mimeType: string; text: string }> => {
    const text = MCP_GUIDE;
    return { uri, mimeType: 'text/markdown', text };
  };

  const prompts: McpPromptDefinition[] = [
    {
      name: 'summarize-msm',
      title: 'Summarize the account',
      description: 'Prime the model with the reading guide, then ask for an account summary.',
    },
  ];

  const getPrompt = async (): Promise<McpPromptResult> => ({
    description: 'Summarize the connected My Singing Monsters account.',
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${MCP_GUIDE}\n\nCall msm_overview and msm_list_islands, then summarize the account and anything that is ready in game.`,
        },
      },
    ],
  });

  return {
    serverName: MCP_SERVER_NAME,
    serverVersion: MCP_SERVER_VERSION,
    instructions: MCP_INSTRUCTIONS,
    tools,
    callTool,
    resources,
    readResource,
    prompts,
    getPrompt,
  };
}
