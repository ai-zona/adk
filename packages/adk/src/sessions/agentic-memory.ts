// ──────────────────────────────────────────────────────
// Agentic Memory — Persistent key-value store for agents
// ──────────────────────────────────────────────────────

/** Backend interface for pluggable persistence */
export interface AgenticMemoryBackend {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
}

/** In-memory backend (default) */
export class InMemoryBackend implements AgenticMemoryBackend {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const keys = Array.from(this.store.keys());
    if (prefix) return keys.filter((k) => k.startsWith(prefix));
    return keys;
  }
}

/**
 * AgenticMemory — simple persistent key-value store for agents.
 * Persists state across run calls when the same store instance is reused.
 */
export class AgenticMemory {
  private backend: AgenticMemoryBackend;

  constructor(backend?: AgenticMemoryBackend) {
    this.backend = backend ?? new InMemoryBackend();
  }

  async get(key: string): Promise<string | undefined> {
    return this.backend.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    return this.backend.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.backend.delete(key);
  }

  async search(prefix: string): Promise<Array<{ key: string; value: string }>> {
    const keys = await this.backend.list(prefix);
    const results: Array<{ key: string; value: string }> = [];
    for (const key of keys) {
      const value = await this.backend.get(key);
      if (value !== undefined) {
        results.push({ key, value });
      }
    }
    return results;
  }

  async list(): Promise<string[]> {
    return this.backend.list();
  }
}
