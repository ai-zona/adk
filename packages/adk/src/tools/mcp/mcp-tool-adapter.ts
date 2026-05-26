// ──────────────────────────────────────────────────────
// ADK MCP Tool Adapter
// ──────────────────────────────────────────────────────
// Adapts MCP tools into ADK ToolDef[] format.
// Wraps @aizona/mcp-bridge when available, or connects
// directly to MCP servers via the lightweight connector.
// ──────────────────────────────────────────────────────

import type { JsonSchema } from "../../types/agent";
import type { ToolContext, ToolDef } from "../../types/tool";

/** MCP transport type */
export type MCPTransport = "stdio" | "sse" | "streamable-http";

/** MCP auth configuration */
export interface MCPAuthConfig {
  type: "bearer" | "basic" | "api-key";
  token?: string;
  username?: string;
  password?: string;
  apiKey?: string;
  headerName?: string;
}

/** MCP server connection config */
export interface MCPServerConfig {
  /** Server URL or command (for stdio) */
  serverUrl: string;
  /** Transport type */
  transport: MCPTransport;
  /** Auth config (optional) */
  authConfig?: MCPAuthConfig;
  /** Filter function to select which tools to expose */
  toolFilter?: (tool: MCPToolInfo) => boolean;
  /** Timeout for tool calls in ms */
  timeoutMs?: number;
  /** Specific tool names to load (name-based filter) */
  toolNames?: string[];
  /** Filter by category metadata */
  categories?: string[];
  /** Cap total tools returned */
  maxTools?: number;
}

/** MCP tool information (from server) */
export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Optional category metadata */
  category?: string;
  /** Optional tags */
  tags?: string[];
}

/** MCP connection state */
interface MCPConnection {
  config: MCPServerConfig;
  tools: MCPToolInfo[];
  connected: boolean;
}

/**
 * Connect to an MCP server and return its tools as ToolDef[].
 *
 * This is a lightweight adapter that converts MCP tool definitions
 * to ADK ToolDef format. For full MCP bridge features (rate limiting,
 * circuit breaking, output sanitization), use @aizona/mcp-bridge directly.
 */
export async function mcpServerTools(config: MCPServerConfig): Promise<ToolDef[]> {
  const connector = new MCPServerConnector(config);
  let tools = await connector.discover();

  // Apply name-based filter from config
  if (config.toolNames && config.toolNames.length > 0) {
    const nameSet = new Set(config.toolNames);
    tools = tools.filter((t) => nameSet.has(t.name));
  }

  // Apply category filter from config
  if (config.categories && config.categories.length > 0) {
    const catSet = new Set(config.categories);
    tools = tools.filter((t) => t.category && catSet.has(t.category));
  }

  // Apply max tools cap
  if (config.maxTools && config.maxTools > 0) {
    tools = tools.slice(0, config.maxTools);
  }

  return tools.map((tool) => connector.toToolDef(tool));
}

/**
 * Discover tool metadata from an MCP server without creating ToolDefs.
 * Useful for browsing available tools before selecting specific ones.
 */
export async function discoverMCPTools(config: MCPServerConfig): Promise<MCPToolInfo[]> {
  const connector = new MCPServerConnector(config);
  return connector.discover();
}

/**
 * Load only specific named tools from an MCP server.
 * Combines discovery with name-based selection in one call.
 */
export async function mcpSelectTools(
  config: MCPServerConfig,
  toolNames: string[],
): Promise<ToolDef[]> {
  const connector = new MCPServerConnector(config);
  const allTools = await connector.discover();
  return connector.selectTools(allTools, toolNames);
}

/**
 * MCPServerConnector — lightweight connector for MCP servers.
 * Handles discovery and invocation.
 */
export class MCPServerConnector {
  private config: MCPServerConfig;
  private connection: MCPConnection;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.connection = {
      config,
      tools: [],
      connected: false,
    };
  }

  /** Discover tools from the MCP server */
  async discover(): Promise<MCPToolInfo[]> {
    if (this.config.transport === "stdio") {
      return this.discoverViaStdio();
    }
    return this.discoverViaHttp();
  }

  /** Convert an MCP tool to an ADK ToolDef */
  toToolDef(tool: MCPToolInfo): ToolDef {
    const config = this.config;

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      metadata: {
        source: "mcp",
        serverUrl: config.serverUrl,
        transport: config.transport,
      },
      execute: async (input: unknown, _ctx: ToolContext) => {
        return this.invokeTool(tool.name, input);
      },
    };
  }

  /** Discover tool metadata without creating ToolDefs */
  async discoverMetadata(): Promise<MCPToolInfo[]> {
    return this.discover();
  }

  /** Create ToolDefs for only the named subset of discovered tools */
  selectTools(discovered: MCPToolInfo[], names: string[]): ToolDef[] {
    const nameSet = new Set(names);
    return discovered.filter((t) => nameSet.has(t.name)).map((t) => this.toToolDef(t));
  }

  /** Invoke a tool on the MCP server */
  async invokeTool(toolName: string, input: unknown): Promise<unknown> {
    if (this.config.transport === "stdio") {
      return this.invokeViaStdio(toolName, input);
    }
    return this.invokeViaHttp(toolName, input);
  }

  /** Discover tools via HTTP (SSE or streamable-http) */
  private async discoverViaHttp(): Promise<MCPToolInfo[]> {
    const url = `${this.config.serverUrl}/tools/list`;
    const headers = this.buildHeaders();

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
      signal: this.config.timeoutMs ? AbortSignal.timeout(this.config.timeoutMs) : undefined,
    });

    if (!response.ok) {
      throw new Error(`MCP server error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      result?: { tools?: MCPToolInfo[] };
    };
    const tools = data.result?.tools ?? [];

    // Apply filter
    const filtered = this.config.toolFilter ? tools.filter(this.config.toolFilter) : tools;

    this.connection.tools = filtered;
    this.connection.connected = true;

    return filtered;
  }

  /** Invoke a tool via HTTP */
  private async invokeViaHttp(toolName: string, input: unknown): Promise<unknown> {
    const url = `${this.config.serverUrl}/tools/call`;
    const headers = this.buildHeaders();

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: toolName, arguments: input },
        id: Date.now(),
      }),
      signal: this.config.timeoutMs ? AbortSignal.timeout(this.config.timeoutMs) : undefined,
    });

    if (!response.ok) {
      throw new Error(`MCP tool call failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      result?: { content?: unknown[] };
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`MCP tool error: ${data.error.message}`);
    }

    // Extract text content from MCP response
    const content = data.result?.content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as { type?: string; text?: string };
      if (first.type === "text" && first.text) {
        return first.text;
      }
      return content;
    }

    return data.result;
  }

  /** Discover tools via stdio (placeholder — requires child_process) */
  private async discoverViaStdio(): Promise<MCPToolInfo[]> {
    // Stdio transport requires spawning a process.
    // In a browser/edge environment, this falls back to empty.
    // Full stdio support is available via @aizona/mcp-bridge.
    throw new Error(
      "Stdio transport requires @aizona/mcp-bridge or Node.js child_process. " +
        "Use transport: 'sse' or 'streamable-http' for lightweight MCP connections.",
    );
  }

  /** Invoke tool via stdio (placeholder) */
  private async invokeViaStdio(_toolName: string, _input: unknown): Promise<unknown> {
    throw new Error(
      "Stdio transport requires @aizona/mcp-bridge. " +
        "Use transport: 'sse' or 'streamable-http' for lightweight MCP connections.",
    );
  }

  /** Build auth headers */
  private buildHeaders(): Record<string, string> {
    const auth = this.config.authConfig;
    if (!auth) return {};

    switch (auth.type) {
      case "bearer":
        return { Authorization: `Bearer ${auth.token}` };
      case "basic": {
        const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
        return { Authorization: `Basic ${encoded}` };
      }
      case "api-key":
        return { [auth.headerName ?? "X-API-Key"]: auth.apiKey ?? "" };
      default:
        return {};
    }
  }
}
