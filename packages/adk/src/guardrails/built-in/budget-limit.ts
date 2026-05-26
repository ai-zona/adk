// ──────────────────────────────────────────────────────
// Built-in: Budget Limit Guardrail
// ──────────────────────────────────────────────────────

import type { GuardrailResult, OutputGuardrail } from "../../types/guardrail";
import type { ChatMessage } from "../../types/llm";
import type { RunContext } from "../../types/runner";

/** Creates a budget limit guardrail (checks accumulated cost after each LLM call) */
export function budgetLimit(maxUsd: number): OutputGuardrail {
  return {
    name: "budget-limit",
    type: "output",
    tripwire: true,
    async execute(
      _output: string,
      _messages: ChatMessage[],
      ctx: RunContext,
    ): Promise<GuardrailResult> {
      if (ctx.usage.totalCostUsd > maxUsd) {
        return {
          name: "budget-limit",
          type: "output",
          passed: false,
          tripwire: true,
          message: `Budget exceeded: $${ctx.usage.totalCostUsd.toFixed(4)} > $${maxUsd.toFixed(4)}`,
        };
      }

      // Warn at 80%
      if (ctx.usage.totalCostUsd > maxUsd * 0.8) {
        return {
          name: "budget-limit",
          type: "output",
          passed: true,
          tripwire: false,
          message: `Budget warning: $${ctx.usage.totalCostUsd.toFixed(4)} / $${maxUsd.toFixed(4)} (${Math.round((ctx.usage.totalCostUsd / maxUsd) * 100)}%)`,
        };
      }

      return { name: "budget-limit", type: "output", passed: true, tripwire: false };
    },
  };
}
