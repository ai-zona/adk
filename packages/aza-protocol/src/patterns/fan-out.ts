import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { RedisStreamTransport } from "../transport/redis-streams";
import { AZAError, AZAErrorCode } from "../types/errors";
import type { AZAEnvelope } from "../types/messages";

// ──────────────────────────────────────────────────────
// Fan-Out Pattern
// ──────────────────────────────────────────────────────
// 1:N broadcast with configurable aggregation strategies.
//
// Sends a message to multiple target agents and collects
// responses according to one of four strategies:
//   - first:  return immediately after the first response
//   - all:    wait for all targets to respond (or timeout)
//   - quorum: wait for a minimum number of responses
//   - best:   collect all responses, then select the best
//
// Uses Redis pub/sub for lightweight response aggregation
// with a unique channel per fan-out correlation ID.
// ──────────────────────────────────────────────────────

export type AggregationStrategy = "first" | "best" | "all" | "quorum";

export interface FanOutConfig {
  /** DIDs of all target agents to broadcast to. */
  targets: string[];
  /** How to aggregate responses. */
  strategy: AggregationStrategy;
  /** Number of responses required for "quorum" strategy. */
  quorumSize?: number;
  /** Maximum time to wait for responses (milliseconds). */
  timeoutMs: number;
  /** Selector function for "best" strategy. */
  bestSelector?: (responses: AZAEnvelope[]) => AZAEnvelope;
}

export interface FanOutResult {
  /** All responses received within the timeout window. */
  responses: AZAEnvelope[];
  /** DIDs of targets that have not yet responded. */
  pending: string[];
  /** DIDs of targets whose delivery failed. */
  failed: string[];
  /** The aggregation strategy that was used. */
  strategy: AggregationStrategy;
  /** Unix timestamp (ms) when the result was finalized. */
  completedAt: number;
}

/** Redis pub/sub channel prefix for fan-out response aggregation. */
const FANOUT_RESPONSE_PREFIX = "aza:fanout:responses:";

export class FanOutPattern {
  constructor(
    private transport: RedisStreamTransport,
    private redis: Redis,
  ) {}

  /**
   * Execute a fan-out: send a message to all targets and aggregate
   * responses according to the configured strategy.
   *
   * @param fromDid   - The sender's DID.
   * @param envelope  - A partial envelope (without `to`, `id`, `timestamp`).
   * @param config    - Fan-out configuration.
   */
  async execute(
    fromDid: string,
    envelope: Omit<AZAEnvelope, "to" | "id" | "timestamp">,
    config: FanOutConfig,
  ): Promise<FanOutResult> {
    if (config.targets.length === 0) {
      return {
        responses: [],
        pending: [],
        failed: [],
        strategy: config.strategy,
        completedAt: Date.now(),
      };
    }

    if (config.strategy === "quorum") {
      const quorumSize = config.quorumSize ?? Math.ceil(config.targets.length / 2);
      if (quorumSize > config.targets.length) {
        throw new AZAError(
          AZAErrorCode.INVALID_PAYLOAD,
          `Quorum size (${quorumSize}) exceeds target count (${config.targets.length})`,
          { details: { quorumSize, targetCount: config.targets.length } },
        );
      }
    }

    // Generate a unique correlation ID for this fan-out operation
    const correlationId = envelope.correlationId ?? randomUUID();
    const failed: string[] = [];

    // 1. Send the message to all targets
    for (const targetDid of config.targets) {
      const outgoing: AZAEnvelope = {
        ...envelope,
        id: randomUUID(),
        to: targetDid,
        from: fromDid,
        correlationId,
        timestamp: Date.now(),
      } as AZAEnvelope;

      try {
        await this.transport.publish(RedisStreamTransport.agentStream(targetDid), outgoing);
      } catch {
        failed.push(targetDid);
      }
    }

    // 2. Wait for responses using the configured strategy
    const successfulTargets = config.targets.filter((t) => !failed.includes(t));
    const responses = await this.waitForResponses(correlationId, config, successfulTargets.length);

    // 3. Determine pending targets (sent successfully but no response)
    const respondedDids = new Set(responses.map((r) => r.from));
    const pending = successfulTargets.filter((t) => !respondedDids.has(t));

    return {
      responses,
      pending,
      failed,
      strategy: config.strategy,
      completedAt: Date.now(),
    };
  }

  /**
   * Wait for responses on a fan-out correlation channel.
   * Uses Redis pub/sub to collect responses as they arrive.
   *
   * @internal
   */
  private async waitForResponses(
    correlationId: string,
    config: FanOutConfig,
    expectedCount: number,
  ): Promise<AZAEnvelope[]> {
    const channelKey = `${FANOUT_RESPONSE_PREFIX}${correlationId}`;
    const responses: AZAEnvelope[] = [];

    // Determine how many responses we need based on strategy
    let requiredCount: number;
    switch (config.strategy) {
      case "first":
        requiredCount = 1;
        break;
      case "quorum":
        requiredCount = config.quorumSize ?? Math.ceil(expectedCount / 2);
        break;
      case "all":
      case "best":
        requiredCount = expectedCount;
        break;
    }

    if (expectedCount === 0 || requiredCount === 0) {
      return [];
    }

    // Create a duplicate Redis connection for subscribing
    // (ioredis requires a separate connection for pub/sub mode)
    const subscriber = this.redis.duplicate();

    return new Promise<AZAEnvelope[]>((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          subscriber.unsubscribe(channelKey).catch(() => {});
          subscriber.disconnect();
        }
      };

      // Set up the timeout
      const timer = setTimeout(() => {
        cleanup();
        if (config.strategy === "best" && responses.length > 0 && config.bestSelector) {
          const best = config.bestSelector(responses);
          resolve([best]);
        } else {
          resolve(responses);
        }
      }, config.timeoutMs);

      // Subscribe to the response channel
      subscriber.subscribe(channelKey).catch(() => {
        clearTimeout(timer);
        cleanup();
        resolve(responses);
      });

      subscriber.on("message", (_channel: string, message: string) => {
        if (resolved) return;

        try {
          const envelope = JSON.parse(message) as AZAEnvelope;
          responses.push(envelope);

          // Check if we have enough responses
          if (responses.length >= requiredCount) {
            clearTimeout(timer);
            cleanup();

            if (config.strategy === "best" && config.bestSelector) {
              const best = config.bestSelector(responses);
              resolve([best]);
            } else {
              resolve(responses);
            }
          }
        } catch {
          // Skip malformed response messages
        }
      });
    });
  }
}
