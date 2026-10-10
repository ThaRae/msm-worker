/**
 * Protocol-level tests for the dependency-free MCP server: version
 * negotiation, tool listing/calling, resource and prompt routing, and the
 * JSON-RPC error paths a client relies on.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer, type JsonObject, type McpServerHandlers, type McpToolResult } from './protocol.js';

type Sent = Record<string, unknown>;

function harness(overrides: Partial<McpServerHandlers> = {}): {
  server: McpServer;
  send: (message: unknown) => Promise<Sent | undefined>;
  lines: string[];
} {
  const lines: string[] = [];
  const handlers: McpServerHandlers = {
    serverName: 'test-server',
    serverVersion: '1.2.3',
    instructions: 'read the guide',
    tools: [
      {
        name: 'echo',
        title: 'Echo',
        description: 'Echo the arguments',
        inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      },
    ],
    callTool: async (_name, args): Promise<McpToolResult> => ({
      content: [{ type: 'text', text: JSON.stringify(args) }],
      structuredContent: args,
    }),
    ...overrides,
  };
  const server = new McpServer(handlers, (line) => lines.push(line));
  const send = async (message: unknown): Promise<Sent | undefined> => {
    const before = lines.length;
    await server.handleLine(JSON.stringify(message));
    if (lines.length === before) return undefined;
    const last = lines[lines.length - 1];
    assert.ok(last !== undefined);
    return JSON.parse(last) as Sent;
  };
  return { server, send, lines };
}

test('initialize echoes a supported protocol version and advertises tools', async () => {
  const { send } = harness();
  const response = await send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'client', version: '1' } },
  });
  const result = response?.result as Sent;
  assert.equal(result.protocolVersion, '2024-11-05');
  assert.equal(result.instructions, 'read the guide');
  assert.deepEqual(result.serverInfo, { name: 'test-server', version: '1.2.3' });
  assert.deepEqual(result.capabilities, { tools: { listChanged: false } });
});

test('initialize answers with the latest revision for an unknown one', async () => {
  const { send } = harness();
  const response = await send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal((response?.result as Sent).protocolVersion, '2025-06-18');
});

test('notifications produce no response', async () => {
  const { server, lines } = harness();
  await server.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  assert.equal(lines.length, 0);
});

test('tools/list returns the registered tools', async () => {
  const { send } = harness();
  const response = await send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const tools = (response?.result as Sent).tools as Array<{ name: string }>;
  assert.deepEqual(tools.map((tool) => tool.name), ['echo']);
});

test('tools/call returns text and structured content', async () => {
  const { send } = harness();
  const response = await send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'echo', arguments: { value: 'hi' } } });
  const result = response?.result as McpToolResult;
  assert.equal(result.isError, undefined);
  assert.equal(result.content[0]?.text, '{"value":"hi"}');
  assert.deepEqual(result.structuredContent, { value: 'hi' });
});

test('a handler exception becomes an isError result, not a protocol error', async () => {
  const { send } = harness({
    callTool: async () => {
      throw new Error('nursery is full');
    },
  });
  const response = await send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'echo', arguments: {} } });
  const result = response?.result as McpToolResult;
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /nursery is full/);
  assert.equal(response?.error, undefined);
});

test('calling an unknown tool is an invalid-params error', async () => {
  const { send } = harness();
  const response = await send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } });
  assert.equal((response?.error as Sent).code, -32602);
});

test('unknown methods return method-not-found', async () => {
  const { send } = harness();
  const response = await send({ jsonrpc: '2.0', id: 7, method: 'does/not/exist' });
  assert.equal((response?.error as Sent).code, -32601);
});

test('invalid JSON returns a parse error with a null id', async () => {
  const { server, lines } = harness();
  await server.handleLine('{not json');
  const response = JSON.parse(lines[0] ?? '{}') as Sent;
  assert.equal((response.error as Sent).code, -32700);
  assert.equal(response.id, null);
});

test('non-JSON-RPC messages are rejected', async () => {
  const { send } = harness();
  const response = await send({ hello: 'world' });
  assert.equal((response?.error as Sent).code, -32600);
});

test('resources are listed and read', async () => {
  const resources = [{ uri: 'msm://guide', name: 'guide', mimeType: 'text/markdown' }];
  const { send } = harness({
    resources,
    readResource: async (uri) => ({ uri, mimeType: 'text/markdown', text: 'guide body' }),
  });
  const listed = await send({ jsonrpc: '2.0', id: 8, method: 'resources/list' });
  assert.equal(((listed?.result as Sent).resources as unknown[]).length, 1);
  assert.ok(((listed?.result as Sent).capabilities === undefined));

  const read = await send({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'msm://guide' } });
  const contents = (read?.result as { contents: Array<{ text: string }> }).contents;
  assert.equal(contents[0]?.text, 'guide body');

  const missing = await send({ jsonrpc: '2.0', id: 10, method: 'resources/read', params: { uri: 'msm://nope' } });
  assert.equal((missing?.error as Sent).code, -32602);
});

test('prompts route through getPrompt', async () => {
  const { send } = harness({
    prompts: [{ name: 'play-msm', description: 'play' }],
    getPrompt: async (name): Promise<{ messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> }> => ({
      messages: [{ role: 'user', content: { type: 'text', text: name } }],
    }),
  });
  const response = await send({ jsonrpc: '2.0', id: 11, method: 'prompts/get', params: { name: 'play-msm', arguments: {} } });
  const messages = (response?.result as { messages: Array<{ content: { text: string } }> }).messages;
  assert.equal(messages[0]?.content.text, 'play-msm');
});

test('ping is answered', async () => {
  const { send } = harness();
  const response = await send({ jsonrpc: '2.0', id: 12, method: 'ping' });
  assert.deepEqual(response?.result, {});
});

test('tool arguments default to an empty object', async () => {
  const seen: JsonObject[] = [];
  const { send } = harness({
    callTool: async (_name, args): Promise<McpToolResult> => {
      seen.push(args);
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  });
  await send({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'echo' } });
  assert.deepEqual(seen, [{}]);
});
