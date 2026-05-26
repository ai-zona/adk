// ──────────────────────────────────────────────────────
// ADK Server — Storage Backend Interfaces
// ──────────────────────────────────────────────────────

import type { SessionBackend } from "@aizona/adk";

/** Agent record stored by AgentStore */
export interface StoredAgent {
  id: string;
  name: string;
  config: unknown;
  version: string;
  metadata: unknown;
  createdAt: string;
}

/** Run record stored by RunStore */
export interface StoredRun {
  id: string;
  agentId: string;
  status: string;
  result?: unknown;
  createdAt: string;
}

/** Key record stored by KeyStore */
export interface StoredKey {
  id: string;
  prefix: string;
  hash: string;
  name: string;
  type: "live" | "test";
  active: boolean;
  createdAt: string;
}

/** Agent CRUD storage */
export interface AgentStore {
  list(): Promise<StoredAgent[]>;
  get(id: string): Promise<StoredAgent | null>;
  create(agent: StoredAgent): Promise<void>;
  update(id: string, data: Partial<StoredAgent>): Promise<StoredAgent | null>;
  delete(id: string): Promise<boolean>;
}

/** Run storage */
export interface RunStore {
  get(id: string): Promise<StoredRun | null>;
  create(run: StoredRun): Promise<void>;
}

/** API key storage */
export interface KeyStore {
  list(): Promise<StoredKey[]>;
  get(id: string): Promise<StoredKey | null>;
  create(key: StoredKey): Promise<void>;
  revoke(id: string): Promise<boolean>;
}

/** Combined storage backend */
export interface StorageBackend {
  agents: AgentStore;
  runs: RunStore;
  keys: KeyStore;
  sessions: SessionBackend;
}
