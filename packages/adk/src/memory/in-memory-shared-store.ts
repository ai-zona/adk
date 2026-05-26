// ──────────────────────────────────────────────────────
// ADK In-Memory Shared Store
// ──────────────────────────────────────────────────────
// A lightweight, in-process implementation of the
// SharedMemoryStore interface. Supports TTL-based expiry.
// Suitable for development, testing, and single-process
// deployments. For production multi-process setups,
// implement SharedMemoryStore backed by Redis or a DB.
// ──────────────────────────────────────────────────────

import type { SharedMemoryEntry, SharedMemoryNamespace, SharedMemoryStore } from "./shared-memory";

export class InMemorySharedStore implements SharedMemoryStore {
  private store = new Map<string, SharedMemoryEntry>();

  private makeKey(ns: SharedMemoryNamespace, key: string): string {
    return `${ns.scope}:${ns.scopeId}:${ns.namespace}:${key}`;
  }

  async get(ns: SharedMemoryNamespace, key: string): Promise<unknown | null> {
    const fullKey = this.makeKey(ns, key);
    const entry = this.store.get(fullKey);
    if (!entry) return null;
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.store.delete(fullKey);
      return null;
    }
    return entry.value;
  }

  async set(ns: SharedMemoryNamespace, key: string, value: unknown, ttlMs?: number): Promise<void> {
    const fullKey = this.makeKey(ns, key);
    this.store.set(fullKey, {
      key,
      value,
      createdAt: this.store.get(fullKey)?.createdAt ?? new Date(),
      updatedAt: new Date(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs) : undefined,
    });
  }

  async delete(ns: SharedMemoryNamespace, key: string): Promise<void> {
    this.store.delete(this.makeKey(ns, key));
  }

  async list(ns: SharedMemoryNamespace, prefix?: string): Promise<string[]> {
    const nsPrefix = `${ns.scope}:${ns.scopeId}:${ns.namespace}:`;
    const keys: string[] = [];
    for (const [fullKey, entry] of this.store) {
      if (!fullKey.startsWith(nsPrefix)) continue;
      if (entry.expiresAt && entry.expiresAt < new Date()) continue;
      const shortKey = fullKey.slice(nsPrefix.length);
      if (prefix && !shortKey.startsWith(prefix)) continue;
      keys.push(shortKey);
    }
    return keys;
  }

  async clear(ns: SharedMemoryNamespace): Promise<void> {
    const nsPrefix = `${ns.scope}:${ns.scopeId}:${ns.namespace}:`;
    for (const key of this.store.keys()) {
      if (key.startsWith(nsPrefix)) this.store.delete(key);
    }
  }
}
