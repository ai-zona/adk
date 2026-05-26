// ──────────────────────────────────────────────────────
// ADK Run Audit Trail
// ──────────────────────────────────────────────────────
// Structured summary emitted at the end of every run for compliance,
// debugging, billing, and offline analysis. Independent of the live
// event bus — captured even when no listener is attached.
// ──────────────────────────────────────────────────────

import type { ClassifiedError } from "../errors/classify";
import type { GuardrailResult } from "./guardrail";
import type { HandoffRecord, RunUsage } from "./runner";

/** Status reached by a run. */
export type RunAuditStatus = "completed" | "max_turns" | "aborted" | "errored";

/** Per-turn breakdown of token usage and tool activity. */
export interface RunAuditTurn {
  turnNumber: number;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  toolCalls: string[];
  /** Provider id reported by the LLM call, if known. */
  providerId?: string;
  /** Model id reported by the LLM call, if known. */
  model?: string;
}

/** Aggregated tool-call summary across the run. */
export interface RunAuditToolCall {
  name: string;
  count: number;
  totalDurationMs: number;
  errors: number;
}

/**
 * Structured audit record emitted at the end of every run.
 * Sent on the event bus as "run.audit" and to the optional
 * onRunComplete callback. Persist this for compliance / billing.
 */
export interface RunAudit {
  runId: string;
  traceId: string;
  sessionId?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: RunAuditStatus;

  finalAgent: string;
  totalTurns: number;
  turns: RunAuditTurn[];

  usage: RunUsage;
  toolCalls: RunAuditToolCall[];
  handoffs: HandoffRecord[];
  guardrailResults: GuardrailResult[];

  /** Populated when status === "errored" or "aborted". */
  error?: ClassifiedError;
}
