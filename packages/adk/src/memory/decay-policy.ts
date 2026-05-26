// ──────────────────────────────────────────────────────
// ADK Memory Decay Policy
// ──────────────────────────────────────────────────────
// Manages automatic cleanup of stale memory entries based
// on a configurable policy (max age, check interval, and
// whether to delete or archive). For in-memory stores the
// TTL handles expiry automatically; this manager is most
// useful for persistent backends that need explicit GC.
// ──────────────────────────────────────────────────────

export interface DecayPolicy {
  /** Maximum age in milliseconds before a memory entry decays */
  maxAgeMs: number;
  /** How often (ms) to run the decay sweep */
  checkIntervalMs: number;
  /** What to do with decayed entries */
  onDecay: "delete" | "archive";
}

export class MemoryDecayManager {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private store: {
      delete(ns: unknown, key: string): Promise<void>;
      list(ns: unknown, prefix?: string): Promise<string[]>;
    },
    private namespace: unknown,
    private policy: DecayPolicy,
  ) {}

  /** Start the periodic decay sweep. */
  start(): void {
    this.timer = setInterval(() => this.runDecay(), this.policy.checkIntervalMs);
  }

  /** Stop the periodic decay sweep. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single decay sweep.
   *
   * For in-memory stores, TTL-based expiry handles cleanup automatically
   * during reads. This method is mainly useful for persistent stores
   * where we need explicit cleanup of old entries.
   *
   * Returns the number of entries that were decayed.
   */
  async runDecay(): Promise<number> {
    const keys = await this.store.list(this.namespace);
    const decayed = 0;
    // In a real implementation, check timestamps and delete/archive old entries
    // For the in-memory store, TTL expiry is handled at read time
    return decayed;
  }
}
