// ──────────────────────────────────────────────────────
// Publishing Skills — Shared Types
// SkillExecutionContext, HostFns, SkillResult<T>
// ──────────────────────────────────────────────────────

import type { ChatMessage, ChatResponse } from "../../types/llm";

export interface HostFns {
  llm: {
    chat: (req: {
      messages: ChatMessage[];
      maxTokens?: number;
      temperature?: number;
    }) => Promise<ChatResponse>;
  };
  kb: {
    read: (
      kbId: string,
      key: string,
    ) => Promise<{ content: string; metadata?: Record<string, unknown> } | null>;
    write: (
      kbId: string,
      key: string,
      value: { content: string; metadata?: Record<string, unknown> },
    ) => Promise<void>;
    listKeys: (kbId: string, prefix?: string) => Promise<string[]>;
  };
  dataApi: { call: (slug: string, op: string, args: Record<string, unknown>) => Promise<unknown> };
  log: (level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) => void;
}

export interface SkillExecutionContext {
  workspaceId: string;
  agentSlug: string;
  taskId?: string;
  host: HostFns;
}

export type SkillErrorCode =
  | "INVALID_INPUT"
  | "PARSE_FAILED"
  | "NOT_FOUND"
  | "ENTITLEMENT_DENIED"
  | "RATE_LIMITED"
  | "DEPENDENCY_FAILED"
  | "INTERNAL";

export interface SkillError {
  ok: false;
  code: SkillErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface SkillSuccess<T> {
  ok: true;
  data: T;
}

export type SkillResult<T> = SkillSuccess<T> | SkillError;

export const fail = (
  code: SkillErrorCode,
  message: string,
  details?: Record<string, unknown>,
): SkillError => ({ ok: false, code, message, ...(details ? { details } : {}) });

export const ok = <T>(data: T): SkillSuccess<T> => ({ ok: true, data });
