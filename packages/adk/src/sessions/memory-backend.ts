// ──────────────────────────────────────────────────────
// ADK Session Backend — In-Memory (default standalone)
// ──────────────────────────────────────────────────────

import { randomBytes } from "node:crypto";
import type { ChatMessage } from "../types/llm";
import type {
  Session,
  SessionBackend,
  SessionCreateOptions,
  SessionListFilter,
  SessionUpdateOptions,
} from "../types/session";

export class MemorySessionBackend implements SessionBackend {
  private sessions = new Map<string, Session>();

  async create(options: SessionCreateOptions): Promise<Session> {
    const id = `session-${randomBytes(8).toString("hex")}`;
    const session: Session = {
      id,
      agentName: options.agentName,
      messages: [],
      metadata: options.metadata ?? {},
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: options.expiresAt,
    };
    this.sessions.set(id, session);
    return { ...session };
  }

  async get(sessionId: string): Promise<Session | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check expiry
    if (session.expiresAt && new Date() > session.expiresAt) {
      session.status = "expired";
    }

    return { ...session, messages: [...session.messages] };
  }

  async update(sessionId: string, options: SessionUpdateOptions): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    if (options.messages) session.messages = [...options.messages];
    if (options.metadata) session.metadata = { ...session.metadata, ...options.metadata };
    if (options.status) session.status = options.status;
    session.updatedAt = new Date();

    return { ...session, messages: [...session.messages] };
  }

  async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);

    session.messages.push(...messages);
    session.updatedAt = new Date();

    return { ...session, messages: [...session.messages] };
  }

  async fork(sessionId: string): Promise<Session> {
    const original = this.sessions.get(sessionId);
    if (!original) throw new Error(`Session "${sessionId}" not found`);

    const id = `session-${randomBytes(8).toString("hex")}`;
    const forked: Session = {
      id,
      agentName: original.agentName,
      messages: [...original.messages],
      metadata: { ...original.metadata },
      status: "active",
      parentId: sessionId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(id, forked);
    return { ...forked };
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async list(filter?: SessionListFilter): Promise<Session[]> {
    let sessions = Array.from(this.sessions.values());

    if (filter?.agentName) {
      sessions = sessions.filter((s) => s.agentName === filter.agentName);
    }
    if (filter?.status) {
      sessions = sessions.filter((s) => s.status === filter.status);
    }

    // Sort by updatedAt descending
    sessions.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    if (filter?.offset) {
      sessions = sessions.slice(filter.offset);
    }
    if (filter?.limit) {
      sessions = sessions.slice(0, filter.limit);
    }

    return sessions.map((s) => ({ ...s, messages: [...s.messages] }));
  }
}
