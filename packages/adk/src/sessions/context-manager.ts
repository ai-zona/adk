// ──────────────────────────────────────────────────────
// ADK Context Manager — Message trimming strategies
// ──────────────────────────────────────────────────────

import type { ChatMessage } from "../types/llm";
import type { ContextStrategy } from "../types/session";
import { ContextSummarizer, type SummarizationConfig } from "./context-summarizer";
import { TokenCounter, type TokenCounterStrategy } from "./token-counter";

/** Context manager configuration */
export interface ContextManagerConfig {
  /** Token counting strategy */
  tokenCounterStrategy?: TokenCounterStrategy;
  /** Summarization config (provider, model, maxSummaryTokens) */
  summarization?: SummarizationConfig;
  /** Number of recent turns to always keep verbatim (default: 4) */
  keepRecentTurns?: number;
}

export class ContextManager {
  private tokenCounter: TokenCounter;
  private summarizer?: ContextSummarizer;
  private keepRecentTurns: number;

  constructor(config?: ContextManagerConfig) {
    this.tokenCounter = new TokenCounter({ strategy: config?.tokenCounterStrategy });
    this.keepRecentTurns = config?.keepRecentTurns ?? 4;
    if (config?.summarization) {
      this.summarizer = new ContextSummarizer(config.summarization);
    }
  }

  /**
   * Trim messages to fit within a token budget.
   * Always preserves the system message (first) and most recent messages.
   */
  async trimToFit(
    messages: ChatMessage[],
    maxTokens: number,
    strategy: ContextStrategy = "sliding-window",
  ): Promise<ChatMessage[]> {
    // Calculate current token count
    const totalTokens = this.getTokenCount(messages);
    if (totalTokens <= maxTokens) return [...messages];

    if (strategy === "smart-summary" && this.summarizer) {
      return this.smartSummary(messages, maxTokens);
    }

    if (strategy === "jit") {
      return this.jitTrim(messages, maxTokens);
    }

    // Default: sliding window
    return this.slidingWindow(messages, maxTokens);
  }

  /** Get total token count for messages */
  getTokenCount(messages: ChatMessage[]): number {
    return this.tokenCounter.countMessages(messages);
  }

  private async smartSummary(messages: ChatMessage[], maxTokens: number): Promise<ChatMessage[]> {
    const result: ChatMessage[] = [];
    let tokenCount = 0;

    // 1. Always keep system message
    const systemMsg = messages.find((m) => m.role === "system");
    if (systemMsg) {
      result.push(systemMsg);
      tokenCount += this.tokenCounter.countMessage(systemMsg);
    }

    // 2. Partition: summarize older, keep recent turns
    const nonSystem = messages.filter((m) => m.role !== "system");
    const partitioned = this.summarizer?.partitionMessages(nonSystem, this.keepRecentTurns);
    if (!partitioned) return messages;
    const { summarize, keep } = partitioned;

    // 3. If there are messages to summarize, generate summary
    if (summarize.length > 0) {
      const summaryMsg = await this.summarizer?.summarize(summarize);
      if (!summaryMsg) return messages;
      const summaryTokens = this.tokenCounter.countMessage(summaryMsg);

      // Check if summary + recent fits
      const recentTokens = this.tokenCounter.countMessages(keep);
      if (tokenCount + summaryTokens + recentTokens <= maxTokens) {
        result.push(summaryMsg);
        result.push(...keep);
        return result;
      }

      // Summary + all recent doesn't fit — add summary, then fill recent from end
      result.push(summaryMsg);
      tokenCount += summaryTokens;

      // Add recent messages from end until budget exhausted
      const included: ChatMessage[] = [];
      for (let i = keep.length - 1; i >= 0; i--) {
        const msgTokens = this.tokenCounter.countMessage(keep[i]!);
        if (tokenCount + msgTokens > maxTokens) break;
        included.unshift(keep[i]!);
        tokenCount += msgTokens;
      }
      result.push(...included);
      return result;
    }

    // No messages to summarize — just apply sliding window
    result.push(...keep);
    return this.slidingWindow(result, maxTokens);
  }

  /**
   * JIT (Just-In-Time) strategy: keep only system prompt + last N messages.
   * Older messages are dropped (they can be recalled via a recall_context tool).
   */
  private jitTrim(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    const result: ChatMessage[] = [];
    let tokenCount = 0;

    // Always keep system message
    const systemMsg = messages.find((m) => m.role === "system");
    if (systemMsg) {
      result.push(systemMsg);
      tokenCount += this.tokenCounter.countMessage(systemMsg);
    }

    // Keep recent messages from end (more aggressive than sliding-window)
    const nonSystem = messages.filter((m) => m.role !== "system");
    const included: ChatMessage[] = [];

    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msgTokens = this.tokenCounter.countMessage(nonSystem[i]!);
      if (tokenCount + msgTokens > maxTokens) break;
      included.unshift(nonSystem[i]!);
      tokenCount += msgTokens;
    }

    result.push(...included);
    return result;
  }

  private slidingWindow(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
    const result: ChatMessage[] = [];
    let tokenCount = 0;

    // Always keep system message
    if (messages.length > 0 && messages[0]?.role === "system") {
      result.push(messages[0]!);
      tokenCount += this.tokenCounter.countMessage(messages[0]!);
    }

    // Add messages from the end (most recent first)
    const nonSystem = messages.filter((m) => m.role !== "system");
    const included: ChatMessage[] = [];

    for (let i = nonSystem.length - 1; i >= 0; i--) {
      const msgTokens = this.tokenCounter.countMessage(nonSystem[i]!);
      if (tokenCount + msgTokens > maxTokens) break;
      included.unshift(nonSystem[i]!);
      tokenCount += msgTokens;
    }

    result.push(...included);
    return result;
  }
}
