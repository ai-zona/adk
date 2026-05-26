// ──────────────────────────────────────────────────────
// ADK Context Summarizer — LLM-powered message summarization
// ──────────────────────────────────────────────────────

import { extractText } from "../content/helpers";
import type { ADKLLMProvider, ChatMessage } from "../types/llm";

/** Summarization configuration */
export interface SummarizationConfig {
  /** LLM provider for summarization */
  provider?: ADKLLMProvider;
  /** Model to use for summarization (cheap/fast model recommended) */
  model?: string;
  /** Max tokens for the summary (default: 500) */
  maxSummaryTokens?: number;
}

/** Partition result: messages to summarize vs. messages to keep */
export interface MessagePartition {
  /** Older messages to be summarized */
  summarize: ChatMessage[];
  /** Recent messages to keep verbatim */
  keep: ChatMessage[];
}

const SUMMARIZATION_PROMPT =
  "Summarize this conversation concisely. Preserve: key decisions, important facts, current task state, relevant tool results. Be brief but capture essential information.";

/**
 * ContextSummarizer — summarizes older messages to reduce context size.
 *
 * Uses an LLM provider if available, otherwise falls back to extractive
 * summarization (first + last sentence per message).
 */
export class ContextSummarizer {
  private config: SummarizationConfig;

  constructor(config?: SummarizationConfig) {
    this.config = config ?? {};
  }

  /**
   * Summarize messages into a condensed context message.
   * Falls back to extractive summarization if no LLM provider is available.
   */
  async summarize(messages: ChatMessage[]): Promise<ChatMessage> {
    if (messages.length === 0) {
      return { role: "system", content: "[No previous context]" };
    }

    // Try LLM-powered summarization
    if (this.config.provider) {
      try {
        return await this.llmSummarize(messages);
      } catch {
        // Fall back to extractive on LLM failure
      }
    }

    // Extractive fallback
    return this.extractiveSummarize(messages);
  }

  /**
   * Split messages: keep recent N turns verbatim, summarize the rest.
   * A "turn" is a user message + assistant response pair.
   */
  partitionMessages(messages: ChatMessage[], keepRecentTurns: number): MessagePartition {
    // Filter out system messages — they're handled separately
    const nonSystem = messages.filter((m) => m.role !== "system");

    if (keepRecentTurns <= 0) {
      return { summarize: nonSystem, keep: [] };
    }

    // Count user-message turns from the end
    let turnsFound = 0;
    let splitIndex = 0; // Default: keep everything

    for (let i = nonSystem.length - 1; i >= 0; i--) {
      if (nonSystem[i]?.role === "user") {
        turnsFound++;
        if (turnsFound >= keepRecentTurns) {
          splitIndex = i;
          break;
        }
      }
    }

    return {
      summarize: nonSystem.slice(0, splitIndex),
      keep: nonSystem.slice(splitIndex),
    };
  }

  /** LLM-powered summarization */
  private async llmSummarize(messages: ChatMessage[]): Promise<ChatMessage> {
    const provider = this.config.provider!;

    // Build conversation text for summarization
    const conversationText = messages
      .map((m) => `[${m.role}]: ${extractText(m.content)}`)
      .join("\n");

    const response = await provider.chat({
      messages: [{ role: "user", content: `${SUMMARIZATION_PROMPT}\n\n---\n${conversationText}` }],
      model: this.config.model,
      maxTokens: this.config.maxSummaryTokens ?? 500,
      temperature: 0.3,
    });

    return {
      role: "assistant",
      content: `[Previous conversation summary]\n${response.content}`,
    };
  }

  /** Extractive fallback: first + last sentence per message */
  private extractiveSummarize(messages: ChatMessage[]): ChatMessage {
    const summaryParts: string[] = [];

    for (const msg of messages) {
      const text = extractText(msg.content);
      if (!text || text.trim().length === 0) continue;

      const sentences = text
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (sentences.length === 0) continue;

      if (sentences.length === 1) {
        summaryParts.push(`[${msg.role}]: ${sentences[0]}`);
      } else {
        summaryParts.push(
          `[${msg.role}]: ${sentences[0]}. ... ${sentences[sentences.length - 1]}.`,
        );
      }
    }

    return {
      role: "assistant",
      content: `[Previous conversation summary]\n${summaryParts.join("\n")}`,
    };
  }
}
