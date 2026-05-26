import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { SSEClientTransportOptions } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerConfig, MCPToolResult, ToolInfo } from "../types";
import { createStdioTransport } from "./transport/stdio";
import { createStreamableHttpTransport } from "./transport/streamable-http";

/**
 * Builds the appropriate authentication headers for a given auth config.
 */
function buildAuthHeaders(auth: MCPServerConfig["auth"]): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (auth.type) {
    case "bearer": {
      const token = auth.credentials?.token;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      break;
    }
    case "api-key": {
      const headerName = auth.credentials?.headerName ?? "X-API-Key";
      const apiKey = auth.credentials?.apiKey;
      if (apiKey) {
        headers[headerName] = apiKey;
      }
      break;
    }
    default:
      break;
  }

  return headers;
}

/**
 * Validates a stdio command and its arguments against shell injection patterns.
 * Rejects commands containing path traversal or shell metacharacters.
 */
function validateStdioCommand(command: string, args: string[]): void {
  const dangerous = /[;&|`$><\n\r]|\.\./;
  if (dangerous.test(command)) {
    throw new Error(`Unsafe command: ${command}`);
  }
  for (const arg of args) {
    if (dangerous.test(arg)) {
      throw new Error(`Unsafe argument: ${arg}`);
    }
  }
}

/**
 * Creates an MCP transport based on the server configuration.
 */
function createTransport(config: MCPServerConfig): Transport {
  const authHeaders = buildAuthHeaders(config.auth);

  switch (config.transport) {
    case "stdio": {
      // For stdio, the URL is the command to execute.
      // Format: "command arg1 arg2" or just "command"
      const parts = config.url.split(/\s+/);
      const command = parts[0]!;
      const args = parts.slice(1);
      validateStdioCommand(command, args);
      return createStdioTransport({
        command,
        args,
        env: config.auth.credentials,
      });
    }
    case "sse": {
      const opts: SSEClientTransportOptions = {};
      if (Object.keys(authHeaders).length > 0) {
        opts.requestInit = { headers: authHeaders };
      }
      return new SSEClientTransport(new URL(config.url), opts);
    }
    case "streamable-http": {
      return createStreamableHttpTransport({
        url: config.url,
        headers: authHeaders,
      });
    }
    default: {
      const _exhaustive: never = config.transport;
      throw new Error(`Unsupported transport type: ${_exhaustive}`);
    }
  }
}

/**
 * MCPClient wraps the MCP SDK Client, managing connection lifecycle,
 * tool invocations, and health checks for a single MCP server.
 */
export class MCPClient {
  private client: Client;
  private transport: Transport | null = null;
  private config: MCPServerConfig;
  private connected = false;

  constructor(config: MCPServerConfig) {
    this.config = config;
    this.client = new Client(
      {
        name: "aizona-mcp-bridge",
        version: "0.1.0",
      },
      {
        capabilities: {},
      },
    );
  }

  /**
   * Returns the server config this client was created for.
   */
  getConfig(): MCPServerConfig {
    return this.config;
  }

  /**
   * Establishes a connection to the MCP server.
   * Creates the appropriate transport and initiates the MCP handshake.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.transport = createTransport(this.config);

    // Set up close handler to update connection state
    const originalOnClose = this.transport.onclose;
    this.transport.onclose = () => {
      this.connected = false;
      originalOnClose?.();
    };

    try {
      await this.client.connect(this.transport);
      this.connected = true;
    } catch (error) {
      this.connected = false;
      this.transport = null;
      throw error;
    }
  }

  /**
   * Disconnects from the MCP server and cleans up resources.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    try {
      await this.client.close();
    } finally {
      this.connected = false;
      this.transport = null;
    }
  }

  /**
   * Invokes a tool on the connected MCP server.
   *
   * @param name - The name of the tool to call
   * @param args - Arguments to pass to the tool
   * @returns A standardized MCPToolResult
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (!this.connected) {
      return {
        success: false,
        error: {
          code: "NOT_CONNECTED",
          message: `Client is not connected to server ${this.config.id}`,
        },
        latencyMs: 0,
      };
    }

    const startTime = Date.now();

    try {
      const result = await this.client.callTool({
        name,
        arguments: args,
      });

      const latencyMs = Math.round(Date.now() - startTime);

      // Check if the result has an isError flag (standard MCP error response)
      if ("isError" in result && result.isError) {
        const errorText =
          "content" in result && Array.isArray(result.content)
            ? result.content
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("\n")
            : "Tool returned an error";

        return {
          success: false,
          error: {
            code: "TOOL_ERROR",
            message: errorText,
          },
          latencyMs,
        };
      }

      // Extract text content as the primary data
      let data: unknown;
      if ("content" in result && Array.isArray(result.content)) {
        const textParts = result.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text);

        if (textParts.length === 1) {
          // Try to parse as JSON, fall back to raw text
          try {
            data = JSON.parse(textParts[0]!);
          } catch {
            data = textParts[0];
          }
        } else if (textParts.length > 1) {
          data = textParts;
        }
      }

      // Include structured content if available
      if ("structuredContent" in result && result.structuredContent) {
        data = result.structuredContent;
      }

      return {
        success: true,
        data,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Math.round(Date.now() - startTime);
      const message = error instanceof Error ? error.message : "Unknown error occurred";

      return {
        success: false,
        error: {
          code: "INVOCATION_ERROR",
          message,
        },
        latencyMs,
      };
    }
  }

  /**
   * Lists all tools available on the connected MCP server.
   *
   * @returns An array of tool information objects
   */
  async listTools(): Promise<ToolInfo[]> {
    if (!this.connected) {
      throw new Error(`Client is not connected to server ${this.config.id}`);
    }

    const result = await this.client.listTools();

    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
    }));
  }

  /**
   * Performs a health check by pinging the connected MCP server.
   *
   * @returns An object with the health status and latency
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    if (!this.connected) {
      return { healthy: false, latencyMs: 0 };
    }

    const startTime = Date.now();

    try {
      await this.client.ping();
      const latencyMs = Math.round(Date.now() - startTime);
      return { healthy: true, latencyMs };
    } catch {
      const latencyMs = Math.round(Date.now() - startTime);
      return { healthy: false, latencyMs };
    }
  }

  /**
   * Returns whether this client is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
