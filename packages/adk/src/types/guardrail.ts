// ──────────────────────────────────────────────────────
// ADK Guardrail Types
// ──────────────────────────────────────────────────────

import type { Content } from "./content";
import type { ChatMessage } from "./llm";
import type { RunContext } from "./runner";

/** Guardrail type */
export type GuardrailType = "input" | "output" | "tool";

/** Severity level for guardrail results */
export type GuardrailSeverity = "info" | "warning" | "error" | "critical";

/** Guardrail result */
export interface GuardrailResult {
  name: string;
  type: GuardrailType;
  passed: boolean;
  /** If true and passed=false, immediately stop the run */
  tripwire: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
  /** Severity level (default: "error" for backward compat) */
  severity?: GuardrailSeverity;
  /** Confidence score 0-1 */
  score?: number;
}

/** Input guardrail — runs before LLM call */
export interface InputGuardrail {
  name: string;
  type: "input";
  /** Whether failing this guardrail should stop execution immediately */
  tripwire: boolean;
  execute(input: string, messages: ChatMessage[], ctx: RunContext): Promise<GuardrailResult>;
}

/** Output guardrail — runs after LLM response */
export interface OutputGuardrail {
  name: string;
  type: "output";
  tripwire: boolean;
  execute(output: string, messages: ChatMessage[], ctx: RunContext): Promise<GuardrailResult>;
}

/** Tool guardrail — runs before tool execution */
export interface ToolGuardrail {
  name: string;
  type: "tool";
  tripwire: boolean;
  execute(toolName: string, input: unknown, ctx: RunContext): Promise<GuardrailResult>;
}

/**
 * Content guardrail — forward-compatible type for multi-modal content inspection.
 * Not wired into the engine yet. Defined here for future use by guardrail authors.
 */
export interface ContentGuardrail {
  name: string;
  type: "content";
  tripwire: boolean;
  execute(content: Content, messages: ChatMessage[], ctx: RunContext): Promise<GuardrailResult>;
}

/** Union of all guardrail types */
export type Guardrail = InputGuardrail | OutputGuardrail | ToolGuardrail;

/** Guardrail configuration (used in AgentConfig) */
export interface GuardrailConfig {
  guardrail: Guardrail;
  /** Override tripwire setting */
  tripwire?: boolean;
}

/** Consent decision (from platform consent gate) */
export interface ConsentDecision {
  allowed: boolean;
  requestId?: string;
  status: "approved" | "rejected" | "pending" | "expired" | "auto";
  reason?: string;
}

/** Consent request for explicit/multi-party consent */
export interface ConsentRequest {
  id: string;
  agentName: string;
  action: string;
  consentLevel: "auto" | "notify" | "explicit" | "multi_party";
  requiredApprovals: number;
  currentApprovals: string[];
  rejectedBy: string | null;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, unknown>;
}

/** Consent handler (provided by caller for explicit consent flows) */
export type ConsentHandler = (request: ConsentRequest) => Promise<ConsentDecision>;
