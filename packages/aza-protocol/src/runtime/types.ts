import { z } from "zod";

// ──────────────────────────────────────────────────────
// Agent Runtime Types
// ──────────────────────────────────────────────────────
// Type definitions for agent sandboxing, deployment,
// runtime state, and metrics.
// ──────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────
// Sandbox Configuration
// ──────────────────────────────────────────────────────

/**
 * Configuration for the agent sandbox environment.
 * Controls resource limits, network access, and execution constraints.
 */
export const SandboxConfigSchema = z.object({
  /** vCPU allocation (e.g., "0.5", "1", "2"). */
  cpuLimit: z.string().default("1"),
  /** Memory limit with unit suffix (e.g., "256Mi", "2Gi"). */
  memoryLimit: z.string().default("512Mi"),
  /** Maximum execution time in seconds before the agent is killed. */
  timeoutSeconds: z.number().int().positive().default(300),
  /** Network access policy for the sandbox. */
  networkPolicy: z.enum(["restricted", "egress-only", "full"]).default("restricted"),
  /** Whether the agent requires GPU access. */
  gpuRequired: z.boolean().default(false),
  /** Maximum concurrent requests the agent can handle. */
  maxConcurrency: z.number().int().positive().default(10),
  /** Allowed external domains (only used when networkPolicy is "egress-only"). */
  allowedDomains: z.array(z.string()).optional(),
  /** Environment variables to inject into the sandbox. */
  env: z.record(z.string()).default({}),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

// ──────────────────────────────────────────────────────
// Runtime State
// ──────────────────────────────────────────────────────

/**
 * Possible states for an agent runtime deployment.
 */
export const RuntimeState = {
  PENDING: "PENDING",
  PROVISIONING: "PROVISIONING",
  RUNNING: "RUNNING",
  STOPPING: "STOPPING",
  STOPPED: "STOPPED",
  FAILED: "FAILED",
  DRAINING: "DRAINING",
} as const;

export type RuntimeState = (typeof RuntimeState)[keyof typeof RuntimeState];

// ──────────────────────────────────────────────────────
// Runtime Metrics
// ──────────────────────────────────────────────────────

/**
 * Runtime metrics for monitoring agent health and resource usage.
 */
export const RuntimeMetricsSchema = z.object({
  /** CPU utilization percentage (0-100). */
  cpuUsage: z.number().min(0).max(100).optional(),
  /** Memory usage in megabytes. */
  memoryUsageMb: z.number().nonnegative().optional(),
  /** Number of currently active requests. */
  activeRequests: z.number().int().nonnegative().optional(),
  /** Total number of requests served since deployment start. */
  totalRequests: z.number().int().nonnegative().optional(),
  /** Error rate percentage (0-100). */
  errorRate: z.number().min(0).max(100).optional(),
  /** Time since deployment start in seconds. */
  uptimeSeconds: z.number().int().nonnegative().optional(),
  /** Unix timestamp (ms) of the last health check. */
  lastHealthCheck: z.number().optional(),
  /** Aggregated health status derived from metrics. */
  healthStatus: z.enum(["healthy", "degraded", "unhealthy"]).optional(),
});

export type RuntimeMetrics = z.infer<typeof RuntimeMetricsSchema>;

// ──────────────────────────────────────────────────────
// Deployment Configuration
// ──────────────────────────────────────────────────────

/**
 * Full deployment configuration for an agent runtime.
 * Combines runtime type, sandbox settings, and deployment-level options.
 */
export const DeploymentConfigSchema = z.object({
  /** The runtime type for the agent's execution environment. */
  runtimeType: z.enum(["docker", "firecracker", "wasm", "external"]).default("docker"),
  /** Docker image to use (required when runtimeType is "docker"). */
  dockerImage: z.string().optional(),
  /** Sandbox resource and network configuration. */
  sandbox: SandboxConfigSchema.optional(),
  /** Target deployment region (e.g., "us-east-1"). */
  region: z.string().optional(),
  /** Number of replicas to deploy. */
  replicas: z.number().int().positive().default(1),
  /** Whether to automatically restart on failure. */
  autoRestart: z.boolean().default(true),
  /** Maximum number of auto-restart attempts before marking as FAILED. */
  maxRestarts: z.number().int().nonnegative().default(3),
  /** URL for health check probes. */
  healthCheckUrl: z.string().optional(),
  /** Interval between health check probes in milliseconds. */
  healthCheckIntervalMs: z.number().int().positive().default(30000),
});

export type DeploymentConfig = z.infer<typeof DeploymentConfigSchema>;

// ──────────────────────────────────────────────────────
// External Agent Registration
// ──────────────────────────────────────────────────────

/**
 * Registration payload for an externally-hosted agent.
 * The agent must provide a signed agent card to prove identity.
 */
export const ExternalAgentRegistrationSchema = z.object({
  /** The agent's DID (did:aza:network:identifier). */
  agentDid: z.string(),
  /** The URL where the external agent is reachable. */
  url: z.string().url(),
  /** Signed agent card (JWS format) for identity verification. */
  agentCardSignature: z.string(),
  /** Optional health check URL for monitoring. */
  healthCheckUrl: z.string().url().optional(),
});

export type ExternalAgentRegistration = z.infer<typeof ExternalAgentRegistrationSchema>;
