/**
 * Wiring tests for the MCP tool registry. They use a stub session so no
 * game connection is opened.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LiveSession } from '../liveSession.js';
import { createMcpHandlers } from './tools.js';

const stubSession = (now = Date.now()): LiveSession => ({
  getStatus: () => ({
    status: 'online',
    lastError: undefined,
    lastSyncAtMs: now - 500,
    authExpiresAtMs: now + 60_000,
    authFromCache: false,
    authStale: false,
  }),
  serverNow: () => now,
} as unknown as LiveSession);

test('the registry has unique names and every read tool', () => {
  const handlers = createMcpHandlers(stubSession());
  const names = handlers.tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const tool of ['msm_status', 'msm_get_guide', 'msm_overview', 'msm_get_island', 'msm_get_raw_player']) {
    assert.ok(names.includes(tool), tool);
  }
});

test('the registry exposes no gameplay tools', () => {
  const handlers = createMcpHandlers(stubSession());
  for (const tool of handlers.tools) {
    assert.doesNotMatch(tool.name, /collect|sell|buy|breed|hatch|feed|zap|bake|housekeeping/, tool.name);
  }
});

test('every tool declares an object input schema', () => {
  const handlers = createMcpHandlers(stubSession());
  for (const tool of handlers.tools) {
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal(typeof tool.inputSchema.properties, 'object', tool.name);
    assert.ok(tool.description.length > 0, tool.name);
  }
});

test('msm_status answers from the stub without a game call', async () => {
  const handlers = createMcpHandlers(stubSession(1_000_000));
  const result = await handlers.callTool('msm_status', {});
  assert.equal(result.isError, undefined);
  const text = result.content[0]?.text ?? '';
  const parsed = JSON.parse(text) as { status: string; serverNowMs: number };
  assert.equal(parsed.status, 'online');
  assert.equal(parsed.serverNowMs, 1_000_000);
  assert.equal(result.structuredContent?.status, 'online');
});

test('msm_get_guide returns the reading guide', async () => {
  const handlers = createMcpHandlers(stubSession());
  const result = await handlers.callTool('msm_get_guide', {});
  assert.equal(result.isError, undefined);
  const parsed = JSON.parse(result.content[0]?.text ?? '{}') as { guide: string };
  assert.match(parsed.guide, /My Singing Monsters/);
  assert.match(parsed.guide, /read-only/);
});

test('resources list and read back', async () => {
  const handlers = createMcpHandlers(stubSession());
  assert.deepEqual(handlers.resources?.map((resource) => resource.uri), ['msm://guide']);
  assert.ok(handlers.readResource !== undefined);
  const guide = await handlers.readResource('msm://guide');
  assert.match(guide.text, /Rules/);
});

test('prompts include the summarize-msm starter', async () => {
  const handlers = createMcpHandlers(stubSession());
  assert.deepEqual(handlers.prompts?.map((prompt) => prompt.name), ['summarize-msm']);
  assert.ok(handlers.getPrompt !== undefined);
  const prompt = await handlers.getPrompt('summarize-msm', {});
  assert.equal(prompt.messages[0]?.role, 'user');
  assert.match(prompt.messages[0]?.content.text ?? '', /msm_overview/);
});

test('an unknown tool name is rejected', async () => {
  const handlers = createMcpHandlers(stubSession());
  await assert.rejects(() => handlers.callTool('msm_not_a_tool', {}), /unknown tool/);
});
