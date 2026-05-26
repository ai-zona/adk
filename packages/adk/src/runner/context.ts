// ──────────────────────────────────────────────────────
// ADK RunContext Builder
// ──────────────────────────────────────────────────────

import type { RunContext, RunUsage } from "../types/runner";

let runCounter = 0;

export function createRunId(): string {
  return `run-${Date.now()}-${++runCounter}`;
}

export function createTraceId(): string {
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRunContext(opts: {
  runId?: string;
  agentName: string;
  sessionId?: string;
  traceId?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
}): RunContext {
  return {
    runId: opts.runId ?? createRunId(),
    agentName: opts.agentName,
    turnNumber: 0,
    sessionId: opts.sessionId,
    traceId: opts.traceId ?? createTraceId(),
    usage: createEmptyUsage(),
    signal: opts.signal,
    metadata: opts.metadata ?? {},
  };
}

export function createEmptyUsage(): RunUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    latencyMs: 0,
  };
}

export function addUsage(
  target: RunUsage,
  source: { inputTokens: number; outputTokens: number; costUsd: number; latencyMs: number },
): void {
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.totalCostUsd += source.costUsd;
  target.latencyMs += source.latencyMs;
}
