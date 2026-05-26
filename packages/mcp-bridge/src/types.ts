import { z } from "zod";

// ──────────────────────────────────────────────────────
// Transport Types
// ──────────────────────────────────────────────────────

export const MCPTransportType = {
  STDIO: "stdio",
  SSE: "sse",
  STREAMABLE_HTTP: "streamable-http",
} as const;

export type MCPTransportType = (typeof MCPTransportType)[keyof typeof MCPTransportType];

export const MCPTransportTypeSchema = z.enum(["stdio", "sse", "streamable-http"]);

// ──────────────────────────────────────────────────────
// Auth Config
// ──────────────────────────────────────────────────────

export const MCPAuthTypeValue = {
  NONE: "none",
  BEARER: "bearer",
  API_KEY: "api-key",
  OAUTH2: "oauth2",
} as const;

export type MCPAuthTypeValue = (typeof MCPAuthTypeValue)[keyof typeof MCPAuthTypeValue];

export const MCPAuthConfigSchema = z.object({
  type: z.enum(["none", "bearer", "api-key", "oauth2"]),
  credentials: z.record(z.string(), z.string()).optional(),
});

export type MCPAuthConfig = z.infer<typeof MCPAuthConfigSchema>;

// ──────────────────────────────────────────────────────
// Bridge Config
// ──────────────────────────────────────────────────────

export const MCPBridgeConfigSchema = z.object({
  /** Default timeout for tool invocations in milliseconds */
  defaultTimeout: z.number().int().positive().default(30_000),
  /** Maximum number of retries for failed invocations */
  maxRetries: z.number().int().min(0).default(3),
  /** Interval between health checks in milliseconds */
  healthCheckInterval: z.number().int().positive().default(60_000),
});

export type MCPBridgeConfig = z.infer<typeof MCPBridgeConfigSchema>;

// ──────────────────────────────────────────────────────
// Server Config
// ──────────────────────────────────────────────────────

export const MCPServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  transport: MCPTransportTypeSchema,
  auth: MCPAuthConfigSchema,
  healthCheckUrl: z.string().url().optional(),
});

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;

// ──────────────────────────────────────────────────────
// Tool Invocation
// ──────────────────────────────────────────────────────

export const MCPToolInvocationSchema = z.object({
  toolId: z.string().min(1),
  serverId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
  agentDid: z.string().min(1),
  correlationId: z.string().min(1),
});

export type MCPToolInvocation = z.infer<typeof MCPToolInvocationSchema>;

// ──────────────────────────────────────────────────────
// Tool Result
// ──────────────────────────────────────────────────────

export const MCPToolResultErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

export const MCPToolResultSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: MCPToolResultErrorSchema.optional(),
  latencyMs: z.number().int().min(0),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type MCPToolResult = z.infer<typeof MCPToolResultSchema>;

// ──────────────────────────────────────────────────────
// Tool Info (as discovered from MCP server)
// ──────────────────────────────────────────────────────

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────
// Health Check Result
// ──────────────────────────────────────────────────────

export interface HealthCheckResult {
  serverId: string;
  healthy: boolean;
  status: "HEALTHY" | "DEGRADED" | "DOWN" | "UNREACHABLE";
  latencyMs: number;
  toolsAvailable?: number;
  errorMessage?: string;
  checkedAt: Date;
}

// ──────────────────────────────────────────────────────
// Registry Types
// ──────────────────────────────────────────────────────

export const RegisterServerInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  url: z.string().min(1),
  transport: z.enum(["STDIO", "SSE", "STREAMABLE_HTTP"]),
  authType: z.enum(["NONE", "BEARER", "API_KEY", "OAUTH2"]).default("NONE"),
  registeredByAgentId: z.string().optional(),
  registeredByUserId: z.string().optional(),
  healthCheckUrl: z.string().url().optional(),
  version: z.string().optional(),
  documentationUrl: z.string().url().optional(),
  iconUrl: z.string().url().optional(),
});

export type RegisterServerInput = z.infer<typeof RegisterServerInputSchema>;

export interface ServerFilters {
  status?: "ACTIVE" | "DEGRADED" | "OFFLINE" | "MAINTENANCE";
  transport?: "STDIO" | "SSE" | "STREAMABLE_HTTP";
  registeredByAgentId?: string;
  registeredByUserId?: string;
  search?: string;
  skip?: number;
  take?: number;
}

export interface ToolSearchQuery {
  query?: string;
  category?: string;
  tags?: string[];
  pricingModel?: "FREE" | "PER_CALL" | "MONTHLY";
  serverId?: string;
  deprecated?: boolean;
  skip?: number;
  take?: number;
}

// ──────────────────────────────────────────────────────
// Pool Config
// ──────────────────────────────────────────────────────

export interface MCPClientPoolConfig {
  /** Maximum number of client connections per server */
  maxClientsPerServer: number;
  /** Idle timeout before a client is destroyed, in milliseconds */
  idleTimeoutMs: number;
}

export interface PoolStats {
  serverId: string;
  active: number;
  idle: number;
}
