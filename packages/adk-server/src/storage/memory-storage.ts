// ──────────────────────────────────────────────────────
// ADK Server — In-Memory Storage (default / standalone)
// ──────────────────────────────────────────────────────

import { MemorySessionBackend } from "@aizonaai/adk";
import type {
  AgentStore,
  KeyStore,
  RunStore,
  StorageBackend,
  StoredAgent,
  StoredKey,
  StoredRun,
} from "./types";

function createMemoryAgentStore(): AgentStore {
  const agents = new Map<string, StoredAgent>();

  return {
    async list() {
      return Array.from(agents.values());
    },
    async get(id) {
      return agents.get(id) ?? null;
    },
    async create(agent) {
      agents.set(agent.id, agent);
    },
    async update(id, data) {
      const existing = agents.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...data, id };
      agents.set(id, updated);
      return updated;
    },
    async delete(id) {
      return agents.delete(id);
    },
  };
}

function createMemoryRunStore(): RunStore {
  const runs = new Map<string, StoredRun>();

  return {
    async get(id) {
      return runs.get(id) ?? null;
    },
    async create(run) {
      runs.set(run.id, run);
    },
  };
}

function createMemoryKeyStore(): KeyStore {
  const keys = new Map<string, StoredKey>();

  return {
    async list() {
      return Array.from(keys.values());
    },
    async get(id) {
      return keys.get(id) ?? null;
    },
    async create(key) {
      keys.set(key.id, key);
    },
    async revoke(id) {
      const key = keys.get(id);
      if (!key) return false;
      key.active = false;
      return true;
    },
  };
}

/** Create an in-memory storage backend (default for standalone mode) */
export function createMemoryStorage(): StorageBackend {
  return {
    agents: createMemoryAgentStore(),
    runs: createMemoryRunStore(),
    keys: createMemoryKeyStore(),
    sessions: new MemorySessionBackend(),
  };
}
