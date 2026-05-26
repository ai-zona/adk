// ──────────────────────────────────────────────────────
// ADK Server — Prisma Storage (platform mode)
// ──────────────────────────────────────────────────────
// Uses ADKAgentRegistry, ADKUsageRecord, ADKSession, ApiKey
// Prisma models from @aizona/db.
// ──────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import type {
  ChatMessage,
  Session,
  SessionBackend,
  SessionCreateOptions,
  SessionListFilter,
  SessionUpdateOptions,
} from "@aizonaai/adk";
import type {
  AgentStore,
  KeyStore,
  RunStore,
  StorageBackend,
  StoredAgent,
  StoredKey,
  StoredRun,
} from "./types";

/** Minimal Prisma client type — avoids hard dep on @aizona/db at compile time */
type PrismaClient = {
  aDKAgentRegistry: {
    findMany: (args?: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    delete: (args: any) => Promise<any>;
  };
  aDKSession: {
    findMany: (args?: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    delete: (args: any) => Promise<any>;
  };
};

function createPrismaAgentStore(db: PrismaClient): AgentStore {
  return {
    async list() {
      const rows = await db.aDKAgentRegistry.findMany({
        orderBy: { createdAt: "desc" },
      });
      return rows.map(toStoredAgent);
    },
    async get(id) {
      const row = await db.aDKAgentRegistry.findUnique({ where: { id } });
      return row ? toStoredAgent(row) : null;
    },
    async create(agent) {
      await db.aDKAgentRegistry.create({
        data: {
          id: agent.id,
          apiKeyId: "system",
          name: agent.name,
          config: agent.config as any,
          version: agent.version,
          metadata: agent.metadata as any,
        },
      });
    },
    async update(id, data) {
      try {
        const row = await db.aDKAgentRegistry.update({
          where: { id },
          data: {
            ...(data.name !== undefined && { name: data.name }),
            ...(data.config !== undefined && { config: data.config as any }),
            ...(data.version !== undefined && { version: data.version }),
            ...(data.metadata !== undefined && { metadata: data.metadata as any }),
          },
        });
        return toStoredAgent(row);
      } catch {
        return null;
      }
    },
    async delete(id) {
      try {
        await db.aDKAgentRegistry.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function toStoredAgent(row: any): StoredAgent {
  return {
    id: row.id,
    name: row.name,
    config: row.config ?? {},
    version: row.version,
    metadata: row.metadata ?? {},
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function createPrismaRunStore(): RunStore {
  // Runs are ephemeral — keep in memory even in platform mode.
  // Usage tracking is handled by the usageTracker middleware writing to ADKUsageRecord.
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

function createPrismaKeyStore(db: PrismaClient): KeyStore {
  // Keys are managed via the tRPC developer router and ApiKey model.
  // This store provides read-only access for the ADK server routes.
  const localKeys = new Map<string, StoredKey>();

  return {
    async list() {
      return Array.from(localKeys.values());
    },
    async get(id) {
      return localKeys.get(id) ?? null;
    },
    async create(key) {
      localKeys.set(key.id, key);
    },
    async revoke(id) {
      const key = localKeys.get(id);
      if (!key) return false;
      key.active = false;
      return true;
    },
  };
}

/** Create a Prisma-backed session backend using ADKSession model */
export function createPrismaSessionBackend(db: PrismaClient): SessionBackend {
  return {
    async create(options: SessionCreateOptions): Promise<Session> {
      const row = await db.aDKSession.create({
        data: {
          apiKeyId: "system",
          agentName: options.agentName,
          messages: [] as any,
          metadata: (options.metadata ?? {}) as any,
          status: "active",
          expiresAt: options.expiresAt,
        },
      });
      return toSession(row);
    },

    async get(sessionId: string): Promise<Session | null> {
      const row = await db.aDKSession.findUnique({ where: { id: sessionId } });
      if (!row) return null;

      // Check expiry
      if (row.expiresAt && new Date() > new Date(row.expiresAt)) {
        await db.aDKSession.update({ where: { id: sessionId }, data: { status: "expired" } });
        row.status = "expired";
      }

      return toSession(row);
    },

    async update(sessionId: string, options: SessionUpdateOptions): Promise<Session> {
      const existing = await db.aDKSession.findUnique({ where: { id: sessionId } });
      if (!existing) throw new Error(`Session "${sessionId}" not found`);

      const data: any = {};
      if (options.messages) data.messages = options.messages as any;
      if (options.metadata)
        data.metadata = { ...(existing.metadata as any), ...options.metadata } as any;
      if (options.status) data.status = options.status;

      const row = await db.aDKSession.update({ where: { id: sessionId }, data });
      return toSession(row);
    },

    async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<Session> {
      const existing = await db.aDKSession.findUnique({ where: { id: sessionId } });
      if (!existing) throw new Error(`Session "${sessionId}" not found`);

      const currentMessages = (existing.messages as any) ?? [];
      const row = await db.aDKSession.update({
        where: { id: sessionId },
        data: { messages: [...currentMessages, ...messages] as any },
      });
      return toSession(row);
    },

    async fork(sessionId: string): Promise<Session> {
      const original = await db.aDKSession.findUnique({ where: { id: sessionId } });
      if (!original) throw new Error(`Session "${sessionId}" not found`);

      const row = await db.aDKSession.create({
        data: {
          apiKeyId: original.apiKeyId,
          agentName: original.agentName,
          messages: original.messages as any,
          metadata: original.metadata as any,
          status: "active",
          parentId: sessionId,
        },
      });
      return toSession(row);
    },

    async delete(sessionId: string): Promise<void> {
      await db.aDKSession.delete({ where: { id: sessionId } });
    },

    async list(filter?: SessionListFilter): Promise<Session[]> {
      const where: any = {};
      if (filter?.agentName) where.agentName = filter.agentName;
      if (filter?.status) where.status = filter.status;

      const rows = await db.aDKSession.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: filter?.offset,
        take: filter?.limit,
      });
      return rows.map(toSession);
    },
  };
}

function toSession(row: any): Session {
  return {
    id: row.id,
    agentName: row.agentName,
    messages: (row.messages as any) ?? [],
    metadata: (row.metadata as any) ?? {},
    status: row.status as Session["status"],
    parentId: row.parentId ?? undefined,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt),
    expiresAt: row.expiresAt
      ? row.expiresAt instanceof Date
        ? row.expiresAt
        : new Date(row.expiresAt)
      : undefined,
  };
}

/** Create a Prisma-backed storage backend for platform mode */
export function createPrismaStorage(db: PrismaClient): StorageBackend {
  return {
    agents: createPrismaAgentStore(db),
    runs: createPrismaRunStore(),
    keys: createPrismaKeyStore(db),
    sessions: createPrismaSessionBackend(db),
  };
}
