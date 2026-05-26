import type Redis from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../safety/circuit-breaker";
import { RateLimiter } from "../safety/rate-limiter";
import { type InMemoryRedis, createRedisStub } from "./helpers/in-memory-redis";

// ──────────────────────────────────────────────────────
// RateLimiter — token bucket correctness
// ──────────────────────────────────────────────────────

describe("mcp-bridge RateLimiter", () => {
  let redis: InMemoryRedis;

  beforeEach(() => {
    redis = createRedisStub();
  });

  // ── Test 1: token-bucket consumes and denies when empty ─

  it("allows up to maxTokens requests then denies with retry-after", async () => {
    // Deterministic token-bucket simulation keyed off the stub.
    // The RateLimiter invokes `redis.eval(script, 1, key, maxTokens, refillRate, now)`.
    // We override eval to implement the bucket math in-memory for the assertion.
    const state = new Map<string, { tokens: number; lastRefill: number }>();

    redis.evalScriptOverride = (_script, args): [number, number, number] => {
      // args: [maxTokens, refillRate, now]
      const maxTokens = Number(args[0]);
      const refillRate = Number(args[1]);
      const now = Number(args[2]);
      const key = "bucket-key"; // single bucket in this test
      const s = state.get(key) ?? { tokens: maxTokens, lastRefill: now };
      const elapsed = Math.max(0, now - s.lastRefill);
      s.tokens = Math.min(maxTokens, s.tokens + (elapsed * refillRate) / 1000);
      s.lastRefill = now;

      if (s.tokens >= 1) {
        s.tokens -= 1;
        state.set(key, s);
        return [1, Math.floor(s.tokens), 0];
      }
      const retry = Math.ceil(((1 - s.tokens) / refillRate) * 1000);
      state.set(key, s);
      return [0, 0, retry];
    };

    const limiter = new RateLimiter(redis as unknown as Redis, {
      maxTokens: 3,
      refillRate: 1,
      windowMs: 1000,
    });

    // First 3 requests succeed
    for (let i = 0; i < 3; i++) {
      const r = await limiter.checkAgentLimit("a", "t");
      expect(r.allowed).toBe(true);
    }

    // 4th request is denied with retry-after
    const denied = await limiter.checkAgentLimit("a", "t");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  // ── Test 2: checkAgentLimit uses agent+tool namespaced key ─

  it("namespaces keys by agent AND tool for isolation", async () => {
    const spy = vi.spyOn(redis, "eval");

    const limiter = new RateLimiter(redis as unknown as Redis);
    await limiter.checkAgentLimit("agent-alpha", "tool-beta");

    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "mcp:rl:agent:agent-alpha:tool:tool-beta",
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });
});

// ──────────────────────────────────────────────────────
// CircuitBreaker — state transitions
// ──────────────────────────────────────────────────────

describe("mcp-bridge CircuitBreaker state machine", () => {
  let redis: InMemoryRedis;

  beforeEach(() => {
    redis = createRedisStub();
  });

  // ── Test 3: CLOSED -> OPEN on threshold ─────────────

  it("transitions CLOSED -> OPEN after failure threshold is reached", async () => {
    const breaker = new CircuitBreaker(redis as unknown as Redis, {
      failureThreshold: 3,
      failureRateThreshold: 100, // avoid early open on rate
      resetTimeoutMs: 60_000,
      halfOpenMaxAttempts: 2,
      monitorWindowMs: 60_000,
    });

    const key = CircuitBreaker.toolKey("tool-xyz");

    // New circuit is CLOSED
    let status = await breaker.getStatus(key);
    expect(status.state).toBe("CLOSED");
    expect(await breaker.canExecute(key)).toBe(true);

    // Record failures up to but not beyond threshold
    await breaker.recordFailure(key);
    await breaker.recordFailure(key);
    status = await breaker.getStatus(key);
    expect(status.state).toBe("CLOSED");

    // Third failure hits threshold -> OPEN
    await breaker.recordFailure(key);
    status = await breaker.getStatus(key);
    expect(status.state).toBe("OPEN");
    expect(await breaker.canExecute(key)).toBe(false);
  });

  // ── Test 4: OPEN -> HALF_OPEN -> CLOSED recovery ────

  it("transitions OPEN -> HALF_OPEN after timeout, then CLOSED on successes", async () => {
    const breaker = new CircuitBreaker(redis as unknown as Redis, {
      failureThreshold: 2,
      failureRateThreshold: 100,
      resetTimeoutMs: 10, // very short for deterministic timing
      halfOpenMaxAttempts: 2,
      monitorWindowMs: 60_000,
    });

    const key = CircuitBreaker.toolKey("tool-recover");

    // Force OPEN via failures
    await breaker.recordFailure(key);
    await breaker.recordFailure(key);
    expect((await breaker.getStatus(key)).state).toBe("OPEN");
    expect(await breaker.canExecute(key)).toBe(false);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 30));

    // canExecute returning true must also transition state to HALF_OPEN
    expect(await breaker.canExecute(key)).toBe(true);
    expect((await breaker.getStatus(key)).state).toBe("HALF_OPEN");

    // Record enough successes in HALF_OPEN to close the circuit
    // halfOpenMaxAttempts = 2, so 2 successes close it.
    await breaker.recordSuccess(key);
    await breaker.recordSuccess(key);
    expect((await breaker.getStatus(key)).state).toBe("CLOSED");
  });

  // ── Test 5: HALF_OPEN -> OPEN on any failure ────────

  it("transitions HALF_OPEN back to OPEN on a single failure", async () => {
    const breaker = new CircuitBreaker(redis as unknown as Redis, {
      failureThreshold: 1,
      failureRateThreshold: 100,
      resetTimeoutMs: 5,
      halfOpenMaxAttempts: 3,
      monitorWindowMs: 60_000,
    });

    const key = CircuitBreaker.toolKey("tool-halfopen-fail");

    // Open the circuit
    await breaker.recordFailure(key);
    expect((await breaker.getStatus(key)).state).toBe("OPEN");

    // Wait + probe to enter HALF_OPEN
    await new Promise((r) => setTimeout(r, 20));
    await breaker.canExecute(key);
    expect((await breaker.getStatus(key)).state).toBe("HALF_OPEN");

    // A single failure during HALF_OPEN must re-open the circuit
    await breaker.recordFailure(key);
    expect((await breaker.getStatus(key)).state).toBe("OPEN");
  });
});
