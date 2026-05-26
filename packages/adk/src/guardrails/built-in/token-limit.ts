// ──────────────────────────────────────────────────────
// ADK Built-in Guardrail: Token/Cost Limit
// ──────────────────────────────────────────────────────

import type { GuardrailResult, GuardrailSeverity, OutputGuardrail } from "../../types/guardrail";
import type { ChatMessage } from "../../types/llm";
import type { RunContext } from "../../types/runner";

export interface TokenLimitConfig {
  /** Max total tokens (input + output) before triggering */
  maxTotalTokens?: number;
  /** Max cost USD before triggering */
  maxCostUsd?: number;
  /** Severity when limit exceeded (default: "warning") */
  severity?: GuardrailSeverity;
}

export function tokenLimit(config: TokenLimitConfig): OutputGuardrail {
  const severity = config.severity ?? "warning";

  return {
    name: "token-limit",
    type: "output",
    tripwire: severity === "critical" || severity === "error",
    execute: async (
      _output: string,
      _messages: ChatMessage[],
      ctx: RunContext,
    ): Promise<GuardrailResult> => {
      const totalTokens = ctx.usage.inputTokens + ctx.usage.outputTokens;

      const tokenExceeded = config.maxTotalTokens && totalTokens > config.maxTotalTokens;
      const costExceeded = config.maxCostUsd && ctx.usage.totalCostUsd > config.maxCostUsd;

      if (tokenExceeded || costExceeded) {
        const reasons: string[] = [];
        if (tokenExceeded) reasons.push(`tokens ${totalTokens} > ${config.maxTotalTokens}`);
        if (costExceeded)
          reasons.push(`cost $${ctx.usage.totalCostUsd.toFixed(4)} > $${config.maxCostUsd}`);

        return {
          name: "token-limit",
          type: "output",
          passed: false,
          tripwire: severity === "critical" || severity === "error",
          severity,
          score: tokenExceeded
            ? Math.min(1, totalTokens / (config.maxTotalTokens! * 2))
            : Math.min(1, ctx.usage.totalCostUsd / (config.maxCostUsd! * 2)),
          message: `Token/cost limit exceeded: ${reasons.join(", ")}`,
        };
      }

      return {
        name: "token-limit",
        type: "output",
        passed: true,
        tripwire: false,
        severity: "info",
        message: `Within limits: ${totalTokens} tokens, $${ctx.usage.totalCostUsd.toFixed(4)}`,
      };
    },
  };
}
