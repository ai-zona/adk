import type Redis from "ioredis";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** Failure rate (0-100) over the monitor window that triggers opening. */
  failureRateThreshold: number;
  /** Milliseconds to wait before transitioning from OPEN to HALF_OPEN. */
  resetTimeoutMs: number;
  /** Maximum test requests allowed while HALF_OPEN. */
  halfOpenMaxAttempts: number;
  /** Window (in ms) over which the failure rate is calculated. */
  monitorWindowMs: number;
}

export interface CircuitStatus {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure?: Date;
  lastStateChange: Date;
}

// ──────────────────────────────────────────────────────
// Redis key layout
// ──────────────────────────────────────────────────────
// Each circuit stores a Redis hash:
//   state          - "CLOSED" | "OPEN" | "HALF_OPEN"
//   failures       - total failures in current window
//   successes      - total successes in current window
//   halfOpenAttempts - attempts since entering HALF_OPEN
//   lastFailure    - epoch ms of last failure
//   lastStateChange - epoch ms of last state change
//   windowStart    - epoch ms when the current monitor window began

// ──────────────────────────────────────────────────────
// Default configuration
// ──────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  failureRateThreshold: 50,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 3,
  monitorWindowMs: 60_000,
};

// ──────────────────────────────────────────────────────
// CircuitBreaker
// ──────────────────────────────────────────────────────

/**
 * Implements the circuit-breaker pattern for MCP tool invocations.
 *
 * State machine:
 * ```
 *  CLOSED  ──(threshold exceeded)──>  OPEN
 *  OPEN    ──(resetTimeout elapsed)──>  HALF_OPEN
 *  HALF_OPEN ──(success streak)──>  CLOSED
 *  HALF_OPEN ──(any failure)──>  OPEN
 * ```
 *
 * State is stored in Redis so that it is shared across multiple
 * bridge instances.
 */
export class CircuitBreaker {
  private redis: Redis;
  private config: CircuitBreakerConfig;

  constructor(redis: Redis, defaultConfig?: Partial<CircuitBreakerConfig>) {
    this.redis = redis;
    this.config = { ...DEFAULT_CONFIG, ...defaultConfig };
  }

  // ── Static key generators ─────────────────────────

  static toolKey(toolId: string): string {
    return `mcp:circuit:tool:${toolId}`;
  }

  static agentKey(agentId: string): string {
    return `mcp:circuit:agent:${agentId}`;
  }

  static globalKey(): string {
    return "mcp:circuit:global";
  }

  // ── Public API ────────────────────────────────────

  /**
   * Determines whether a request may be executed through the circuit
   * identified by {@link circuitKey}.
   *
   * - **CLOSED**: always allowed.
   * - **OPEN**: allowed only if the reset timeout has elapsed (transitions
   *   to HALF_OPEN first).
   * - **HALF_OPEN**: allowed only if fewer than
   *   `halfOpenMaxAttempts` have been made.
   */
  async canExecute(circuitKey: string): Promise<boolean> {
    const status = await this.loadState(circuitKey);
    const now = Date.now();

    switch (status.state) {
      case "CLOSED":
        return true;

      case "OPEN": {
        // Check if the reset timeout has elapsed
        const elapsed = now - status.lastStateChange.getTime();
        if (elapsed >= this.config.resetTimeoutMs) {
          // Transition to HALF_OPEN
          await this.setState(circuitKey, "HALF_OPEN");
          return true;
        }
        return false;
      }

      case "HALF_OPEN": {
        const attempts = await this.getHalfOpenAttempts(circuitKey);
        if (attempts < this.config.halfOpenMaxAttempts) {
          await this.incrementHalfOpenAttempts(circuitKey);
          return true;
        }
        return false;
      }

      default:
        return false;
    }
  }

  /**
   * Records a successful invocation. In HALF_OPEN state, enough
   * consecutive successes will close the circuit.
   */
  async recordSuccess(circuitKey: string): Promise<void> {
    const status = await this.loadState(circuitKey);

    if (status.state === "HALF_OPEN") {
      const successes = status.successes + 1;
      await this.redis.hset(circuitKey, "successes", successes.toString());

      // If we've reached enough successes in half-open, close the circuit
      if (successes >= this.config.halfOpenMaxAttempts) {
        await this.resetCircuit(circuitKey);
      }
      return;
    }

    // In CLOSED state, just increment successes (resets window if stale)
    if (status.state === "CLOSED") {
      await this.maybeResetWindow(circuitKey);
      await this.redis.hincrby(circuitKey, "successes", 1);
    }
  }

  /**
   * Records a failed invocation. May cause the circuit to open.
   */
  async recordFailure(circuitKey: string): Promise<void> {
    const now = Date.now();
    const status = await this.loadState(circuitKey);

    if (status.state === "HALF_OPEN") {
      // Any failure in HALF_OPEN immediately re-opens the circuit
      await this.setState(circuitKey, "OPEN");
      await this.redis.hset(circuitKey, "lastFailure", now.toString());
      return;
    }

    // CLOSED state
    await this.maybeResetWindow(circuitKey);
    const newFailures = await this.redis.hincrby(circuitKey, "failures", 1);
    await this.redis.hset(circuitKey, "lastFailure", now.toString());

    // Check absolute threshold
    if (newFailures >= this.config.failureThreshold) {
      await this.setState(circuitKey, "OPEN");
      return;
    }

    // Check failure rate threshold
    const successes = Number((await this.redis.hget(circuitKey, "successes")) ?? "0");
    const total = newFailures + successes;
    if (total > 0) {
      const failureRate = (newFailures / total) * 100;
      if (
        failureRate >= this.config.failureRateThreshold &&
        total >= 5 // require a minimum sample size
      ) {
        await this.setState(circuitKey, "OPEN");
      }
    }
  }

  /**
   * Returns the current status of a circuit.
   */
  async getStatus(circuitKey: string): Promise<CircuitStatus> {
    return this.loadState(circuitKey);
  }

  /**
   * Manually forces a circuit into the OPEN state (emergency stop).
   */
  async forceOpen(circuitKey: string): Promise<void> {
    await this.setState(circuitKey, "OPEN");
  }

  /**
   * Manually forces a circuit back to CLOSED (manual recovery).
   */
  async forceClose(circuitKey: string): Promise<void> {
    await this.resetCircuit(circuitKey);
  }

  // ── Private helpers ───────────────────────────────

  /**
   * Loads the full circuit state from Redis, returning sensible defaults
   * for a brand-new (nonexistent) circuit.
   */
  private async loadState(circuitKey: string): Promise<CircuitStatus> {
    const raw = await this.redis.hgetall(circuitKey);
    const now = Date.now();

    if (!raw || Object.keys(raw).length === 0) {
      // Circuit does not exist yet; treat as CLOSED
      return {
        state: "CLOSED",
        failures: 0,
        successes: 0,
        lastStateChange: new Date(now),
      };
    }

    return {
      state: (raw.state as CircuitState) ?? "CLOSED",
      failures: Number(raw.failures ?? "0"),
      successes: Number(raw.successes ?? "0"),
      lastFailure: raw.lastFailure ? new Date(Number(raw.lastFailure)) : undefined,
      lastStateChange: new Date(Number(raw.lastStateChange ?? now.toString())),
    };
  }

  /**
   * Transitions a circuit to a new state, recording the timestamp.
   */
  private async setState(circuitKey: string, state: CircuitState): Promise<void> {
    const now = Date.now();
    await this.redis.hset(circuitKey, "state", state, "lastStateChange", now.toString());

    if (state === "HALF_OPEN") {
      // Reset counters for the half-open probe period
      await this.redis.hset(circuitKey, "successes", "0", "halfOpenAttempts", "0");
    }

    // Ensure the key does not live forever
    await this.setKeyTTL(circuitKey);
  }

  /**
   * Fully resets a circuit to the CLOSED state with zero counters.
   */
  private async resetCircuit(circuitKey: string): Promise<void> {
    const now = Date.now();
    await this.redis.hmset(circuitKey, {
      state: "CLOSED",
      failures: "0",
      successes: "0",
      halfOpenAttempts: "0",
      lastStateChange: now.toString(),
      windowStart: now.toString(),
    });
    await this.setKeyTTL(circuitKey);
  }

  /**
   * If the current monitoring window has expired, resets the counters.
   */
  private async maybeResetWindow(circuitKey: string): Promise<void> {
    const now = Date.now();
    const windowStart = Number((await this.redis.hget(circuitKey, "windowStart")) ?? "0");

    if (now - windowStart > this.config.monitorWindowMs) {
      await this.redis.hset(
        circuitKey,
        "failures",
        "0",
        "successes",
        "0",
        "windowStart",
        now.toString(),
      );
    }
  }

  private async getHalfOpenAttempts(circuitKey: string): Promise<number> {
    return Number((await this.redis.hget(circuitKey, "halfOpenAttempts")) ?? "0");
  }

  private async incrementHalfOpenAttempts(circuitKey: string): Promise<void> {
    await this.redis.hincrby(circuitKey, "halfOpenAttempts", 1);
  }

  /**
   * Sets a generous TTL on the circuit key so stale circuits do not
   * accumulate indefinitely.
   */
  private async setKeyTTL(circuitKey: string): Promise<void> {
    // Keep state for at least 3x the reset timeout, minimum 5 minutes
    const ttlMs = Math.max(this.config.resetTimeoutMs * 3, 5 * 60_000);
    const ttlSec = Math.ceil(ttlMs / 1000);
    await this.redis.expire(circuitKey, ttlSec);
  }
}
