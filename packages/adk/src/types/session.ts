// ──────────────────────────────────────────────────────
// ADK Session Types
// ──────────────────────────────────────────────────────

import type { ChatMessage } from "./llm";

/** Session state */
export type SessionStatus = "active" | "expired" | "closed";

/** Session data */
export interface Session {
  id: string;
  agentName: string;
  messages: ChatMessage[];
  metadata: Record<string, unknown>;
  status: SessionStatus;
  parentId?: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

/** Session create options */
export interface SessionCreateOptions {
  agentName: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

/** Session update options */
export interface SessionUpdateOptions {
  messages?: ChatMessage[];
  metadata?: Record<string, unknown>;
  status?: SessionStatus;
}

/** Session backend interface — all backends implement this */
export interface SessionBackend {
  /** Create a new session */
  create(options: SessionCreateOptions): Promise<Session>;

  /** Get a session by ID */
  get(sessionId: string): Promise<Session | null>;

  /** Update a session */
  update(sessionId: string, options: SessionUpdateOptions): Promise<Session>;

  /** Append messages to a session */
  appendMessages(sessionId: string, messages: ChatMessage[]): Promise<Session>;

  /** Fork a session (create a copy with new ID, reference to parent) */
  fork(sessionId: string): Promise<Session>;

  /** Delete a session */
  delete(sessionId: string): Promise<void>;

  /** List sessions (optional filter) */
  list(filter?: SessionListFilter): Promise<Session[]>;
}

/** Session list filter */
export interface SessionListFilter {
  agentName?: string;
  status?: SessionStatus;
  limit?: number;
  offset?: number;
}

/** Context management strategy */
export type ContextStrategy = "sliding-window" | "smart-summary" | "jit";
