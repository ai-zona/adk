// ──────────────────────────────────────────────────────
// ADK In-Memory Circuit Breaker (per-provider)
// ──────────────────────────────────────────────────────
// Local, dependency-free. Use a Redis-backed breaker in aza-protocol for
// cross-process coordination; this protects a single Runner process.
// ──────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  /** Consecutive failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Cooldown in ms before transitioning open → half-open (default: 30_000) */
  cooldownMs?: number;
  /** Successes in half-open required to close the circuit (default: 1) */
  successThreshold?: number;
  /** Optional clock for tests */
  now?: () => number;
}

const DEFAULTS: Required<Omit<CircuitBreakerConfig, "now">> = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  successThreshold: 1,
};

interface BreakerEntry {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: number;
}

/** Custom error thrown when a circuit is open */
export class ADKCircuitBreakerError extends Error {
  readonly providerId: string;
  readonly retryAfterMs: number;

  constructor(providerId: string, retryAfterMs: number) {
    super(
      `Circuit breaker is open for provider "${providerId}". Retry after ${retryAfterMs}ms.`,
    );
    this.name = "ADKCircuitBreakerError";
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
  }
}

export class CircuitBreaker {
  private config: Required<Omit<CircuitBreakerConfig, "now">>;
  private now: () => number;
  private entries = new Map<string, BreakerEntry>();

  constructor(config?: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? DEFAULTS.failureThreshold,
      cooldownMs: config?.cooldownMs ?? DEFAULTS.cooldownMs,
      successThreshold: config?.successThreshold ?? DEFAULTS.successThreshold,
    };
    this.now = config?.now ?? Date.now;
  }

  /**
   * Check current state and throw ADKCircuitBreakerError if open.
   * Auto-transitions open → half-open after cooldown.
   */
  check(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;

    if (entry.state === "open") {
      const elapsed = this.now() - entry.openedAt;
      if (elapsed >= this.config.cooldownMs) {
        entry.state = "half-open";
        entry.consecutiveSuccesses = 0;
        return;
      }
      throw new ADKCircuitBreakerError(providerId, this.config.cooldownMs - elapsed);
    }
  }

  /** Record a successful call. May close the circuit if half-open. */
  recordSuccess(providerId: string): void {
    const entry = this.getOrCreate(providerId);
    if (entry.state === "half-open") {
      entry.consecutiveSuccesses++;
      if (entry.consecutiveSuccesses >= this.config.successThreshold) {
        entry.state = "closed";
        entry.consecutiveFailures = 0;
        entry.consecutiveSuccesses = 0;
      }
      return;
    }
    // closed → reset failure counter
    entry.consecutiveFailures = 0;
  }

  /** Record a failed call. May open the circuit if threshold reached. */
  recordFailure(providerId: string): void {
    const entry = this.getOrCreate(providerId);
    entry.consecutiveFailures++;

    if (entry.state === "half-open") {
      // Any failure in half-open reopens the circuit immediately
      entry.state = "open";
      entry.openedAt = this.now();
      entry.consecutiveSuccesses = 0;
      return;
    }
    if (entry.consecutiveFailures >= this.config.failureThreshold) {
      entry.state = "open";
      entry.openedAt = this.now();
    }
  }

  /** Current state for a provider (closed if never seen) */
  getState(providerId: string): CircuitState {
    return this.entries.get(providerId)?.state ?? "closed";
  }

  /** Reset a provider's circuit (e.g., after manual intervention) */
  reset(providerId: string): void {
    this.entries.delete(providerId);
  }

  /** Reset all circuits */
  resetAll(): void {
    this.entries.clear();
  }

  private getOrCreate(providerId: string): BreakerEntry {
    let entry = this.entries.get(providerId);
    if (!entry) {
      entry = {
        state: "closed",
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        openedAt: 0,
      };
      this.entries.set(providerId, entry);
    }
    return entry;
  }
}
