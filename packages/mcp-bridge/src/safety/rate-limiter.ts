import type Redis from "ioredis";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of tokens remaining in the bucket after this request. */
  remaining: number;
  /** Milliseconds until the bucket fully refills. */
  resetMs: number;
  /** If not allowed, milliseconds the caller should wait before retrying. */
  retryAfterMs?: number;
}

export interface RateLimitConfig {
  /** Token bucket capacity. */
  maxTokens: number;
  /** Tokens added per second. */
  refillRate: number;
  /** Time window (in ms) used for key TTL bookkeeping. */
  windowMs: number;
}

// ──────────────────────────────────────────────────────
// Lua script for atomic token-bucket rate limiting
// ──────────────────────────────────────────────────────

/**
 * Atomic Lua script executed inside Redis.
 *
 * KEYS[1] - the rate-limit key
 * ARGV[1] - maxTokens  (bucket capacity)
 * ARGV[2] - refillRate (tokens per second)
 * ARGV[3] - now        (current time in milliseconds)
 *
 * Returns: [allowed (0|1), remaining, retryAfterMs]
 */
const TOKEN_BUCKET_SCRIPT = `
local key         = KEYS[1]
local maxTokens   = tonumber(ARGV[1])
local refillRate  = tonumber(ARGV[2])
local now         = tonumber(ARGV[3])

-- Retrieve current bucket state
local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens     = tonumber(bucket[1])
local lastRefill = tonumber(bucket[2])

-- Initialise bucket on first access
if tokens == nil or lastRefill == nil then
  tokens     = maxTokens
  lastRefill = now
end

-- Calculate how many tokens to add since the last refill
local elapsed   = math.max(0, now - lastRefill)
local newTokens = elapsed * refillRate / 1000
tokens          = math.min(maxTokens, tokens + newTokens)
lastRefill      = now

-- Try to consume one token
local allowed      = 0
local retryAfterMs = 0

if tokens >= 1 then
  tokens  = tokens - 1
  allowed = 1
else
  -- Calculate how long the caller must wait for 1 token
  retryAfterMs = math.ceil((1 - tokens) / refillRate * 1000)
end

-- Persist state with a TTL equal to the full refill time + buffer
local ttlSec = math.ceil(maxTokens / refillRate) + 10
redis.call('HMSET', key, 'tokens', tostring(tokens), 'lastRefill', tostring(lastRefill))
redis.call('EXPIRE', key, ttlSec)

return { allowed, math.floor(tokens), retryAfterMs }
`;

// ──────────────────────────────────────────────────────
// RateLimiter
// ──────────────────────────────────────────────────────

/**
 * Token-bucket rate limiter backed by Redis.
 *
 * Uses a Lua script for atomic check-and-decrement so that
 * concurrent callers cannot over-consume tokens.
 */
export class RateLimiter {
  private redis: Redis;
  private defaultConfig: RateLimitConfig;

  constructor(redis: Redis, defaultConfig?: Partial<RateLimitConfig>) {
    this.redis = redis;
    this.defaultConfig = {
      maxTokens: defaultConfig?.maxTokens ?? 60,
      refillRate: defaultConfig?.refillRate ?? 1, // 1 token/s = 60/min
      windowMs: defaultConfig?.windowMs ?? 60_000,
    };
  }

  // ── Core ──────────────────────────────────────────

  /**
   * Checks (and, if allowed, consumes) a single token from the bucket
   * identified by {@link key}.
   *
   * @param key    - Unique rate-limit key (e.g. `mcp:rl:agent:<id>:tool:<toolId>`)
   * @param config - Optional per-call override of the default bucket config
   */
  async checkLimit(key: string, config?: Partial<RateLimitConfig>): Promise<RateLimitResult> {
    const cfg: RateLimitConfig = {
      maxTokens: config?.maxTokens ?? this.defaultConfig.maxTokens,
      refillRate: config?.refillRate ?? this.defaultConfig.refillRate,
      windowMs: config?.windowMs ?? this.defaultConfig.windowMs,
    };

    const now = Date.now();

    const result = (await this.redis.eval(
      TOKEN_BUCKET_SCRIPT,
      1,
      key,
      cfg.maxTokens,
      cfg.refillRate,
      now,
    )) as [number, number, number];

    const [allowed, remaining, retryAfterMs] = result;

    // resetMs: time until the bucket would be fully refilled from current
    const tokensNeeded = cfg.maxTokens - (remaining ?? 0);
    const resetMs = tokensNeeded > 0 ? Math.ceil((tokensNeeded / cfg.refillRate) * 1000) : 0;

    return {
      allowed: allowed === 1,
      remaining: remaining ?? 0,
      resetMs,
      ...(allowed === 0 ? { retryAfterMs: retryAfterMs ?? 0 } : {}),
    };
  }

  // ── Convenience ───────────────────────────────────

  /**
   * Per-agent, per-tool rate limit check.
   */
  async checkAgentLimit(
    agentId: string,
    toolId: string,
    config?: Partial<RateLimitConfig>,
  ): Promise<RateLimitResult> {
    return this.checkLimit(`mcp:rl:agent:${agentId}:tool:${toolId}`, config);
  }

  /**
   * Global per-tool rate limit check (shared across all agents).
   */
  async checkGlobalLimit(
    toolId: string,
    config?: Partial<RateLimitConfig>,
  ): Promise<RateLimitResult> {
    return this.checkLimit(`mcp:rl:global:tool:${toolId}`, config);
  }

  /**
   * Resets (deletes) a specific rate-limit bucket.
   */
  async reset(key: string): Promise<void> {
    await this.redis.del(key);
  }
}
