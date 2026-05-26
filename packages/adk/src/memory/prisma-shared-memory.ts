// ──────────────────────────────────────────────────────
// ADK Prisma Shared Memory Store
// ──────────────────────────────────────────────────────
// R6-T3: Implements the SharedMemoryStore interface backed
// by the AgentMemoryRecord Prisma table.
//
// Scope mapping:
//   agent     scope → agentSlug filter (ns.scopeId = agentSlug)
//   team      scope → team metadata filter (ns.scopeId = teamId)
//   workspace scope → workspaceId metadata filter (ns.scopeId = workspaceId)
//
// All records use a synthetic agentSlug of the form:
//   __sm__:<scope>:<scopeId>:<namespace>
// to keep shared-memory entries segregated from real agent memories
// while still leveraging the existing AgentMemoryRecord table + indices.
//
// TTL is honoured via the existing `expiresAt` column and the
// `deleteExpired()` sweep in memory-store.ts.
// ──────────────────────────────────────────────────────

import type { SharedMemoryEntry, SharedMemoryNamespace, SharedMemoryStore } from "./shared-memory";

// ── Generic DB client interface ───────────────────────
// Mirrors the subset of the Prisma AgentMemoryRecord model that this store
// needs. Using an interface keeps @aizonaai/adk independent of @aizona/db.

export interface SharedMemoryDbRecord {
  id: string;
  content: string;
  expiresAt: Date | null;
  metadata: unknown;
  createdAt: Date;
}

export interface SharedMemoryDbClient {
  findFirst(args: {
    where: Record<string, unknown>;
  }): Promise<SharedMemoryDbRecord | null>;

  create(args: { data: Record<string, unknown> }): Promise<SharedMemoryDbRecord>;

  deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }>;

  findMany(args: {
    where: Record<string, unknown>;
  }): Promise<SharedMemoryDbRecord[]>;
}

// ── Key helpers ────────────────────────────────────────

function makeAgentSlug(ns: SharedMemoryNamespace): string {
  // Encode scope/scopeId/namespace into the agentSlug so we get the benefit
  // of the existing agentSlug index without storing anything in a JSON column.
  // Characters are safe: scope is one of "agent"|"team"|"workspace"; scopeId
  // and namespace come from caller code, so we sanitise them.
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `__sm__:${ns.scope}:${safe(ns.scopeId)}:${safe(ns.namespace)}`;
}

function nowOrExpiry(ttlMs?: number): Date | null {
  if (ttlMs === undefined) return null;
  return new Date(Date.now() + ttlMs);
}

function isExpired(record: SharedMemoryDbRecord): boolean {
  return record.expiresAt !== null && record.expiresAt < new Date();
}

// ── PrismaSharedMemoryStore ─────────────────────────────

export class PrismaSharedMemoryStore implements SharedMemoryStore {
  private readonly client: SharedMemoryDbClient;

  constructor(client: SharedMemoryDbClient) {
    this.client = client;
  }

  async get(ns: SharedMemoryNamespace, key: string): Promise<unknown | null> {
    const agentSlug = makeAgentSlug(ns);
    const record = await this.client.findFirst({
      where: {
        agentSlug,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma JsonFilter
        metadata: { path: ["sharedKey"], equals: key } as any,
      },
    });
    if (!record || isExpired(record)) return null;
    try {
      return JSON.parse(record.content) as unknown;
    } catch {
      return record.content;
    }
  }

  async set(
    ns: SharedMemoryNamespace,
    key: string,
    value: unknown,
    ttlMs?: number,
  ): Promise<void> {
    const agentSlug = makeAgentSlug(ns);
    const expiresAt = nowOrExpiry(ttlMs);

    // Delete any existing record for this key, then create a fresh one.
    // AgentMemoryRecord has no unique constraint on (agentSlug, metadata.key),
    // so delete-then-insert is the safe upsert path.
    await this.client.deleteMany({
      where: {
        agentSlug,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma JsonFilter
        metadata: { path: ["sharedKey"], equals: key } as any,
      },
    });

    await this.client.create({
      data: {
        agentSlug,
        memoryType: "semantic",
        content: JSON.stringify(value),
        importance: 0.5,
        accessCount: 0,
        tier: "L3_WORKING",
        expiresAt,
        metadata: {
          _sharedMemory: true,
          sharedKey: key,
          scope: ns.scope,
          scopeId: ns.scopeId,
          namespace: ns.namespace,
        },
      },
    });
  }

  async delete(ns: SharedMemoryNamespace, key: string): Promise<void> {
    const agentSlug = makeAgentSlug(ns);
    await this.client.deleteMany({
      where: {
        agentSlug,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma JsonFilter
        metadata: { path: ["sharedKey"], equals: key } as any,
      },
    });
  }

  async list(ns: SharedMemoryNamespace, prefix?: string): Promise<string[]> {
    const agentSlug = makeAgentSlug(ns);
    const records = await this.client.findMany({
      where: {
        agentSlug,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma JsonFilter
        metadata: { path: ["_sharedMemory"], equals: true } as any,
      },
    });

    const keys: string[] = [];
    for (const r of records) {
      if (isExpired(r)) continue;
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const k = meta.sharedKey as string | undefined;
      if (!k) continue;
      if (prefix && !k.startsWith(prefix)) continue;
      keys.push(k);
    }
    return keys;
  }

  async clear(ns: SharedMemoryNamespace): Promise<void> {
    const agentSlug = makeAgentSlug(ns);
    await this.client.deleteMany({
      where: {
        agentSlug,
        // biome-ignore lint/suspicious/noExplicitAny: Prisma JsonFilter
        metadata: { path: ["_sharedMemory"], equals: true } as any,
      },
    });
  }
}

// ── Helper: build from a live Prisma db instance ──────

/**
 * Convenience factory that wraps the `db.agentMemoryRecord` Prisma delegate
 * (from @aizona/db) in the SharedMemoryDbClient interface.
 *
 * Usage:
 *   import { db } from "@aizona/db";
 *   const store = createPrismaSharedMemoryStore(db.agentMemoryRecord);
 */
// biome-ignore lint/suspicious/noExplicitAny: Prisma delegate type
export function createPrismaSharedMemoryStore(agentMemoryRecordDelegate: any): PrismaSharedMemoryStore {
  return new PrismaSharedMemoryStore(agentMemoryRecordDelegate as SharedMemoryDbClient);
}

// Convenience re-export of the SharedMemoryEntry type so callers don't need
// a separate import from ./shared-memory.
export type { SharedMemoryEntry, SharedMemoryNamespace, SharedMemoryStore };
