import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Configuration for creating a Streamable HTTP transport.
 */
export interface StreamableHttpTransportConfig {
  /** The MCP server endpoint URL */
  url: string;
  /** Additional headers to include with every request (e.g. auth headers) */
  headers?: Record<string, string>;
  /** Session ID for reconnecting to an existing session */
  sessionId?: string;
}

/**
 * Creates a StreamableHTTPClientTransport from a simplified configuration.
 *
 * Streamable HTTP transports communicate with the server over HTTP POST
 * for sending messages and HTTP GET with Server-Sent Events for receiving.
 * This is the preferred transport for remote MCP servers.
 */
export function createStreamableHttpTransport(
  config: StreamableHttpTransportConfig,
): StreamableHTTPClientTransport {
  const opts: StreamableHTTPClientTransportOptions = {
    sessionId: config.sessionId,
  };

  if (config.headers && Object.keys(config.headers).length > 0) {
    opts.requestInit = {
      headers: config.headers,
    };
  }

  return new StreamableHTTPClientTransport(new URL(config.url), opts);
}
