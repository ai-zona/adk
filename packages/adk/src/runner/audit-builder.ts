// ──────────────────────────────────────────────────────
// RunAuditBuilder
// ──────────────────────────────────────────────────────
// Accumulates per-turn and per-tool stats during a run, then
// produces a RunAudit record on finish().
// ──────────────────────────────────────────────────────

import type { ClassifiedError } from "../errors/classify";
import type { RunAudit, RunAuditStatus, RunAuditTurn } from "../types/audit";
import type { GuardrailResult } from "../types/guardrail";
import type { HandoffRecord, RunUsage } from "../types/runner";

export interface AuditTurnInput {
  turnNumber: number;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  toolCalls: string[];
  providerId?: string;
  model?: string;
}

export interface AuditToolInput {
  name: string;
  durationMs: number;
  isError: boolean;
}

export class RunAuditBuilder {
  private readonly turns: RunAuditTurn[] = [];
  private readonly toolTotals = new Map<
    string,
    { count: number; totalDurationMs: number; errors: number }
  >();
  private readonly startWallMs = Date.now();
  private readonly startedAt = new Date(this.startWallMs).toISOString();

  constructor(
    private readonly runId: string,
    private readonly traceId: string,
    private readonly sessionId?: string,
  ) {}

  recordTurn(turn: AuditTurnInput): void {
    this.turns.push({ ...turn });
  }

  recordTool({ name, durationMs, isError }: AuditToolInput): void {
    const entry = this.toolTotals.get(name) ?? { count: 0, totalDurationMs: 0, errors: 0 };
    entry.count += 1;
    entry.totalDurationMs += durationMs;
    if (isError) entry.errors += 1;
    this.toolTotals.set(name, entry);
  }

  finish(args: {
    status: RunAuditStatus;
    finalAgent: string;
    totalTurns: number;
    usage: RunUsage;
    handoffs: HandoffRecord[];
    guardrailResults: GuardrailResult[];
    error?: ClassifiedError;
  }): RunAudit {
    const endWallMs = Date.now();
    return {
      runId: this.runId,
      traceId: this.traceId,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: new Date(endWallMs).toISOString(),
      durationMs: endWallMs - this.startWallMs,
      status: args.status,
      finalAgent: args.finalAgent,
      totalTurns: args.totalTurns,
      turns: [...this.turns],
      usage: { ...args.usage },
      toolCalls: [...this.toolTotals.entries()].map(([name, t]) => ({
        name,
        count: t.count,
        totalDurationMs: t.totalDurationMs,
        errors: t.errors,
      })),
      handoffs: [...args.handoffs],
      guardrailResults: [...args.guardrailResults],
      error: args.error,
    };
  }
}
