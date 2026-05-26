// ──────────────────────────────────────────────────────
// Built-in: Consent Gate Guardrail
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/orchestrator/consent-gate.ts
// Simplified for ADK: uses a ConsentHandler callback instead of in-memory state
// ──────────────────────────────────────────────────────

import type { ConsentLevel } from "../../types/agent";
import type {
  ConsentHandler,
  ConsentRequest,
  GuardrailResult,
  InputGuardrail,
} from "../../types/guardrail";
import type { ChatMessage } from "../../types/llm";
import type { RunContext } from "../../types/runner";

let requestCounter = 0;

/** Creates a consent gate guardrail */
export function consentGate(level: ConsentLevel, handler?: ConsentHandler): InputGuardrail {
  return {
    name: "consent-gate",
    type: "input",
    tripwire: true,
    async execute(
      _input: string,
      _messages: ChatMessage[],
      ctx: RunContext,
    ): Promise<GuardrailResult> {
      // Auto consent — always allow
      if (level === "auto") {
        return { name: "consent-gate", type: "input", passed: true, tripwire: true };
      }

      // Notify — allow but log
      if (level === "notify") {
        return {
          name: "consent-gate",
          type: "input",
          passed: true,
          tripwire: false,
          message: `Agent ${ctx.agentName} is executing (notification)`,
        };
      }

      // Explicit / multi_party — need handler
      if (!handler) {
        return {
          name: "consent-gate",
          type: "input",
          passed: false,
          tripwire: true,
          message: `Consent level "${level}" requires a handler but none provided`,
        };
      }

      const request: ConsentRequest = {
        id: `consent-${++requestCounter}`,
        agentName: ctx.agentName,
        action: `run-${ctx.runId}`,
        consentLevel: level,
        requiredApprovals: level === "multi_party" ? 3 : 1,
        currentApprovals: [],
        rejectedBy: null,
        status: "pending",
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000, // 1 hour
      };

      const decision = await handler(request);

      return {
        name: "consent-gate",
        type: "input",
        passed: decision.allowed,
        tripwire: true,
        message: decision.allowed
          ? `Consent granted (${decision.status})`
          : `Consent denied: ${decision.reason ?? "rejected"}`,
      };
    },
  };
}
