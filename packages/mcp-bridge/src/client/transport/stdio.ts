import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Configuration for creating a stdio transport.
 * Maps to the MCP SDK's StdioServerParameters.
 */
export interface StdioTransportConfig {
  /** The executable to run to start the server */
  command: string;
  /** Command line arguments to pass to the executable */
  args?: string[];
  /** Environment variables for the spawned process */
  env?: Record<string, string>;
  /** Working directory for the spawned process */
  cwd?: string;
}

/**
 * Creates a StdioClientTransport from a simplified configuration.
 *
 * Stdio transports spawn a child process and communicate over stdin/stdout.
 * This is typically used for local MCP servers.
 */
export function createStdioTransport(config: StdioTransportConfig): StdioClientTransport {
  const params: StdioServerParameters = {
    command: config.command,
    args: config.args,
    env: config.env,
    cwd: config.cwd,
    stderr: "pipe",
  };

  return new StdioClientTransport(params);
}
