// ──────────────────────────────────────────────────────
// ADK Built-in Guardrail: PII Filter
// ──────────────────────────────────────────────────────

import type { GuardrailResult, GuardrailSeverity, OutputGuardrail } from "../../types/guardrail";
import type { ChatMessage } from "../../types/llm";
import type { RunContext } from "../../types/runner";

export interface PIIFilterConfig {
  /** PII types to detect */
  detect?: ("email" | "phone" | "ssn" | "credit_card")[];
  /** Severity when PII detected (default: "warning") */
  severity?: GuardrailSeverity;
}

const PATTERNS: Record<string, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  phone: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
};

export function piiFilter(config?: PIIFilterConfig): OutputGuardrail {
  const detectTypes = config?.detect ?? ["email", "phone", "ssn", "credit_card"];
  const severity = config?.severity ?? "warning";

  return {
    name: "pii-filter",
    type: "output",
    tripwire: severity === "critical" || severity === "error",
    execute: async (
      output: string,
      _messages: ChatMessage[],
      _ctx: RunContext,
    ): Promise<GuardrailResult> => {
      const found: { type: string; count: number }[] = [];

      for (const type of detectTypes) {
        const pattern = PATTERNS[type];
        if (!pattern) continue;
        const matches = output.match(new RegExp(pattern.source, pattern.flags));
        if (matches && matches.length > 0) {
          found.push({ type, count: matches.length });
        }
      }

      if (found.length > 0) {
        const details = found.map((f) => `${f.count} ${f.type}(s)`).join(", ");
        return {
          name: "pii-filter",
          type: "output",
          passed: false,
          tripwire: severity === "critical" || severity === "error",
          severity,
          score: Math.min(1, found.reduce((s, f) => s + f.count, 0) / 5),
          message: `PII detected in output: ${details}`,
          metadata: { detections: found },
        };
      }

      return {
        name: "pii-filter",
        type: "output",
        passed: true,
        tripwire: false,
        severity: "info",
        message: "No PII detected",
      };
    },
  };
}
