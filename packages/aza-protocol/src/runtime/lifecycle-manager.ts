import { db } from "@aizona/db";
import type Redis from "ioredis";
import { ExecutionLogger } from "./execution-logger";
import type { LogEntry } from "./execution-logger";
import { DeploymentConfigSchema, RuntimeMetricsSchema } from "./types";
import type { DeploymentConfig, RuntimeMetrics, RuntimeState } from "./types";

// ──────────────────────────────────────────────────────
// Lifecycle Manager
// ──────────────────────────────────────────────────────
// Manages the full lifecycle of agent deployments:
// create -> start -> (health check / metrics) -> stop -> destroy
//
// Persists deployment records in Prisma (AgentDeployment +
// AgentRuntime) and uses Redis for metrics and logs via
// the ExecutionLogger.
// ──────────────────────────────────────────────────────

/**
 * A deployment record as returned by Prisma.
 */
export type DeploymentRecord = Awaited<ReturnType<typeof db.agentDeployment.findUniqueOrThrow>>;

/**
 * Valid state transitions for a deployment.
 * Maps: currentState -> set of allowed next states.
 */
const STATE_TRANSITIONS: Record<string, readonly string[]> = {
  PROVISIONING: ["RUNNING", "FAILED", "STOPPED"],
  RUNNING: ["STOPPING", "DRAINING", "FAILED"],
  STOPPING: ["STOPPED", "FAILED"],
  DRAINING: ["STOPPED", "FAILED"],
  STOPPED: ["PROVISIONING"],
  FAILED: ["PROVISIONING"],
};

/**
 * Manages the lifecycle of agent runtime deployments.
 *
 * Coordinates between Prisma (persistent state) and Redis
 * (logs, metrics) to provide a complete deployment management layer.
 */
export class LifecycleManager {
  private restartCounts = new Map<string, number>();
  private logger: ExecutionLogger;

  constructor(private redis: Redis) {
    this.logger = new ExecutionLogger(redis);
  }

  // ────────────────────────────────────────────────────
  // Create
  // ────────────────────────────────────────────────────

  /**
   * Create a new deployment for an agent.
   *
   * 1. Upserts an AgentRuntime record for the agent.
   * 2. Creates an AgentDeployment record with status PROVISIONING.
   *
   * @param params - Agent ID and deployment configuration.
   * @returns The newly created deployment record.
   */
  async create(params: {
    agentId: string;
    config: DeploymentConfig;
  }): Promise<DeploymentRecord> {
    const config = DeploymentConfigSchema.parse(params.config);
    const sandbox = config.sandbox ?? {
      cpuLimit: "1",
      memoryLimit: "512Mi",
      timeoutSeconds: 300,
      networkPolicy: "restricted" as const,
      gpuRequired: false,
      maxConcurrency: 10,
      env: {},
    };

    // 1. Upsert AgentRuntime
    await db.agentRuntime.upsert({
      where: { agentId: params.agentId },
      create: {
        agentId: params.agentId,
        runtimeType: config.runtimeType,
        dockerImage: config.dockerImage ?? null,
        cpuLimit: sandbox.cpuLimit ?? "1",
        memoryLimit: sandbox.memoryLimit ?? "512Mi",
        networkPolicy: sandbox.networkPolicy ?? "restricted",
        gpuRequired: sandbox.gpuRequired ?? false,
        env: (sandbox.env ?? {}) as any,
        maxConcurrency: sandbox.maxConcurrency ?? 10,
        timeoutSeconds: sandbox.timeoutSeconds ?? 300,
      },
      update: {
        runtimeType: config.runtimeType,
        dockerImage: config.dockerImage ?? null,
        cpuLimit: sandbox.cpuLimit ?? "1",
        memoryLimit: sandbox.memoryLimit ?? "512Mi",
        networkPolicy: sandbox.networkPolicy ?? "restricted",
        gpuRequired: sandbox.gpuRequired ?? false,
        env: (sandbox.env ?? {}) as any,
        maxConcurrency: sandbox.maxConcurrency ?? 10,
        timeoutSeconds: sandbox.timeoutSeconds ?? 300,
      },
    });

    // 2. Create AgentDeployment
    const deploymentType = config.runtimeType === "external" ? "EXTERNAL" : "PLATFORM";
    const deployment = await db.agentDeployment.create({
      data: {
        agentId: params.agentId,
        deploymentType,
        status: "PROVISIONING",
        region: config.region ?? null,
        healthCheckUrl: config.healthCheckUrl ?? null,
        config: config as any,
        metrics: {} as any,
      },
    });

    // Log the creation event
    await this.logger.log(deployment.id, {
      timestamp: Date.now(),
      level: "info",
      message: `Deployment created with runtime type "${config.runtimeType}"`,
      metadata: { agentId: params.agentId, deploymentType },
    });

    return deployment;
  }

  // ────────────────────────────────────────────────────
  // Start
  // ────────────────────────────────────────────────────

  /**
   * Transition a deployment to RUNNING state.
   *
   * Valid from: PROVISIONING, STOPPED.
   *
   * @param deploymentId - The deployment to start.
   * @returns The updated deployment record.
   * @throws Error if the state transition is invalid.
   */
  async start(deploymentId: string): Promise<DeploymentRecord> {
    const deployment = await db.agentDeployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });

    this.assertTransition(deployment.status, "RUNNING");

    const updated = await db.agentDeployment.update({
      where: { id: deploymentId },
      data: {
        status: "RUNNING",
        lastHealthCheck: new Date(),
        metrics: {
          ...(typeof deployment.metrics === "object" && deployment.metrics !== null
            ? deployment.metrics
            : {}),
          startedAt: Date.now(),
        } as any,
      },
    });

    await this.logger.log(deploymentId, {
      timestamp: Date.now(),
      level: "info",
      message: "Deployment started",
    });

    // Reset restart count on successful start
    this.restartCounts.delete(deploymentId);

    return updated;
  }

  // ────────────────────────────────────────────────────
  // Stop
  // ────────────────────────────────────────────────────

  /**
   * Transition a deployment to STOPPED state.
   *
   * Valid from: RUNNING, DRAINING.
   *
   * @param deploymentId - The deployment to stop.
   * @returns The updated deployment record.
   * @throws Error if the state transition is invalid.
   */
  async stop(deploymentId: string): Promise<DeploymentRecord> {
    const deployment = await db.agentDeployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });

    this.assertTransition(deployment.status, "STOPPED");

    const updated = await db.agentDeployment.update({
      where: { id: deploymentId },
      data: {
        status: "STOPPED",
        metrics: {
          ...(typeof deployment.metrics === "object" && deployment.metrics !== null
            ? deployment.metrics
            : {}),
          stoppedAt: Date.now(),
        } as any,
      },
    });

    await this.logger.log(deploymentId, {
      timestamp: Date.now(),
      level: "info",
      message: "Deployment stopped",
    });

    return updated;
  }

  // ────────────────────────────────────────────────────
  // Destroy
  // ────────────────────────────────────────────────────

  /**
   * Permanently remove a deployment record and its associated logs/metrics.
   *
   * @param deploymentId - The deployment to destroy.
   */
  async destroy(deploymentId: string): Promise<void> {
    // Remove the deployment record
    await db.agentDeployment.delete({
      where: { id: deploymentId },
    });

    // Clean up Redis logs and metrics
    await this.logger.cleanup(deploymentId);

    // Clean up restart counter
    this.restartCounts.delete(deploymentId);
  }

  // ────────────────────────────────────────────────────
  // Read Operations
  // ────────────────────────────────────────────────────

  /**
   * Get a single deployment by ID.
   */
  async getDeployment(deploymentId: string): Promise<DeploymentRecord | null> {
    return db.agentDeployment.findUnique({
      where: { id: deploymentId },
    });
  }

  /**
   * List all deployments for a given agent.
   */
  async listDeployments(agentId: string): Promise<DeploymentRecord[]> {
    return db.agentDeployment.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
    });
  }

  // ────────────────────────────────────────────────────
  // Health Checks
  // ────────────────────────────────────────────────────

  /**
   * Perform a health check on a deployment.
   *
   * If the deployment has a healthCheckUrl, issues an HTTP request to it.
   * Otherwise, derives health from the current metrics (e.g., error rate).
   *
   * Updates the deployment's lastHealthCheck timestamp and metrics.
   *
   * @param deploymentId - The deployment to health-check.
   * @returns The health status and current metrics.
   */
  async checkHealth(deploymentId: string): Promise<{ healthy: boolean; metrics: RuntimeMetrics }> {
    const deployment = await db.agentDeployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });

    let healthy = true;
    let healthStatus: "healthy" | "degraded" | "unhealthy" = "healthy";

    // Read current metrics from Redis
    const currentMetrics = (await this.logger.getMetrics(deploymentId)) ?? {};

    // If the deployment has a health check URL, probe it
    if (deployment.healthCheckUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(deployment.healthCheckUrl, {
          method: "GET",
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          healthy = false;
          healthStatus = "unhealthy";
        }
      } catch {
        healthy = false;
        healthStatus = "unhealthy";
      }
    }

    // Derive health from error rate if available
    if (currentMetrics.errorRate !== undefined && currentMetrics.errorRate > 50) {
      healthy = false;
      healthStatus = "unhealthy";
    } else if (currentMetrics.errorRate !== undefined && currentMetrics.errorRate > 10) {
      healthStatus = "degraded";
    }

    // Update metrics
    const updatedMetrics: RuntimeMetrics = {
      ...currentMetrics,
      lastHealthCheck: Date.now(),
      healthStatus,
    };

    await this.logger.captureMetrics(deploymentId, updatedMetrics);

    // Update the deployment record's lastHealthCheck
    await db.agentDeployment.update({
      where: { id: deploymentId },
      data: {
        lastHealthCheck: new Date(),
        metrics: updatedMetrics as any,
      },
    });

    return { healthy, metrics: updatedMetrics };
  }

  // ────────────────────────────────────────────────────
  // Failure Handling
  // ────────────────────────────────────────────────────

  /**
   * Handle a deployment failure with auto-restart logic.
   *
   * If the deployment's restart count is below the configured maximum,
   * the deployment is transitioned back to PROVISIONING for restart.
   * Otherwise, it is marked as FAILED permanently.
   *
   * @param deploymentId - The deployment that failed.
   * @param error - A description of the failure.
   */
  async handleFailure(deploymentId: string, error: string): Promise<void> {
    const deployment = await db.agentDeployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });

    // Determine max restarts from config
    const deployConfig = deployment.config as Record<string, unknown> | null;
    const maxRestarts =
      typeof deployConfig?.maxRestarts === "number" ? deployConfig.maxRestarts : 3;
    const autoRestart =
      typeof deployConfig?.autoRestart === "boolean" ? deployConfig.autoRestart : true;

    const currentRestarts = this.restartCounts.get(deploymentId) ?? 0;

    await this.logger.log(deploymentId, {
      timestamp: Date.now(),
      level: "error",
      message: `Deployment failure: ${error}`,
      metadata: { restartCount: currentRestarts, maxRestarts },
    });

    if (autoRestart && currentRestarts < maxRestarts) {
      // Restart: transition back to PROVISIONING
      this.restartCounts.set(deploymentId, currentRestarts + 1);

      await db.agentDeployment.update({
        where: { id: deploymentId },
        data: { status: "PROVISIONING" },
      });

      await this.logger.log(deploymentId, {
        timestamp: Date.now(),
        level: "warn",
        message: `Auto-restarting deployment (attempt ${currentRestarts + 1}/${maxRestarts})`,
      });
    } else {
      // Max restarts exceeded — mark as FAILED
      await db.agentDeployment.update({
        where: { id: deploymentId },
        data: { status: "FAILED" },
      });

      await this.logger.log(deploymentId, {
        timestamp: Date.now(),
        level: "error",
        message: autoRestart
          ? `Deployment marked as FAILED after ${maxRestarts} restart attempts`
          : "Deployment marked as FAILED (auto-restart disabled)",
      });
    }
  }

  // ────────────────────────────────────────────────────
  // Metrics
  // ────────────────────────────────────────────────────

  /**
   * Update runtime metrics for a deployment.
   *
   * Writes the metrics to both Redis (for live queries) and the
   * Prisma deployment record (for persistence).
   *
   * @param deploymentId - The deployment to update metrics for.
   * @param metrics - Partial metrics to merge with existing values.
   */
  async updateMetrics(deploymentId: string, metrics: Partial<RuntimeMetrics>): Promise<void> {
    const validated = RuntimeMetricsSchema.partial().parse(metrics);

    // Write to Redis
    await this.logger.captureMetrics(deploymentId, validated as RuntimeMetrics);

    // Also persist to the Prisma deployment record
    const deployment = await db.agentDeployment.findUniqueOrThrow({
      where: { id: deploymentId },
    });

    const existingMetrics =
      typeof deployment.metrics === "object" && deployment.metrics !== null
        ? deployment.metrics
        : {};

    await db.agentDeployment.update({
      where: { id: deploymentId },
      data: {
        metrics: { ...existingMetrics, ...validated } as any,
      },
    });
  }

  /**
   * Get the current metrics for a deployment.
   *
   * Reads from Redis first (fast path). Falls back to the Prisma
   * deployment record if Redis has no data.
   *
   * @param deploymentId - The deployment to get metrics for.
   * @returns The current metrics, or null if none exist.
   */
  async getMetrics(deploymentId: string): Promise<RuntimeMetrics | null> {
    // Try Redis first
    const redisMetrics = await this.logger.getMetrics(deploymentId);
    if (redisMetrics) return redisMetrics;

    // Fall back to Prisma
    const deployment = await db.agentDeployment.findUnique({
      where: { id: deploymentId },
    });

    if (!deployment?.metrics || typeof deployment.metrics !== "object") return null;

    const result = RuntimeMetricsSchema.safeParse(deployment.metrics);
    return result.success ? result.data : null;
  }

  // ────────────────────────────────────────────────────
  // Logs
  // ────────────────────────────────────────────────────

  /**
   * Get log entries for a deployment from the Redis log stream.
   *
   * @param deploymentId - The deployment to get logs for.
   * @param params - Optional filtering: limit and since (Unix ms timestamp).
   * @returns An array of log entries, ordered oldest-first.
   */
  async getLogs(
    deploymentId: string,
    params?: { limit?: number; since?: number },
  ): Promise<LogEntry[]> {
    return this.logger.getLogs(deploymentId, params);
  }

  // ────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────

  /**
   * Assert that a state transition is valid.
   * Throws if the transition from `currentState` to `targetState` is not allowed.
   */
  private assertTransition(currentState: string, targetState: RuntimeState): void {
    const allowed = STATE_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(targetState)) {
      throw new Error(
        `Invalid state transition: cannot move from "${currentState}" to "${targetState}"`,
      );
    }
  }
}
