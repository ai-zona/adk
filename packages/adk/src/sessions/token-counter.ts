// ──────────────────────────────────────────────────────
// ADK Token Counter — Estimate token counts for messages and tools
// ──────────────────────────────────────────────────────

import { isMultiModalContent } from "../content/helpers";
import type { ChatMessage, LLMToolDefinition } from "../types/llm";

/** Token counting strategy */
export type TokenCounterStrategy = "character" | "tiktoken-approx" | "provider-reported";

/** Token counter configuration */
export interface TokenCounterConfig {
  strategy?: TokenCounterStrategy;
}

/** Message overhead: ~4 tokens per message for role framing */
const MESSAGE_OVERHEAD = 4;

/** Tool framing overhead: name + description + schema framing */
const TOOL_FRAMING_OVERHEAD = 10;

/**
 * TokenCounter — estimates token counts without external dependencies.
 *
 * Strategies:
 * - "character": simple `Math.ceil(text.length / 4)` (cheapest, ~70% accuracy)
 * - "tiktoken-approx": BPE-approximation without external deps (~85% accuracy)
 * - "provider-reported": starts with tiktoken-approx, calibrates from actual provider counts
 */
export class TokenCounter {
  private strategy: TokenCounterStrategy;
  private calibrationFactor = 1.0;

  constructor(config?: TokenCounterConfig) {
    this.strategy = config?.strategy ?? "tiktoken-approx";
  }

  /** Count tokens in a text string */
  countText(text: string): number {
    if (!text) return 0;

    switch (this.strategy) {
      case "character":
        return Math.ceil(text.length / 4);
      case "tiktoken-approx":
      case "provider-reported":
        return Math.ceil(this.bpeApprox(text) * this.calibrationFactor);
      default:
        return Math.ceil(text.length / 4);
    }
  }

  /** Count tokens in a single message (content + overhead) */
  countMessage(msg: ChatMessage): number {
    let tokens = MESSAGE_OVERHEAD;

    if (isMultiModalContent(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text") {
          tokens += this.countText(part.text);
        } else if (part.type === "image") {
          tokens += this.estimateImageTokens(part);
        } else if (part.type === "audio") {
          tokens += this.estimateAudioTokens(part);
        } else if (part.type === "video") {
          tokens += this.estimateVideoTokens(part);
        } else if (part.type === "ui_artifact") {
          tokens += this.countText(part.content);
        }
      }
    } else {
      tokens += this.countText(msg.content);
    }

    // Tool calls add tokens
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        tokens += this.countText(tc.name) + this.countText(JSON.stringify(tc.input)) + 4;
      }
    }

    // Tool results add tokens
    if (msg.toolResults) {
      for (const tr of msg.toolResults) {
        tokens +=
          this.countText(typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output)) + 4;
      }
    }

    return tokens;
  }

  /** Count tokens across multiple messages */
  countMessages(messages: ChatMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.countMessage(msg), 0);
  }

  /** Count tokens for a single tool definition */
  countToolDef(tool: LLMToolDefinition): number {
    const nameTokens = this.countText(tool.name);
    const descTokens = this.countText(tool.description);
    const schemaTokens = this.countText(JSON.stringify(tool.inputSchema));
    return nameTokens + descTokens + schemaTokens + TOOL_FRAMING_OVERHEAD;
  }

  /** Count tokens for all tool definitions */
  countToolDefs(tools: LLMToolDefinition[]): number {
    return tools.reduce((sum, tool) => sum + this.countToolDef(tool), 0);
  }

  /** Calibrate from actual provider-reported token count */
  calibrate(text: string, actualTokens: number): void {
    if (this.strategy !== "provider-reported") return;
    const estimated = this.bpeApprox(text);
    if (estimated > 0) {
      this.calibrationFactor = actualTokens / estimated;
    }
  }

  /** Get current calibration factor */
  getCalibrationFactor(): number {
    return this.calibrationFactor;
  }

  /** Estimate image tokens based on detail level */
  private estimateImageTokens(part: import("../types/content").ImagePart): number {
    const detail = part.source.type === "url" ? (part.source.detail ?? "auto") : "auto";
    if (detail === "low") return 85;
    if (detail === "high") return 1600;
    return 800; // auto
  }

  /** Estimate audio tokens from duration or base64 size */
  private estimateAudioTokens(part: import("../types/content").AudioPart): number {
    if (part.durationSec) return Math.ceil(part.durationSec * 25); // ~25 tokens per second
    if (part.source.type === "base64") return Math.ceil(part.source.data.length / 100);
    return 500; // fallback
  }

  /** Estimate video tokens from duration or base64 size */
  private estimateVideoTokens(part: import("../types/content").VideoPart): number {
    if (part.durationSec) return Math.ceil(part.durationSec * 100); // ~100 tokens per second
    if (part.source.type === "base64") return Math.ceil(part.source.data.length / 50);
    return 2000; // fallback
  }

  /**
   * BPE-approximation: split on whitespace, count sub-word splits for long words,
   * account for punctuation. ~85% accuracy without external deps.
   */
  private bpeApprox(text: string): number {
    if (!text) return 0;

    let tokenCount = 0;
    // Split on whitespace
    const words = text.split(/\s+/).filter((w) => w.length > 0);

    for (const word of words) {
      if (word.length <= 3) {
        // Short words are usually 1 token
        tokenCount += 1;
      } else if (word.length <= 8) {
        // Medium words: ~1.3 tokens
        tokenCount += Math.ceil(word.length / 6);
      } else {
        // Long words get split into sub-word tokens (~3-4 chars per token)
        tokenCount += Math.ceil(word.length / 3.5);
      }

      // Punctuation attached to words adds extra tokens
      const punctuation = word.match(/[^\w]/g);
      if (punctuation) {
        tokenCount += Math.ceil(punctuation.length / 2);
      }
    }

    // Minimum 1 token for non-empty text
    return Math.max(1, tokenCount);
  }
}
