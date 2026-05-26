// ──────────────────────────────────────────────────────
// Built-in: Content Filter Guardrail
// ──────────────────────────────────────────────────────

import type { GuardrailResult, InputGuardrail, OutputGuardrail } from "../../types/guardrail";
import type { ChatMessage } from "../../types/llm";
import type { RunContext } from "../../types/runner";

interface ContentFilterOptions {
  /** Block patterns (regex) */
  blockedPatterns?: RegExp[];
  /** Block keywords (case-insensitive) */
  blockedKeywords?: string[];
  /** Max content length */
  maxLength?: number;
  /** Whether to tripwire on failure (default: true) */
  tripwire?: boolean;
}

/** Creates a content filter guardrail (input guardrail) */
export function contentFilter(options: ContentFilterOptions = {}): InputGuardrail {
  const { blockedPatterns = [], blockedKeywords = [], maxLength, tripwire = true } = options;

  const check = (content: string): GuardrailResult => {
    // Check blocked patterns
    for (const pattern of blockedPatterns) {
      if (pattern.test(content)) {
        return {
          name: "content-filter",
          type: "input",
          passed: false,
          tripwire,
          message: `Content matches blocked pattern: ${pattern}`,
        };
      }
    }

    // Check blocked keywords
    const lowerContent = content.toLowerCase();
    for (const keyword of blockedKeywords) {
      if (lowerContent.includes(keyword.toLowerCase())) {
        return {
          name: "content-filter",
          type: "input",
          passed: false,
          tripwire,
          message: `Content contains blocked keyword: ${keyword}`,
        };
      }
    }

    // Check length
    if (maxLength && content.length > maxLength) {
      return {
        name: "content-filter",
        type: "input",
        passed: false,
        tripwire,
        message: `Content exceeds max length: ${content.length} > ${maxLength}`,
      };
    }

    return { name: "content-filter", type: "input", passed: true, tripwire };
  };

  return {
    name: "content-filter",
    type: "input" as const,
    tripwire,
    async execute(
      input: string,
      _messages: ChatMessage[],
      _ctx: RunContext,
    ): Promise<GuardrailResult> {
      const result = check(input);
      result.type = "input";
      return result;
    },
  };
}
