import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";

// ──────────────────────────────────────────────────────
// AZA Circuit Breaker
// ──────────────────────────────────────────────────────
// Per-agent circuit breaker to prevent cascading failures.
//
// States:
//   CLOSED    — Normal operation. Requests flow through.
//   OPEN      — Too many failures. Requests are blocked.
//   HALF_OPEN — Testing recovery. Limited requests allowed.
//
// State machine:
//   CLOSED -> OPEN      : failures >= failureThreshold
//   OPEN   -> HALF_OPEN : resetTimeoutMs has elapsed since last state change
//   HALF_OPEN -> CLOSED : a request succeeds
//   HALF_OPEN -> OPEN   : halfOpenMaxAttempts failures in half-open
//
// All state is stored in Redis hashes for distributed consistency.
// Redis key: aza:circuit:<agentDid>
// ──────────────────────────────────────────────────────

/** Default failure threshold before opening the circuit. */
const DEFAULT_FAILURE_THRESHOLD = 10;

/** Default time the circuit stays open before trying half-open (1 minute). */
const DEFAULT_RESET_TIMEOUT_MS = 60_000;

/** Default max attempts in half-open state before re-opening. */
const DEFAULT_HALF_OPEN_MAX_ATTEMPTS = 3;

/** Redis key prefix for circuit breaker state. */
const CIRCUIT_KEY_PREFIX = "aza:circuit";

/** TTL for circuit breaker keys — auto-cleanup after 24 hours of inactivity. */
const CIRCUIT_KEY_TTL_SECONDS = 86_400;

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface AZACircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

/** Internal structure stored in Redis hash. */
interface CircuitData {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastStateChange: number;
  halfOpenAttempts: number;
}

// ──────────────────────────────────────────────────────
// Circuit Breaker
// ──────────────────────────────────────────────────────

export class AZACircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenMaxAttempts: number;

  constructor(
    private redis: Redis,
    config?: Partial<AZACircuitBreakerConfig>,
  ) {
    this.failureThreshold = config?.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    this.resetTimeoutMs = config?.resetTimeoutMs ?? DEFAULT_RESET_TIMEOUT_MS;
    this.halfOpenMaxAttempts = config?.halfOpenMaxAttempts ?? DEFAULT_HALF_OPEN_MAX_ATTEMPTS;
  }

  // ────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────

  /**
   * Check whether a message can be sent to/from this agent.
   * Returns true if the circuit is CLOSED or HALF_OPEN (with attempts remaining).
   * Returns false if the circuit is OPEN.
   *
   * When the circuit is OPEN and the reset timeout has elapsed,
   * it automatically transitions to HALF_OPEN.
   */
  async canSend(agentDid: string): Promise<boolean> {
    const data = await this.loadState(agentDid);

    switch (data.state) {
      case "CLOSED":
        return true;

      case "OPEN": {
        // Check if reset timeout has elapsed
        const elapsed = Date.now() - data.lastStateChange;
        if (elapsed >= this.resetTimeoutMs) {
          // Transition to HALF_OPEN
          await this.transition(agentDid, data, "HALF_OPEN");
          return true;
        }
        return false;
      }

      case "HALF_OPEN":
        // Allow if we haven't exhausted half-open attempts
        return data.halfOpenAttempts < this.halfOpenMaxAttempts;

      default:
        return false;
    }
  }

  /**
   * Record a successful operation for this agent.
   * In HALF_OPEN state, a success transitions back to CLOSED.
   */
  async recordSuccess(agentDid: string): Promise<void> {
    const data = await this.loadState(agentDid);

    if (data.state === "HALF_OPEN") {
      // Success in half-open: circuit closes
      await this.transition(agentDid, data, "CLOSED");
    } else if (data.state === "CLOSED" && data.failures > 0) {
      // Reset failure count on success when closed
      data.failures = 0;
      await this.saveState(agentDid, data);
    }
  }

  /**
   * Record a failed operation for this agent.
   * When failures exceed the threshold, the circuit opens.
   * In HALF_OPEN state, a failure increments the half-open attempt count.
   */
  async recordFailure(agentDid: string): Promise<void> {
    const data = await this.loadState(agentDid);
    const now = Date.now();

    data.failures += 1;
    data.lastFailure = now;

    if (data.state === "CLOSED") {
      if (data.failures >= this.failureThreshold) {
        await this.transition(agentDid, data, "OPEN");
      } else {
        await this.saveState(agentDid, data);
      }
    } else if (data.state === "HALF_OPEN") {
      data.halfOpenAttempts += 1;
      if (data.halfOpenAttempts >= this.halfOpenMaxAttempts) {
        // Too many failures in half-open: re-open
        await this.transition(agentDid, data, "OPEN");
      } else {
        await this.saveState(agentDid, data);
      }
    } else {
      // Already OPEN — just update the failure count
      await this.saveState(agentDid, data);
    }
  }

  /**
   * Get the current circuit state for an agent.
   */
  async getState(agentDid: string): Promise<CircuitState> {
    const data = await this.loadState(agentDid);

    // Check for auto-transition from OPEN -> HALF_OPEN
    if (data.state === "OPEN") {
      const elapsed = Date.now() - data.lastStateChange;
      if (elapsed >= this.resetTimeoutMs) {
        await this.transition(agentDid, data, "HALF_OPEN");
        return "HALF_OPEN";
      }
    }

    return data.state;
  }

  /**
   * Force the circuit into OPEN state (e.g., for administrative purposes).
   */
  async forceOpen(agentDid: string): Promise<void> {
    const data = await this.loadState(agentDid);
    await this.transition(agentDid, data, "OPEN");
  }

  /**
   * Force the circuit into CLOSED state (e.g., after manual intervention).
   */
  async forceClose(agentDid: string): Promise<void> {
    const data = await this.loadState(agentDid);
    data.failures = 0;
    data.halfOpenAttempts = 0;
    await this.transition(agentDid, data, "CLOSED");
  }

  // ────────────────────────────────────────────────────
  // Private: State Management
  // ────────────────────────────────────────────────────

  /**
   * Build the Redis key for a circuit breaker.
   */
  private circuitKey(agentDid: string): string {
    return `${CIRCUIT_KEY_PREFIX}:${agentDid}`;
  }

  /**
   * Load the circuit state from Redis.
   * Returns a default CLOSED state if no data exists.
   */
  private async loadState(agentDid: string): Promise<CircuitData> {
    const key = this.circuitKey(agentDid);
    const raw = await this.redis.hgetall(key);

    if (!raw || Object.keys(raw).length === 0) {
      return {
        state: "CLOSED",
        failures: 0,
        lastFailure: 0,
        lastStateChange: Date.now(),
        halfOpenAttempts: 0,
      };
    }

    return {
      state: (raw.state as CircuitState) || "CLOSED",
      failures: Number(raw.failures) || 0,
      lastFailure: Number(raw.lastFailure) || 0,
      lastStateChange: Number(raw.lastStateChange) || Date.now(),
      halfOpenAttempts: Number(raw.halfOpenAttempts) || 0,
    };
  }

  /**
   * Save the circuit state to Redis.
   */
  private async saveState(agentDid: string, data: CircuitData): Promise<void> {
    const key = this.circuitKey(agentDid);
    await this.redis
      .multi()
      .hset(key, {
        state: data.state,
        failures: data.failures.toString(),
        lastFailure: data.lastFailure.toString(),
        lastStateChange: data.lastStateChange.toString(),
        halfOpenAttempts: data.halfOpenAttempts.toString(),
      })
      .expire(key, CIRCUIT_KEY_TTL_SECONDS)
      .exec();
  }

  /**
   * Transition the circuit to a new state, updating timestamps and saving.
   */
  private async transition(
    agentDid: string,
    data: CircuitData,
    newState: CircuitState,
  ): Promise<void> {
    data.state = newState;
    data.lastStateChange = Date.now();

    if (newState === "CLOSED") {
      data.failures = 0;
      data.halfOpenAttempts = 0;
    } else if (newState === "HALF_OPEN") {
      data.halfOpenAttempts = 0;
    }

    await this.saveState(agentDid, data);
  }
}
