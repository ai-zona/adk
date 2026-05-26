import type Redis from "ioredis";
import { RuntimeMetricsSchema } from "./types";
import type { RuntimeMetrics } from "./types";

// ──────────────────────────────────────────────────────
// Execution Logger
// ──────────────────────────────────────────────────────
// Container log streaming and metrics capture backed by
// Redis Streams (logs) and Redis Hashes (metrics).
//
// Stream key conventions:
//   aza:runtime:logs:<deploymentId>    — per-deployment log stream
//   aza:runtime:metrics:<deploymentId> — per-deployment metrics hash
// ──────────────────────────────────────────────────────

/** Redis stream key prefix for deployment logs. */
const LOG_STREAM_PREFIX = "aza:runtime:logs:";

/** Redis hash key prefix for deployment metrics. */
const METRICS_HASH_PREFIX = "aza:runtime:metrics:";

/** Default maximum number of log entries to read. */
const DEFAULT_LOG_LIMIT = 100;

/** Default stream poll interval for log streaming (ms). */
const STREAM_POLL_INTERVAL_MS = 1000;

/**
 * A structured log entry emitted by an agent runtime.
 */
export interface LogEntry {
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** Log severity level. */
  level: "info" | "warn" | "error" | "debug";
  /** The log message. */
  message: string;
  /** Optional structured metadata attached to the entry. */
  metadata?: Record<string, unknown>;
}

/**
 * ioredis XRANGE / XREVRANGE returns data shaped like:
 *   [[messageId, [field, value, ...]], ...]
 */
type StreamRangeResult = [string, string[]][];

/**
 * Manages runtime log streaming and metrics capture for agent deployments.
 *
 * Logs are stored as Redis Streams for ordered, append-only storage with
 * automatic ID assignment. Metrics are stored as Redis Hashes for fast
 * point-in-time reads and atomic field updates.
 */
export class ExecutionLogger {
  constructor(private redis: Redis) {}

  // ────────────────────────────────────────────────────
  // Key Helpers
  // ────────────────────────────────────────────────────

  static logStreamKey(deploymentId: string): string {
    return `${LOG_STREAM_PREFIX}${deploymentId}`;
  }

  static metricsHashKey(deploymentId: string): string {
    return `${METRICS_HASH_PREFIX}${deploymentId}`;
  }

  // ────────────────────────────────────────────────────
  // Log Writing
  // ────────────────────────────────────────────────────

  /**
   * Write a log entry to the deployment's Redis log stream.
   *
   * @param deploymentId - The deployment to log for.
   * @param entry - The log entry to write.
   */
  async log(deploymentId: string, entry: LogEntry): Promise<void> {
    const streamKey = ExecutionLogger.logStreamKey(deploymentId);
    const data = JSON.stringify(entry);
    await this.redis.xadd(streamKey, "*", "data", data);
  }

  // ────────────────────────────────────────────────────
  // Log Reading
  // ────────────────────────────────────────────────────

  /**
   * Read log entries from a deployment's log stream.
   *
   * @param deploymentId - The deployment to read logs for.
   * @param params - Optional filtering parameters.
   * @param params.limit - Maximum number of entries to return (default: 100).
   * @param params.since - Only return entries after this Unix timestamp (ms).
   * @param params.level - Filter by log level.
   * @returns An array of log entries, ordered oldest-first.
   */
  async getLogs(
    deploymentId: string,
    params?: { limit?: number; since?: number; level?: string },
  ): Promise<LogEntry[]> {
    const streamKey = ExecutionLogger.logStreamKey(deploymentId);
    const limit = params?.limit ?? DEFAULT_LOG_LIMIT;

    // Use XRANGE to read entries in chronological order.
    // If `since` is specified, convert to a Redis stream ID (timestamp-0).
    const startId = params?.since ? `${params.since}-0` : "-";
    const endId = "+";

    const rawResults = await this.redis.xrange(streamKey, startId, endId, "COUNT", limit);
    if (!rawResults || rawResults.length === 0) return [];

    const results = rawResults as StreamRangeResult;
    const entries: LogEntry[] = [];

    for (const [, fields] of results) {
      const rawData = extractField(fields, "data");
      if (!rawData) continue;

      try {
        const entry = JSON.parse(rawData) as LogEntry;

        // Apply level filter if specified
        if (params?.level && entry.level !== params.level) continue;

        entries.push(entry);
      } catch {
        // Skip malformed log entries
      }
    }

    return entries;
  }

  // ────────────────────────────────────────────────────
  // Metrics Capture
  // ────────────────────────────────────────────────────

  /**
   * Store runtime metrics in a Redis hash for the given deployment.
   * Existing fields are overwritten; missing fields are left unchanged.
   *
   * @param deploymentId - The deployment to capture metrics for.
   * @param metrics - Partial metrics to upsert.
   */
  async captureMetrics(deploymentId: string, metrics: RuntimeMetrics): Promise<void> {
    const hashKey = ExecutionLogger.metricsHashKey(deploymentId);

    // Flatten the metrics object into key-value pairs for HSET
    const pairs: string[] = [];
    for (const [key, value] of Object.entries(metrics)) {
      if (value !== undefined && value !== null) {
        pairs.push(key, String(value));
      }
    }

    if (pairs.length > 0) {
      await this.redis.hset(hashKey, ...pairs);
    }
  }

  /**
   * Read the current metrics for a deployment from Redis.
   *
   * @param deploymentId - The deployment to read metrics for.
   * @returns The parsed metrics, or null if no metrics exist.
   */
  async getMetrics(deploymentId: string): Promise<RuntimeMetrics | null> {
    const hashKey = ExecutionLogger.metricsHashKey(deploymentId);
    const raw = await this.redis.hgetall(hashKey);

    if (!raw || Object.keys(raw).length === 0) return null;

    // Convert string values back to their proper types
    const parsed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === "healthStatus") {
        parsed[key] = value;
      } else {
        // Numeric fields
        const num = Number(value);
        parsed[key] = Number.isNaN(num) ? value : num;
      }
    }

    const result = RuntimeMetricsSchema.safeParse(parsed);
    return result.success ? result.data : null;
  }

  // ────────────────────────────────────────────────────
  // Log Streaming
  // ────────────────────────────────────────────────────

  /**
   * Subscribe to live log entries for a deployment.
   *
   * Polls the Redis stream at a regular interval and invokes the callback
   * for each new entry. Returns an unsubscribe function that stops polling.
   *
   * @param deploymentId - The deployment to stream logs for.
   * @param callback - Invoked for each new log entry.
   * @returns A function to call to stop streaming.
   */
  async streamLogs(deploymentId: string, callback: (entry: LogEntry) => void): Promise<() => void> {
    const streamKey = ExecutionLogger.logStreamKey(deploymentId);
    let lastId = "$"; // Start from new entries only
    let stopped = false;

    const poll = async (): Promise<void> => {
      while (!stopped) {
        try {
          // Use XREAD with BLOCK for efficient polling
          const rawResults = await this.redis.xread(
            "COUNT",
            50,
            "BLOCK",
            STREAM_POLL_INTERVAL_MS,
            "STREAMS",
            streamKey,
            lastId,
          );

          if (!rawResults) continue;

          // rawResults shape: [[streamName, [[id, fields], ...]], ...]
          const results = rawResults as [string, [string, string[]][]][];

          for (const [, messages] of results) {
            for (const [messageId, fields] of messages) {
              lastId = messageId;
              const rawData = extractField(fields, "data");
              if (!rawData) continue;

              try {
                const entry = JSON.parse(rawData) as LogEntry;
                callback(entry);
              } catch {
                // Skip malformed entries
              }
            }
          }
        } catch (error) {
          if (stopped) break;
          // Transient error: log and retry
          console.error(
            `[ExecutionLogger] Error streaming logs for ${deploymentId}:`,
            error instanceof Error ? error.message : error,
          );
          await sleep(STREAM_POLL_INTERVAL_MS);
        }
      }
    };

    // Start polling in the background (do not await)
    void poll();

    return () => {
      stopped = true;
    };
  }

  // ────────────────────────────────────────────────────
  // Cleanup
  // ────────────────────────────────────────────────────

  /**
   * Prune old log entries from a deployment's log stream.
   *
   * Uses XTRIM with MINID to remove entries older than `maxAge` milliseconds.
   *
   * @param deploymentId - The deployment to prune logs for.
   * @param maxAge - Maximum age of log entries in milliseconds.
   */
  async pruneOldLogs(deploymentId: string, maxAge: number): Promise<void> {
    const streamKey = ExecutionLogger.logStreamKey(deploymentId);
    const minTimestamp = Date.now() - maxAge;
    // XTRIM with MINID removes entries with IDs older than the specified minimum
    await this.redis.xtrim(streamKey, "MINID", `${minTimestamp}-0`);
  }

  /**
   * Delete all logs and metrics for a deployment.
   *
   * @param deploymentId - The deployment to clean up.
   */
  async cleanup(deploymentId: string): Promise<void> {
    const streamKey = ExecutionLogger.logStreamKey(deploymentId);
    const hashKey = ExecutionLogger.metricsHashKey(deploymentId);
    await this.redis.del(streamKey, hashKey);
  }
}

// ────────────────────────────────────────────────────
// Internal Helpers
// ────────────────────────────────────────────────────

/**
 * Extract a field value from the flat [key, value, key, value, ...]
 * array returned by Redis stream entries.
 */
function extractField(fields: string[], fieldName: string): string | undefined {
  const index = fields.indexOf(fieldName);
  if (index === -1 || index + 1 >= fields.length) return undefined;
  return fields[index + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
