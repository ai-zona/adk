import { db } from "@aizona/db";
import Redis from "ioredis";
import { MCPClient } from "../client/mcp-client";
import type { HealthCheckResult } from "../types";
import type { MCPAuthConfig, MCPServerConfig } from "../types";

/**
 * Maps database MCPTransport enum to the MCPTransportType union used by MCPClient.
 */
function mapDbTransport(
  transport: "STDIO" | "SSE" | "STREAMABLE_HTTP",
): "stdio" | "sse" | "streamable-http" {
  switch (transport) {
    case "STDIO":
      return "stdio";
    case "SSE":
      return "sse";
    case "STREAMABLE_HTTP":
      return "streamable-http";
  }
}

/**
 * Maps database MCPAuthType enum to the MCPAuthConfig shape.
 */
function mapDbAuthType(authType: "NONE" | "BEARER" | "API_KEY" | "OAUTH2"): MCPAuthConfig {
  switch (authType) {
    case "NONE":
      return { type: "none" };
    case "BEARER":
      return { type: "bearer" };
    case "API_KEY":
      return { type: "api-key" };
    case "OAUTH2":
      return { type: "oauth2" };
  }
}

/**
 * Maps a HealthCheckResult status to the Prisma MCPHealthStatus enum.
 */
function mapHealthStatus(
  status: HealthCheckResult["status"],
): "HEALTHY" | "DEGRADED" | "DOWN" | "UNREACHABLE" {
  return status;
}

/**
 * Redis key prefix for tracking consecutive health check failures.
 */
const REDIS_FAILURE_KEY_PREFIX = "mcp:health:failures:";

/**
 * Options for configuring the HealthMonitor.
 */
export interface HealthMonitorOptions {
  /** Interval between health check cycles in milliseconds. Default: 60000 */
  intervalMs?: number;
  /** Number of consecutive failures before marking server as DEGRADED. Default: 3 */
  degradedThreshold?: number;
  /** Number of consecutive failures before marking server as OFFLINE. Default: 5 */
  offlineThreshold?: number;
  /** Redis connection URL. Default: redis://localhost:6379 */
  redisUrl?: string;
}

/**
 * HealthMonitor periodically checks the health of all registered MCP servers
 * and updates their status in the database based on consecutive failure counts.
 *
 * Health check results are stored in the MCPHealthCheck table for auditing.
 * Consecutive failure counts are tracked in Redis for fast, atomic increments.
 *
 * Status transitions:
 * - 0 failures: ACTIVE
 * - >= degradedThreshold failures: DEGRADED
 * - >= offlineThreshold failures: OFFLINE
 */
export class HealthMonitor {
  private intervalId?: ReturnType<typeof setInterval>;
  private intervalMs: number;
  private degradedThreshold: number;
  private offlineThreshold: number;
  private redis: Redis;
  private running = false;

  constructor(options?: HealthMonitorOptions) {
    this.intervalMs = options?.intervalMs ?? 60_000;
    this.degradedThreshold = options?.degradedThreshold ?? 3;
    this.offlineThreshold = options?.offlineThreshold ?? 5;
    this.redis = new Redis(options?.redisUrl ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
  }

  /**
   * Starts the periodic health check loop.
   * If already running, this is a no-op.
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;

    // Connect Redis lazily
    this.redis.connect().catch(() => {
      // Redis connection errors are handled per-operation
    });

    // Run an immediate check, then schedule periodic checks
    void this.checkAllServers();

    this.intervalId = setInterval(() => {
      void this.checkAllServers();
    }, this.intervalMs);
  }

  /**
   * Stops the periodic health check loop and disconnects Redis.
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.redis.disconnect();
  }

  /**
   * Checks the health of a single server by its database ID.
   *
   * Connects an ephemeral MCPClient, performs a ping health check,
   * records the result, and updates the server status based on
   * the consecutive failure count.
   *
   * @param serverId - The database ID of the server to check
   * @returns The health check result
   */
  async checkServer(serverId: string): Promise<HealthCheckResult> {
    const server = await db.mCPServer.findUnique({
      where: { id: serverId },
      include: { tools: { select: { id: true } } },
    });

    if (!server) {
      return {
        serverId,
        healthy: false,
        status: "UNREACHABLE",
        latencyMs: 0,
        errorMessage: "Server not found in database",
        checkedAt: new Date(),
      };
    }

    // Skip servers in MAINTENANCE mode
    if (server.status === "MAINTENANCE") {
      return {
        serverId,
        healthy: false,
        status: "DOWN",
        latencyMs: 0,
        errorMessage: "Server is in maintenance mode",
        checkedAt: new Date(),
      };
    }

    const config: MCPServerConfig = {
      id: server.id,
      name: server.name,
      url: server.url,
      transport: mapDbTransport(server.transport),
      auth: mapDbAuthType(server.authType),
      healthCheckUrl: server.healthCheckUrl ?? undefined,
    };

    const client = new MCPClient(config);
    const checkedAt = new Date();

    try {
      await client.connect();
      const { healthy, latencyMs } = await client.healthCheck();

      let toolsAvailable: number | undefined;
      try {
        const tools = await client.listTools();
        toolsAvailable = tools.length;
      } catch {
        // Tools listing is best-effort
      }

      await client.disconnect();

      if (healthy) {
        // Reset failure count on successful check
        await this.resetFailureCount(serverId);
        await this.recordHealthCheck(serverId, "HEALTHY", latencyMs, toolsAvailable);
        await this.markServerStatus(serverId, "ACTIVE");

        return {
          serverId,
          healthy: true,
          status: "HEALTHY",
          latencyMs,
          toolsAvailable,
          checkedAt,
        };
      }

      // Health check returned unhealthy
      const failures = await this.incrementFailureCount(serverId);
      const status = this.determineStatus(failures);
      const dbStatus = this.determineServerStatus(failures);

      await this.recordHealthCheck(
        serverId,
        status,
        latencyMs,
        toolsAvailable,
        "Health check ping failed",
      );
      await this.markServerStatus(serverId, dbStatus);

      return {
        serverId,
        healthy: false,
        status,
        latencyMs,
        toolsAvailable,
        errorMessage: "Health check ping failed",
        checkedAt,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Ensure client is disconnected on error
      try {
        await client.disconnect();
      } catch {
        // Ignore disconnect errors
      }

      const failures = await this.incrementFailureCount(serverId);
      const status = this.determineStatus(failures);
      const dbStatus = this.determineServerStatus(failures);

      await this.recordHealthCheck(serverId, status, 0, undefined, errorMessage);
      await this.markServerStatus(serverId, dbStatus);

      return {
        serverId,
        healthy: false,
        status,
        latencyMs: 0,
        errorMessage,
        checkedAt,
      };
    }
  }

  /**
   * Checks the health of all active/degraded servers.
   * Servers in MAINTENANCE status are skipped.
   *
   * @returns Array of health check results
   */
  async checkAllServers(): Promise<HealthCheckResult[]> {
    const servers = await db.mCPServer.findMany({
      where: {
        status: { in: ["ACTIVE", "DEGRADED", "OFFLINE"] },
      },
      select: { id: true },
    });

    const results = await Promise.allSettled(servers.map((server: any) => this.checkServer(server.id)));

    return results
      .filter((r): r is PromiseFulfilledResult<HealthCheckResult> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  /**
   * Updates the server status in the database and records the last health check time.
   */
  private async markServerStatus(
    serverId: string,
    status: "ACTIVE" | "DEGRADED" | "OFFLINE" | "MAINTENANCE",
  ): Promise<void> {
    await db.mCPServer.update({
      where: { id: serverId },
      data: {
        status,
        lastHealthCheck: new Date(),
      },
    });
  }

  /**
   * Records a health check result in the MCPHealthCheck table.
   */
  private async recordHealthCheck(
    serverId: string,
    status: HealthCheckResult["status"],
    responseTimeMs: number,
    toolsAvailable?: number,
    errorMessage?: string,
  ): Promise<void> {
    await db.mCPHealthCheck.create({
      data: {
        serverId,
        status: mapHealthStatus(status),
        responseTimeMs,
        toolsAvailable,
        errorMessage,
      },
    });
  }

  /**
   * Increments the consecutive failure count in Redis.
   * Returns the new count after increment.
   */
  private async incrementFailureCount(serverId: string): Promise<number> {
    const key = `${REDIS_FAILURE_KEY_PREFIX}${serverId}`;
    try {
      const count = await this.redis.incr(key);
      // Set expiry to 24 hours to auto-cleanup stale failure counts
      await this.redis.expire(key, 86_400);
      return count;
    } catch {
      // If Redis is unavailable, return a high number to be conservative
      return this.offlineThreshold;
    }
  }

  /**
   * Resets the consecutive failure count in Redis.
   */
  private async resetFailureCount(serverId: string): Promise<void> {
    const key = `${REDIS_FAILURE_KEY_PREFIX}${serverId}`;
    try {
      await this.redis.del(key);
    } catch {
      // Ignore Redis errors during reset
    }
  }

  /**
   * Determines the health check status based on the consecutive failure count.
   */
  private determineStatus(failures: number): HealthCheckResult["status"] {
    if (failures >= this.offlineThreshold) {
      return "DOWN";
    }
    if (failures >= this.degradedThreshold) {
      return "DEGRADED";
    }
    return "UNREACHABLE";
  }

  /**
   * Determines the server status (Prisma enum) based on the consecutive failure count.
   */
  private determineServerStatus(
    failures: number,
  ): "ACTIVE" | "DEGRADED" | "OFFLINE" | "MAINTENANCE" {
    if (failures >= this.offlineThreshold) {
      return "OFFLINE";
    }
    if (failures >= this.degradedThreshold) {
      return "DEGRADED";
    }
    return "ACTIVE";
  }
}
