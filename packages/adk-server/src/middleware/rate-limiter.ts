// ──────────────────────────────────────────────────────
// Rate Limiter Middleware (Token Bucket)
// ──────────────────────────────────────────────────────

import type { Context, Next } from "hono";

interface BucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * Simple in-memory token bucket rate limiter.
 * Key: API key ID from c.get("apiKey").
 */
export function rateLimiter(requestsPerMinute: number) {
  const buckets = new Map<string, BucketState>();
  const refillRate = requestsPerMinute / 60; // tokens per second

  return async (c: Context, next: Next) => {
    const apiKey = c.get("apiKey") as { id: string } | undefined;
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-real-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const bucketKey = apiKey?.id ?? ip;

    const now = Date.now() / 1000;
    let bucket = buckets.get(bucketKey);

    if (!bucket) {
      bucket = { tokens: requestsPerMinute, lastRefill: now };
      buckets.set(bucketKey, bucket);
    }

    // Refill tokens
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(requestsPerMinute, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      c.header("Retry-After", String(Math.ceil(1 / refillRate)));
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    bucket.tokens -= 1;
    c.header("X-RateLimit-Limit", String(requestsPerMinute));
    c.header("X-RateLimit-Remaining", String(Math.floor(bucket.tokens)));

    await next();
  };
}
