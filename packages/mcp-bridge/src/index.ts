// MCP Bridge - Phase 2 Steps 2-8: Client, Registry, Safety, Audit, Grants, Bridge
export const MCP_BRIDGE_VERSION = "0.1.0";

// ── Types ──────────────────────────────────────────────
export {
  MCPTransportType,
  MCPTransportTypeSchema,
  MCPAuthTypeValue,
  MCPAuthConfigSchema,
  MCPBridgeConfigSchema,
  MCPServerConfigSchema,
  MCPToolInvocationSchema,
  MCPToolResultSchema,
  MCPToolResultErrorSchema,
  RegisterServerInputSchema,
} from "./types";

export type {
  MCPAuthConfig,
  MCPBridgeConfig,
  MCPServerConfig,
  MCPToolInvocation,
  MCPToolResult,
  ToolInfo,
  HealthCheckResult,
  RegisterServerInput,
  ServerFilters,
  ToolSearchQuery,
  MCPClientPoolConfig,
  PoolStats,
} from "./types";

// ── Client ─────────────────────────────────────────────
export { MCPClient, MCPClientPool } from "./client/index";
export { createStdioTransport } from "./client/index";
export type { StdioTransportConfig } from "./client/index";
export { createStreamableHttpTransport } from "./client/index";
export type { StreamableHttpTransportConfig } from "./client/index";

// ── Registry ───────────────────────────────────────────
export { ServerRegistry, ToolCatalog, HealthMonitor } from "./registry/index";
export type {
  MCPServerRecord,
  MCPToolRecord,
  ToolRecord,
  HealthMonitorOptions,
} from "./registry/index";

// ── Safety ────────────────────────────────────────────
export {
  InputValidator,
  OutputSanitizer,
  RateLimiter,
  CircuitBreaker,
} from "./safety/index";
export type {
  ValidationResult,
  SanitizationResult,
  RateLimitResult,
  RateLimitConfig,
  CircuitState,
  CircuitBreakerConfig,
  CircuitStatus,
} from "./safety/index";

// ── Audit ─────────────────────────────────────────────
export { MCPAuditLogger } from "./audit/index";
export type {
  InvocationStatus,
  InvocationLogEntry,
  MCPInvocationLogRecord,
  QueryLogsParams,
  QueryLogsResult,
} from "./audit/index";

// ── Grants ────────────────────────────────────────────
export { SkillGrantManager } from "./grants/index";
export { ApprovalQueue } from "./grants/index";
export { GrantScopeSchema, GrantLevel } from "./grants/index";
export type {
  GrantScope,
  GrantRecord,
  ApprovalRequest,
  ApprovalDecision,
} from "./grants/index";

// ── Bridge ────────────────────────────────────────────
export { AZAMCPBridge } from "./bridge/index";
export { MessageConverter } from "./bridge/index";
export { AuthTranslator, MCPServerAuthTypeValue } from "./bridge/index";
export type {
  AZAToolRequest,
  AZAToolResponse,
  SafetyTelemetrySink,
  AZAToolCallMessage,
  MCPJsonRpcRequest,
  MCPJsonRpcResponse,
  AZAToolDescriptor,
  AuthContext,
  MCPAuthHeaders,
  MCPServerAuthType,
} from "./bridge/index";
