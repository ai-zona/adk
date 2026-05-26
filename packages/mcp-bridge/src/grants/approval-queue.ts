import { randomUUID } from "node:crypto";
import type Redis from "ioredis";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export interface ApprovalRequest {
  /** Unique request identifier. */
  id: string;
  /** The agent requesting tool access. */
  agentId: string;
  /** The tool being requested. */
  toolId: string;
  /** Human-readable tool name for display. */
  toolName: string;
  /** The action / method being invoked. */
  action: string;
  /** Sanitized input summary for human review (no secrets). */
  input: Record<string, unknown>;
  /** Epoch ms when the request was created. */
  requestedAt: number;
  /** Epoch ms when the request auto-expires (auto-deny). */
  expiresAt: number;
  /** Optional correlation ID for tracing. */
  correlationId?: string;
}

export interface ApprovalDecision {
  /** The request this decision applies to. */
  requestId: string;
  /** Whether the request was approved. */
  approved: boolean;
  /** User ID of the person who decided. */
  decidedBy: string;
  /** Epoch ms when the decision was made. */
  decidedAt: number;
  /** Optional reason for the decision. */
  reason?: string;
}

// ──────────────────────────────────────────────────────
// Redis key constants
// ──────────────────────────────────────────────────────

const QUEUE_KEY = "mcp:approvals:pending";
const REQUEST_PREFIX = "mcp:approval:";
const DECISION_PREFIX = "mcp:approval:decision:";
const CHANNEL_PREFIX = "mcp:approval:ch:";

// ──────────────────────────────────────────────────────
// ApprovalQueue
// ──────────────────────────────────────────────────────

/**
 * Redis-backed approval queue for tier-3 human-in-the-loop consent.
 *
 * When an agent attempts to invoke a tool that requires explicit user
 * approval, the request is enqueued here. A human operator can then
 * approve or deny via the dashboard. If no decision is made within
 * the TTL (default 5 minutes), the request is **auto-denied**.
 *
 * Communication between the bridge (which waits) and the dashboard
 * (which decides) uses Redis Pub/Sub.
 */
export class ApprovalQueue {
  /** Default time-to-live for pending requests (5 minutes). */
  private static readonly DEFAULT_TTL_MS = 5 * 60 * 1000;

  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  // ── Public API ────────────────────────────────────

  /**
   * Enqueues a new approval request.
   *
   * Generates a unique ID, sets timestamps, stores the full request
   * in a Redis hash, and adds it to a sorted set keyed by expiration
   * time for efficient cleanup.
   *
   * @param request - Request data (without id, requestedAt, expiresAt)
   * @returns The fully-formed ApprovalRequest with generated fields
   */
  async enqueue(
    request: Omit<ApprovalRequest, "id" | "requestedAt" | "expiresAt">,
  ): Promise<ApprovalRequest> {
    const now = Date.now();
    const id = randomUUID();

    const fullRequest: ApprovalRequest = {
      ...request,
      id,
      requestedAt: now,
      expiresAt: now + ApprovalQueue.DEFAULT_TTL_MS,
    };

    const requestKey = `${REQUEST_PREFIX}${id}`;
    const ttlSeconds = Math.ceil(ApprovalQueue.DEFAULT_TTL_MS / 1000) + 30; // extra buffer

    // Store full request as a hash
    await this.redis.hset(requestKey, {
      id: fullRequest.id,
      agentId: fullRequest.agentId,
      toolId: fullRequest.toolId,
      toolName: fullRequest.toolName,
      action: fullRequest.action,
      input: JSON.stringify(fullRequest.input),
      requestedAt: fullRequest.requestedAt.toString(),
      expiresAt: fullRequest.expiresAt.toString(),
      ...(fullRequest.correlationId ? { correlationId: fullRequest.correlationId } : {}),
    });

    // Set TTL on the request hash
    await this.redis.expire(requestKey, ttlSeconds);

    // Add to sorted set (score = expiresAt for efficient expiry scans)
    await this.redis.zadd(QUEUE_KEY, fullRequest.expiresAt, id);

    return fullRequest;
  }

  /**
   * Records a decision for a pending approval request.
   *
   * Stores the decision, removes the request from the pending queue,
   * and publishes the decision via Redis Pub/Sub so that any waiters
   * are notified immediately.
   *
   * @param requestId - The approval request ID
   * @param decision  - The decision (without requestId)
   * @throws If the request has already been decided or does not exist
   */
  async decide(requestId: string, decision: Omit<ApprovalDecision, "requestId">): Promise<void> {
    const requestKey = `${REQUEST_PREFIX}${requestId}`;
    const decisionKey = `${DECISION_PREFIX}${requestId}`;
    const channel = `${CHANNEL_PREFIX}${requestId}`;

    // Verify the request exists
    const exists = await this.redis.exists(requestKey);
    if (!exists) {
      throw new Error(`Approval request "${requestId}" not found or already expired`);
    }

    // Check if already decided
    const alreadyDecided = await this.redis.exists(decisionKey);
    if (alreadyDecided) {
      throw new Error(`Approval request "${requestId}" has already been decided`);
    }

    const fullDecision: ApprovalDecision = {
      requestId,
      ...decision,
    };

    // Store the decision
    await this.redis.hset(decisionKey, {
      requestId: fullDecision.requestId,
      approved: fullDecision.approved ? "true" : "false",
      decidedBy: fullDecision.decidedBy,
      decidedAt: fullDecision.decidedAt.toString(),
      ...(fullDecision.reason ? { reason: fullDecision.reason } : {}),
    });

    // TTL on decision (keep for auditing, 1 hour)
    await this.redis.expire(decisionKey, 3600);

    // Remove from pending sorted set
    await this.redis.zrem(QUEUE_KEY, requestId);

    // Publish decision so waiters are notified
    await this.redis.publish(channel, JSON.stringify(fullDecision));
  }

  /**
   * Waits for a decision on a pending approval request.
   *
   * Subscribes to the Redis Pub/Sub channel for this request and
   * blocks until a decision is published or the timeout elapses.
   * On timeout the request is **auto-denied**.
   *
   * @param requestId - The approval request ID to wait on
   * @param timeoutMs - Maximum wait time (defaults to DEFAULT_TTL_MS)
   * @returns The approval decision
   */
  async waitForDecision(requestId: string, timeoutMs?: number): Promise<ApprovalDecision> {
    const effectiveTimeout = timeoutMs ?? ApprovalQueue.DEFAULT_TTL_MS;
    const channel = `${CHANNEL_PREFIX}${requestId}`;

    // Check if a decision was already made before we subscribe
    const existingDecision = await this.getDecision(requestId);
    if (existingDecision) {
      return existingDecision;
    }

    // Create a dedicated subscriber connection (Redis Pub/Sub requires it)
    const subscriber = this.redis.duplicate();

    try {
      return await new Promise<ApprovalDecision>((resolve, reject) => {
        const timeout = setTimeout(async () => {
          // Auto-deny on timeout
          try {
            await subscriber.unsubscribe(channel);
          } catch {
            // Ignore unsubscribe errors during cleanup
          }
          subscriber.disconnect();

          const autoDeny: ApprovalDecision = {
            requestId,
            approved: false,
            decidedBy: "system:auto-deny",
            decidedAt: Date.now(),
            reason: "Request expired without a decision (auto-denied)",
          };

          // Store the auto-deny decision
          try {
            await this.storeAutoDenyDecision(requestId, autoDeny);
          } catch {
            // Best effort: if this fails the request simply expires
          }

          resolve(autoDeny);
        }, effectiveTimeout);

        subscriber.subscribe(channel, (err) => {
          if (err) {
            clearTimeout(timeout);
            subscriber.disconnect();
            reject(new Error(`Failed to subscribe to approval channel: ${err.message}`));
          }
        });

        subscriber.on("message", (_ch: string, message: string) => {
          clearTimeout(timeout);
          subscriber.disconnect();

          try {
            const decision = JSON.parse(message) as ApprovalDecision;
            resolve(decision);
          } catch {
            reject(new Error("Failed to parse approval decision message"));
          }
        });
      });
    } catch (error) {
      subscriber.disconnect();
      throw error;
    }
  }

  /**
   * Returns all non-expired pending approval requests.
   *
   * @param limit - Maximum number of requests to return (default 50)
   * @returns Array of pending approval requests
   */
  async getPendingRequests(limit = 50): Promise<ApprovalRequest[]> {
    const now = Date.now();

    // Get request IDs from sorted set where score (expiresAt) > now
    const ids = await this.redis.zrangebyscore(QUEUE_KEY, now, "+inf", "LIMIT", 0, limit);

    const requests: ApprovalRequest[] = [];

    for (const id of ids) {
      const requestKey = `${REQUEST_PREFIX}${id}`;
      const raw = await this.redis.hgetall(requestKey);

      if (raw && Object.keys(raw).length > 0) {
        requests.push(this.parseRequest(raw));
      }
    }

    return requests;
  }

  /**
   * Cleans up expired requests from the pending queue.
   *
   * Removes all requests whose `expiresAt` timestamp has passed,
   * auto-denying each one so that any late-arriving waiters get
   * a definitive answer.
   *
   * @returns The number of expired requests cleaned up
   */
  async cleanExpired(): Promise<number> {
    const now = Date.now();

    // Get all expired request IDs (score <= now)
    const expiredIds = await this.redis.zrangebyscore(QUEUE_KEY, 0, now);

    if (expiredIds.length === 0) {
      return 0;
    }

    let cleaned = 0;

    for (const id of expiredIds) {
      const decisionKey = `${DECISION_PREFIX}${id}`;

      // Only auto-deny if not already decided
      const alreadyDecided = await this.redis.exists(decisionKey);
      if (!alreadyDecided) {
        const autoDeny: ApprovalDecision = {
          requestId: id,
          approved: false,
          decidedBy: "system:auto-deny",
          decidedAt: now,
          reason: "Request expired without a decision (auto-denied)",
        };

        await this.storeAutoDenyDecision(id, autoDeny);
      }

      // Remove from pending queue
      await this.redis.zrem(QUEUE_KEY, id);

      // Clean up the request hash
      const requestKey = `${REQUEST_PREFIX}${id}`;
      await this.redis.del(requestKey);

      cleaned++;
    }

    return cleaned;
  }

  /**
   * Retrieves the decision for a specific approval request, if one exists.
   *
   * @param requestId - The approval request ID
   * @returns The decision, or null if no decision has been made
   */
  async getDecision(requestId: string): Promise<ApprovalDecision | null> {
    const decisionKey = `${DECISION_PREFIX}${requestId}`;
    const raw = await this.redis.hgetall(decisionKey);

    if (!raw || Object.keys(raw).length === 0) {
      return null;
    }

    return {
      requestId: raw.requestId ?? requestId,
      approved: raw.approved === "true",
      decidedBy: raw.decidedBy ?? "unknown",
      decidedAt: Number(raw.decidedAt ?? "0"),
      ...(raw.reason ? { reason: raw.reason } : {}),
    };
  }

  // ── Private helpers ───────────────────────────────

  /**
   * Stores an auto-deny decision and publishes it to the channel.
   */
  private async storeAutoDenyDecision(
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const decisionKey = `${DECISION_PREFIX}${requestId}`;
    const channel = `${CHANNEL_PREFIX}${requestId}`;

    await this.redis.hset(decisionKey, {
      requestId: decision.requestId,
      approved: "false",
      decidedBy: decision.decidedBy,
      decidedAt: decision.decidedAt.toString(),
      ...(decision.reason ? { reason: decision.reason } : {}),
    });

    await this.redis.expire(decisionKey, 3600);
    await this.redis.zrem(QUEUE_KEY, requestId);
    await this.redis.publish(channel, JSON.stringify(decision));
  }

  /**
   * Parses a raw Redis hash into an ApprovalRequest.
   */
  private parseRequest(raw: Record<string, string>): ApprovalRequest {
    let input: Record<string, unknown> = {};
    try {
      input = JSON.parse(raw.input ?? "{}") as Record<string, unknown>;
    } catch {
      // Use empty object if input parsing fails
    }

    return {
      id: raw.id ?? "",
      agentId: raw.agentId ?? "",
      toolId: raw.toolId ?? "",
      toolName: raw.toolName ?? "",
      action: raw.action ?? "",
      input,
      requestedAt: Number(raw.requestedAt ?? "0"),
      expiresAt: Number(raw.expiresAt ?? "0"),
      ...(raw.correlationId ? { correlationId: raw.correlationId } : {}),
    };
  }
}
