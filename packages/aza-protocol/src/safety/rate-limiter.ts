import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";

// ──────────────────────────────────────────────────────
// AZA Rate Limiter
// ──────────────────────────────────────────────────────
// Token-bucket-style rate limiter using Redis sorted sets
// as a sliding window counter. Each agent has independent
// outbound and inbound limits.
//
// Implementation: Sliding window log using ZADD/ZRANGEBYSCORE.
//   - Each request adds a timestamped entry to a sorted set.
//   - Expired entries (older than the window) are pruned.
//   - The count of remaining entries determines the rate.
//
// Redis key conventions:
//   aza:ratelimit:outbound:<agentDid>
//   aza:ratelimit:inbound:<agentDid>
// ──────────────────────────────────────────────────────

/** Default outbound rate limit: 100 messages per minute. */
const DEFAULT_OUTBOUND_PER_MINUTE = 100;

/** Default inbound rate limit: 200 messages per minute. */
const DEFAULT_INBOUND_PER_MINUTE = 200;

/** Sliding window size in milliseconds (1 minute). */
const WINDOW_MS = 60_000;

/** Redis key prefix for rate limiting. */
const RATE_LIMIT_PREFIX = "aza:ratelimit";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export interface AZARateLimitConfig {
  outboundPerMinute: number;
  inboundPerMinute: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  retryAfterMs?: number;
}

// ──────────────────────────────────────────────────────
// Rate Limiter
// ──────────────────────────────────────────────────────

export class AZARateLimiter {
  private readonly outboundPerMinute: number;
  private readonly inboundPerMinute: number;

  constructor(
    private redis: Redis,
    config?: Partial<AZARateLimitConfig>,
  ) {
    this.outboundPerMinute = config?.outboundPerMinute ?? DEFAULT_OUTBOUND_PER_MINUTE;
    this.inboundPerMinute = config?.inboundPerMinute ?? DEFAULT_INBOUND_PER_MINUTE;
  }

  /**
   * Check whether an outbound message from this agent is allowed.
   * If allowed, the request is recorded in the sliding window.
   */
  async checkOutbound(agentDid: string): Promise<RateLimitResult> {
    const key = `${RATE_LIMIT_PREFIX}:outbound:${agentDid}`;
    return this.checkLimit(key, this.outboundPerMinute);
  }

  /**
   * Check whether an inbound message to this agent is allowed.
   * If allowed, the request is recorded in the sliding window.
   */
  async checkInbound(agentDid: string): Promise<RateLimitResult> {
    const key = `${RATE_LIMIT_PREFIX}:inbound:${agentDid}`;
    return this.checkLimit(key, this.inboundPerMinute);
  }

  /**
   * Reset all rate limit counters for an agent (both inbound and outbound).
   */
  async reset(agentDid: string): Promise<void> {
    const outboundKey = `${RATE_LIMIT_PREFIX}:outbound:${agentDid}`;
    const inboundKey = `${RATE_LIMIT_PREFIX}:inbound:${agentDid}`;
    await this.redis.del(outboundKey, inboundKey);
  }

  // ────────────────────────────────────────────────────
  // Private: Sliding Window Counter
  // ────────────────────────────────────────────────────

  /**
   * Sliding window rate limit check using Redis sorted sets.
   *
   * Algorithm (atomic via MULTI/EXEC pipeline):
   *   1. ZREMRANGEBYSCORE to prune entries older than the window.
   *   2. ZCARD to count current entries in the window.
   *   3. If under limit: ZADD the new entry with timestamp as score.
   *   4. EXPIRE the key to auto-clean after the window elapses.
   *
   * The member value uses `timestamp:random` to ensure uniqueness
   * even when multiple requests arrive at the same millisecond.
   */
  private async checkLimit(key: string, maxPerMinute: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    // Execute as a pipeline for atomicity
    const pipeline = this.redis.multi();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zcard(key);

    const results = await pipeline.exec();

    if (!results) {
      throw new AZAError(
        AZAErrorCode.RATE_LIMITED,
        "Rate limit check failed: Redis MULTI/EXEC returned null",
        { details: { key } },
      );
    }

    // results[1] is the ZCARD result: [error, count]
    const [zcardError, currentCount] = results[1] as [Error | null, number];
    if (zcardError) {
      throw new AZAError(AZAErrorCode.RATE_LIMITED, "Rate limit check failed: ZCARD error", {
        details: { key },
        cause: zcardError,
      });
    }

    if (currentCount >= maxPerMinute) {
      // Over the limit — calculate when the oldest entry will expire
      const oldestEntries = await this.redis.zrangebyscore(key, "-inf", "+inf", "LIMIT", 0, 1);
      const oldestScore =
        oldestEntries.length > 0 ? await this.redis.zscore(key, oldestEntries[0]!) : null;

      const retryAfterMs = oldestScore
        ? Math.max(0, Number(oldestScore) + WINDOW_MS - now)
        : WINDOW_MS;

      return {
        allowed: false,
        remaining: 0,
        resetMs: retryAfterMs,
        retryAfterMs,
      };
    }

    // Under the limit — record this request
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    await this.redis
      .multi()
      .zadd(key, now, member)
      .expire(key, Math.ceil(WINDOW_MS / 1000) + 1)
      .exec();

    const remaining = maxPerMinute - currentCount - 1;

    return {
      allowed: true,
      remaining: Math.max(0, remaining),
      resetMs: WINDOW_MS,
    };
  }
}
