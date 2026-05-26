// ──────────────────────────────────────────────────────
// ADK Session Backend — Prisma (persistent storage)
// ──────────────────────────────────────────────────────
// Implements SessionBackend using the AgentSession Prisma model.
// PrismaClient is injected via constructor to avoid hard dependency.
// ──────────────────────────────────────────────────────

import type { ChatMessage } from "../types/llm";
import type {
  Session,
  SessionBackend,
  SessionCreateOptions,
  SessionListFilter,
  SessionUpdateOptions,
} from "../types/session";

export class PrismaSessionBackend implements SessionBackend {
  // biome-ignore lint/suspicious/noExplicitAny: PrismaClient injected — no @aizona/db hard dep
  private db: any;

  constructor(db: unknown) {
    this.db = db;
  }

  async create(options: SessionCreateOptions): Promise<Session> {
    const record = await this.db.agentSession.create({
      data: {
        agentName: options.agentName,
        messages: JSON.stringify([]),
        metadata: JSON.stringify(options.metadata ?? {}),
        status: "active",
        messageCount: 0,
        tokenCount: 0,
        expiresAt: options.expiresAt ?? null,
      },
    });
    return this.toSession(record);
  }

  async get(sessionId: string): Promise<Session | null> {
    const record = await this.db.agentSession.findUnique({
      where: { id: sessionId },
    });
    if (!record) return null;

    // Check expiry — mark as expired if past expiresAt
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      await this.db.agentSession.update({
        where: { id: sessionId },
        data: { status: "expired" },
      });
      return null;
    }

    return this.toSession(record);
  }

  async update(sessionId: string, options: SessionUpdateOptions): Promise<Session> {
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (options.messages) {
      data.messages = JSON.stringify(options.messages);
      data.messageCount = options.messages.length;
    }
    if (options.metadata) data.metadata = JSON.stringify(options.metadata);
    if (options.status) data.status = options.status;

    const record = await this.db.agentSession.update({
      where: { id: sessionId },
      data,
    });
    return this.toSession(record);
  }

  async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<Session> {
    const existing = await this.db.agentSession.findUnique({
      where: { id: sessionId },
    });
    if (!existing) throw new Error(`Session "${sessionId}" not found`);

    const currentMessages = this.parseJson(existing.messages, []);
    const updated = [...currentMessages, ...messages];

    const record = await this.db.agentSession.update({
      where: { id: sessionId },
      data: {
        messages: JSON.stringify(updated),
        messageCount: updated.length,
        updatedAt: new Date(),
      },
    });
    return this.toSession(record);
  }

  async fork(sessionId: string): Promise<Session> {
    const parent = await this.get(sessionId);
    if (!parent) throw new Error(`Session "${sessionId}" not found`);

    const record = await this.db.agentSession.create({
      data: {
        agentName: parent.agentName,
        messages: JSON.stringify(parent.messages),
        metadata: JSON.stringify(parent.metadata),
        status: "active",
        parentId: sessionId,
        messageCount: parent.messages?.length ?? 0,
        tokenCount: 0,
      },
    });
    return this.toSession(record);
  }

  async delete(sessionId: string): Promise<void> {
    await this.db.agentSession.delete({ where: { id: sessionId } });
  }

  async list(filter?: SessionListFilter): Promise<Session[]> {
    const where: Record<string, unknown> = {};
    if (filter?.agentName) where.agentName = filter.agentName;
    if (filter?.status) where.status = filter.status;

    const records = await this.db.agentSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: filter?.limit ?? 50,
      skip: filter?.offset ?? 0,
    });
    // biome-ignore lint/suspicious/noExplicitAny: Prisma record type varies
    return records.map((r: any) => this.toSession(r));
  }

  /** Convert a Prisma record to Session interface */
  // biome-ignore lint/suspicious/noExplicitAny: Prisma record shape
  private toSession(record: any): Session {
    return {
      id: record.id,
      agentName: record.agentName,
      messages: this.parseJson(record.messages, []),
      metadata: this.parseJson(record.metadata, {}),
      status: record.status,
      parentId: record.parentId ?? undefined,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : undefined,
    };
  }

  /** Safely parse JSON — handles both string and pre-parsed values */
  private parseJson<T>(value: unknown, fallback: T): T {
    if (value === null || value === undefined) return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    }
    return value as T;
  }
}
