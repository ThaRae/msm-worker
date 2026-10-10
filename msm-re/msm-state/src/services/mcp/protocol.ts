/**
 * A dependency-free Model Context Protocol (MCP) server over stdio.
 *
 * MCP is JSON-RPC 2.0. Its stdio transport frames one JSON message per
 * line (messages MUST NOT contain embedded newlines), so a node:readline
 * interface is the whole transport. Implementing it here keeps the tool
 * installable with no network access and no extra runtime dependency,
 * matching the rest of msm-state (ws + commander only).
 *
 * Supported revisions: the server echoes whichever revision the client
 * asks for when it is one we know, otherwise it answers with the latest.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18
 */

import { createInterface } from 'node:readline';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
export type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];
export const LATEST_PROTOCOL_VERSION: ProtocolVersion = '2025-06-18';

export type JsonObject = Record<string, unknown>;
export type JsonRpcId = string | number | null;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type ToolInputSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export type McpToolDefinition = {
  name: string;
  title?: string;
  description: string;
  inputSchema: ToolInputSchema;
};

export type McpTextContent = { type: 'text'; text: string };

/** Result of tools/call. `structuredContent` mirrors the text as JSON. */
export type McpToolResult = {
  content: McpTextContent[];
  structuredContent?: JsonObject;
  isError?: boolean;
};

export type McpResourceDefinition = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType: string;
};

export type McpResourceContents = { uri: string; mimeType: string; text: string };

export type McpPromptArgument = { name: string; description?: string; required?: boolean };

export type McpPromptDefinition = {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
};

export type McpPromptMessage = { role: 'user' | 'assistant'; content: McpTextContent };
export type McpPromptResult = { description?: string; messages: McpPromptMessage[] };

/** Everything the protocol layer needs from the game-tool layer. */
export type McpServerHandlers = {
  serverName: string;
  serverVersion: string;
  /** Free-form guidance surfaced to the model by the initialize response. */
  instructions?: string;
  tools: McpToolDefinition[];
  callTool: (name: string, args: JsonObject) => Promise<McpToolResult>;
  resources?: McpResourceDefinition[];
  readResource?: (uri: string) => Promise<McpResourceContents>;
  prompts?: McpPromptDefinition[];
  getPrompt?: (name: string, args: JsonObject) => Promise<McpPromptResult>;
};

/** A JSON-RPC error we intend to send verbatim. */
export class McpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'McpRpcError';
  }
}

type JsonRpcErrorObject = { code: number; message: string; data?: unknown };

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
};

/**
 * Dispatches JSON-RPC requests. It is deliberately decoupled from stdin
 * and stdout (the writer is injected) so tests can drive it directly.
 */
export class McpServer {
  constructor(
    private readonly handlers: McpServerHandlers,
    private readonly writeLine: (line: string) => void,
  ) {}

  /** Parse and handle one newline-delimited message. */
  async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed === '') return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.writeLine(JSON.stringify(this.errorResponse(null, -32700, 'Parse error')));
      return;
    }
    const response = await this.dispatch(message);
    if (response !== undefined) this.writeLine(JSON.stringify(response));
  }

  /** Route one decoded message; returns the response, or undefined for notifications. */
  async dispatch(message: unknown): Promise<JsonRpcResponse | undefined> {
    if (!isJsonObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      return this.errorResponse(null, -32600, 'Invalid Request');
    }
    const rawId = message.id;
    const id: JsonRpcId =
      typeof rawId === 'string' || typeof rawId === 'number' || rawId === null ? rawId : null;
    const isNotification = rawId === undefined;
    const params = isJsonObject(message.params) ? message.params : {};
    try {
      const result = await this.route(message.method, params);
      if (isNotification) return undefined;
      return { jsonrpc: '2.0', id, result };
    } catch (error) {
      if (isNotification) return undefined;
      const rpc = error instanceof McpRpcError
        ? error
        : new McpRpcError(-32603, error instanceof Error ? error.message : String(error));
      const errorObject: JsonRpcErrorObject = { code: rpc.code, message: rpc.message };
      if (rpc.data !== undefined) errorObject.data = rpc.data;
      return { jsonrpc: '2.0', id, error: errorObject };
    }
  }

  private errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  private async route(method: string, params: JsonObject): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.initialize(params);
      case 'ping':
      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'logging/setLevel':
        return {};
      case 'tools/list':
        return { tools: this.handlers.tools };
      case 'tools/call':
        return this.callTool(params);
      case 'resources/list':
        return { resources: this.handlers.resources ?? [] };
      case 'resources/read':
        return this.readResource(params);
      case 'prompts/list':
        return { prompts: this.handlers.prompts ?? [] };
      case 'prompts/get':
        return this.getPrompt(params);
      default:
        throw new McpRpcError(-32601, `Method not found: ${method}`);
    }
  }

  private initialize(params: JsonObject): JsonObject {
    const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : undefined;
    const protocolVersion =
      requested !== undefined && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;
    const capabilities: JsonObject = { tools: { listChanged: false } };
    if (this.handlers.resources !== undefined) {
      capabilities.resources = { subscribe: false, listChanged: false };
    }
    if (this.handlers.prompts !== undefined) {
      capabilities.prompts = { listChanged: false };
    }
    const result: JsonObject = {
      protocolVersion,
      capabilities,
      serverInfo: { name: this.handlers.serverName, version: this.handlers.serverVersion },
    };
    if (this.handlers.instructions !== undefined) result.instructions = this.handlers.instructions;
    return result;
  }

  private async callTool(params: JsonObject): Promise<McpToolResult> {
    const name = params.name;
    if (typeof name !== 'string') {
      throw new McpRpcError(-32602, 'tools/call requires a string "name"');
    }
    if (!this.handlers.tools.some((tool) => tool.name === name)) {
      throw new McpRpcError(-32602, `Unknown tool: ${name}`);
    }
    const args = isJsonObject(params.arguments) ? params.arguments : {};
    try {
      return await this.handlers.callTool(name, args);
    } catch (error) {
      // Tool execution failures are results, not protocol errors, so the
      // model can read the message and try something else.
      const text = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
    }
  }

  private async readResource(params: JsonObject): Promise<{ contents: McpResourceContents[] }> {
    const uri = params.uri;
    if (typeof uri !== 'string') {
      throw new McpRpcError(-32602, 'resources/read requires a string "uri"');
    }
    if (this.handlers.readResource === undefined) {
      throw new McpRpcError(-32601, 'Resources are not supported');
    }
    if (!(this.handlers.resources ?? []).some((resource) => resource.uri === uri)) {
      throw new McpRpcError(-32602, `Unknown resource: ${uri}`);
    }
    return { contents: [await this.handlers.readResource(uri)] };
  }

  private async getPrompt(params: JsonObject): Promise<McpPromptResult> {
    const name = params.name;
    if (typeof name !== 'string') {
      throw new McpRpcError(-32602, 'prompts/get requires a string "name"');
    }
    if (this.handlers.getPrompt === undefined || !(this.handlers.prompts ?? []).some((prompt) => prompt.name === name)) {
      throw new McpRpcError(-32602, `Unknown prompt: ${name}`);
    }
    const args = isJsonObject(params.arguments) ? params.arguments : {};
    return this.handlers.getPrompt(name, args);
  }
}

/**
 * Serve an MCP server on stdio until stdin closes. Nothing else may write
 * to stdout while this is running: the channel carries protocol frames
 * only, which is why the caller redirects console.log to stderr.
 */
export function serveMcpStdio(handlers: McpServerHandlers): { server: McpServer; close: () => void } {
  const server = new McpServer(handlers, (line) => {
    process.stdout.write(`${line}\n`);
  });
  const readline = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false });
  const pending = new Set<Promise<void>>();
  readline.on('line', (line) => {
    // Track in-flight messages so a client that closes stdin mid-call
    // still receives the response before the process exits.
    const task: Promise<void> = server.handleLine(line).finally(() => {
      pending.delete(task);
    });
    pending.add(task);
  });
  // When the client closes the pipe the process should not linger on the
  // game socket: drain whatever is in flight (bounded) and exit cleanly.
  readline.on('close', () => {
    void (async () => {
      await Promise.race([
        Promise.all([...pending]),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
      process.exit(0);
    })();
  });
  return { server, close: () => readline.close() };
}
