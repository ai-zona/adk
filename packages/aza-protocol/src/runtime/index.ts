// ──────────────────────────────────────────────────────
// AZA Protocol Runtime Module
// ──────────────────────────────────────────────────────

// Runtime types and schemas
export {
  SandboxConfigSchema,
  RuntimeState,
  RuntimeMetricsSchema,
  DeploymentConfigSchema,
  ExternalAgentRegistrationSchema,
} from "./types";

export type {
  SandboxConfig,
  RuntimeState as RuntimeStateType,
  RuntimeMetrics,
  DeploymentConfig,
  ExternalAgentRegistration,
} from "./types";

// Lifecycle management
export { LifecycleManager } from "./lifecycle-manager";
export type { DeploymentRecord } from "./lifecycle-manager";

// Sandbox configuration builder
export { SandboxConfigBuilder, SANDBOX_PROFILES } from "./sandbox-config";
export type { SandboxProfile } from "./sandbox-config";

// Execution logging and metrics
export { ExecutionLogger } from "./execution-logger";
export type { LogEntry } from "./execution-logger";

// External agent management
export { ExternalAgentManager } from "./external-agent";
export type { ExternalAgentRecord } from "./external-agent";
