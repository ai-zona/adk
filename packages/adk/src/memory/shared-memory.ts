// ──────────────────────────────────────────────────────
// ADK Shared Memory — Cross-Agent Memory Store
// ──────────────────────────────────────────────────────
// Defines the interfaces for a namespaced, scoped memory
// store that multiple agents can read/write, enabling
// cross-agent knowledge sharing within a team or workspace.
// ──────────────────────────────────────────────────────

export type SharedMemoryScope = "agent" | "team" | "workspace";

export interface SharedMemoryNamespace {
  namespace: string;
  scope: SharedMemoryScope;
  scopeId: string;
}

export interface SharedMemoryEntry {
  key: string;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface SharedMemoryStore {
  get(ns: SharedMemoryNamespace, key: string): Promise<unknown | null>;
  set(ns: SharedMemoryNamespace, key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(ns: SharedMemoryNamespace, key: string): Promise<void>;
  list(ns: SharedMemoryNamespace, prefix?: string): Promise<string[]>;
  clear(ns: SharedMemoryNamespace): Promise<void>;
}
