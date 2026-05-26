// ──────────────────────────────────────────────────────
// ADK Built-in Guardrail: Budget Gate (Pre-call)
// ──────────────────────────────────────────────────────
// Pre-call budget gate guardrail.
// Checks if the agent's budget allows another LLM call before execution.
// When budget is exceeded and hard enforcement is enabled, blocks the call.
//
// Unlike budget-limit (output guardrail, checks AFTER the call), this
// guardrail checks BEFORE the LLM call and prevents spending entirely.
// ──────────────────────────────────────────────────────

import type { GuardrailResult, InputGuardrail } from "../../types/guardrail";
import type { ChatMessage } from "../../types/llm";
import type { RunContext } from "../../types/runner";

/** Budget check data injected into RunContext.metadata.budgetCheck */
export interface BudgetCheckData {
  allowed: boolean;
  usagePercent: number;
  remainingUsd: number;
}

export const budgetGateGuardrail: InputGuardrail = {
  name: "budget-gate",
  type: "input",
  tripwire: true,
  async execute(
    _input: string,
    _messages: ChatMessage[],
    ctx: RunContext,
  ): Promise<GuardrailResult> {
    // Check if budget tracking is available in context
    const budget = ctx.metadata?.budgetCheck as BudgetCheckData | undefined;

    if (!budget) {
      // No budget configured -- allow
      return {
        name: "budget-gate",
        type: "input",
        passed: true,
        tripwire: false,
        message: "No budget configured",
      };
    }

    if (!budget.allowed) {
      return {
        name: "budget-gate",
        type: "input",
        passed: false,
        tripwire: true,
        severity: "critical",
        message: `Budget exceeded: ${budget.usagePercent.toFixed(0)}% used, $${budget.remainingUsd.toFixed(4)} remaining`,
      };
    }

    if (budget.usagePercent >= 80) {
      return {
        name: "budget-gate",
        type: "input",
        passed: true,
        tripwire: false,
        severity: "warning",
        message: `Budget warning: ${budget.usagePercent.toFixed(0)}% used`,
      };
    }

    return {
      name: "budget-gate",
      type: "input",
      passed: true,
      tripwire: false,
      message: "Within budget",
    };
  },
};
