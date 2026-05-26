// ──────────────────────────────────────────────────────
// ADK Session Compaction — Message list truncation
// ──────────────────────────────────────────────────────
// Compact message history to keep sessions within limits.
// Two strategies: "truncate" (keep recent) or "summarize"
// (placeholder for future LLM-powered summarization).
// ──────────────────────────────────────────────────────

import type { ChatMessage } from "../types/llm";

export interface CompactionOptions {
  /** Maximum number of messages to retain */
  maxMessages: number;
  /** Compaction strategy — truncate keeps most recent messages */
  strategy: "truncate" | "summarize";
  /** Whether to always preserve the system message(s) at the start */
  keepSystemMessage: boolean;
}

const DEFAULT_OPTIONS: CompactionOptions = {
  maxMessages: 100,
  strategy: "truncate",
  keepSystemMessage: true,
};

/**
 * Compact a message array to fit within maxMessages.
 *
 * With strategy="truncate", system messages are preserved at the front
 * and the most recent non-system messages are kept.
 *
 * With strategy="summarize", falls back to truncate for now (future:
 * will insert an LLM-generated summary of trimmed messages).
 */
export function compactMessages(
  messages: ChatMessage[],
  options: Partial<CompactionOptions> = {},
): ChatMessage[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (messages.length <= opts.maxMessages) return messages;

  // Separate system messages from conversation messages
  const systemMessages = opts.keepSystemMessage ? messages.filter((m) => m.role === "system") : [];
  const nonSystem = messages.filter((m) => m.role !== "system");

  // Calculate how many non-system messages we can keep
  const keepCount = Math.max(0, opts.maxMessages - systemMessages.length);
  const kept = nonSystem.slice(-keepCount); // Keep most recent

  return [...systemMessages, ...kept];
}
