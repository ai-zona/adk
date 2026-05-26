import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAgent } from "../agent/define-agent";
import { ADKEventBus } from "../events/event-bus";
import { MemoryTransport } from "../logging/logger";
import { Logger } from "../logging/logger";
import { MetricsCollector, METRIC_NAMES } from "../metrics/collector";
import { ADKProviderError } from "../providers/errors";
import { defineTool } from "../tools/define-tool";
import type { RunAudit } from "../types/audit";
import type { ADKLLMProvider, ChatResponseWithToolCalls } from "../types/llm";
import { Runner } from "./runner";

function mockProvider(responses: Array<Partial<ChatResponseWithToolCalls>>): ADKLLMProvider {
  let i = 0;
  return {
    providerId: "mock",
    displayName: "Mock",
    isLocal: true,
    chat: vi.fn(),
    complete: vi.fn(),
    isAvailable: () => true,
    getModels: () => ["mock-model"],
    estimateCost: () => 0,
    chatWithTools: vi.fn(async () => {
      const r = responses[i] ?? responses[responses.length - 1]!;
      i++;
      return {
        content: r.content ?? "",
        model: "mock-model",
        providerId: "mock",
        inputTokens: r.inputTokens ?? 10,
        outputTokens: r.outputTokens ?? 5,
        totalTokens: 15,
        latencyMs: r.latencyMs ?? 50,
        costUsd: r.costUsd ?? 0.001,
        finishReason: r.finishReason ?? "stop",
        toolCalls: r.toolCalls,
      };
    }),
    async *chatStream() {
      yield { type: "message_end" as const, usage: { inputTokens: 0, outputTokens: 0 } };
    },
  };
}

describe("Runner observability", () => {
  it("emits a structured log on run start and completion", async () => {
    const transport = new MemoryTransport();
    const logger = new Logger({ level: "debug", transport });
    const runner = new Runner({
      provider: mockProvider([{ content: "hi" }]),
      logger,
      metrics: new MetricsCollector(),
    });
    const agent = defineAgent({ name: "alice", instructions: "be nice" });

    await runner.run(agent, { input: "hello" });

    const messages = transport.records.map((r) => r.message);
    expect(messages).toContain("run started");
    expect(messages).toContain("run completed");

    const completed = transport.records.find((r) => r.message === "run completed")!;
    expect(completed.context.runId).toContain("run-");
    expect(completed.context.agentName).toBe("alice");
    expect(completed.context.totalTurns).toBe(1);
  });

  it("records metrics: runs_total, runs_active, turns_per_run, tokens_used", async () => {
    const metrics = new MetricsCollector();
    const runner = new Runner({
      provider: mockProvider([
        { content: "", toolCalls: [{ id: "1", name: "echo", input: {} }], finishReason: "tool_use" },
        { content: "done" },
      ]),
      metrics,
    });
    const echo = defineTool({
      name: "echo",
      description: "echo",
      inputSchema: z.object({}),
      execute: async () => "ok",
    });
    const agent = defineAgent({ name: "bob", instructions: "x", tools: [echo] });

    await runner.run(agent, { input: "hi" });

    const snap = metrics.getMetrics();
    const runStarts = snap.counters[METRIC_NAMES.runsTotal]?.find(
      (e) => e.labels.status === "started",
    );
    const runCompleted = snap.counters[METRIC_NAMES.runsTotal]?.find(
      (e) => e.labels.status === "completed",
    );
    expect(runStarts?.value).toBe(1);
    expect(runCompleted?.value).toBe(1);

    // Gauge balances back to 0
    const active = snap.gauges[METRIC_NAMES.runsActive]?.[0];
    expect(active?.value).toBe(0);

    // turns_per_run histogram observed once with value 2
    const tpr = snap.histograms[METRIC_NAMES.turnsPerRun]?.[0];
    expect(tpr?.count).toBe(1);
    expect(tpr?.sum).toBe(2);

    // tokens_used recorded with provider+model+type labels
    const inputTokens = snap.counters[METRIC_NAMES.tokensUsed]?.find(
      (e) => e.labels.type === "input",
    );
    const outputTokens = snap.counters[METRIC_NAMES.tokensUsed]?.find(
      (e) => e.labels.type === "output",
    );
    expect(inputTokens?.value).toBe(20);
    expect(outputTokens?.value).toBe(10);

    // tool_calls_total recorded for echo
    const toolCalls = snap.counters[METRIC_NAMES.toolCallsTotal]?.find(
      (e) => e.labels.tool === "echo" && e.labels.status === "ok",
    );
    expect(toolCalls?.value).toBe(1);
    // tool_call_duration_ms histogram observed
    const toolDur = snap.histograms[METRIC_NAMES.toolCallDurationMs]?.find(
      (e) => e.labels.tool === "echo",
    );
    expect(toolDur?.count).toBe(1);
  });

  it("calls onRunComplete with a RunAudit and emits run.audit event", async () => {
    const onRunComplete = vi.fn();
    const bus = new ADKEventBus();
    const auditEvents: RunAudit[] = [];
    bus.on("run.audit" as never, ((payload: RunAudit) => auditEvents.push(payload)) as never);

    const runner = new Runner({
      provider: mockProvider([{ content: "done" }]),
      eventBus: bus,
      onRunComplete,
      metrics: new MetricsCollector(),
    });
    const agent = defineAgent({ name: "carol", instructions: "x" });

    await runner.run(agent, { input: "hi", sessionId: "sess-1" });

    expect(onRunComplete).toHaveBeenCalledTimes(1);
    const audit = onRunComplete.mock.calls[0]![0] as RunAudit;
    expect(audit.status).toBe("completed");
    expect(audit.finalAgent).toBe("carol");
    expect(audit.totalTurns).toBe(1);
    expect(audit.sessionId).toBe("sess-1");
    expect(audit.turns).toHaveLength(1);
    expect(audit.turns[0]?.inputTokens).toBe(10);
    expect(audit.turns[0]?.providerId).toBe("mock");
    expect(audit.durationMs).toBeGreaterThanOrEqual(0);

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]?.runId).toBe(audit.runId);
  });

  it("invokes onError with a ClassifiedError when the provider throws", async () => {
    const onError = vi.fn();
    const onRunComplete = vi.fn();
    const metrics = new MetricsCollector();
    const provider: ADKLLMProvider = {
      providerId: "mock",
      displayName: "Mock",
      isLocal: true,
      chat: vi.fn(),
      complete: vi.fn(),
      isAvailable: () => true,
      getModels: () => [],
      estimateCost: () => 0,
      chatWithTools: vi.fn(async () => {
        throw ADKProviderError.rateLimited("mock", 500);
      }),
      async *chatStream() {
        yield { type: "message_end" as const, usage: { inputTokens: 0, outputTokens: 0 } };
      },
    };

    const runner = new Runner({ provider, onError, onRunComplete, metrics });
    const agent = defineAgent({ name: "dan", instructions: "x" });

    await expect(runner.run(agent, { input: "hi" })).rejects.toThrow();

    expect(onError).toHaveBeenCalled();
    const classified = onError.mock.calls[0]![0];
    expect(classified.category).toBe("transient");
    expect(classified.providerId).toBe("mock");
    expect(classified.code).toBe("RATE_LIMITED");

    // Audit still fires with status=errored
    expect(onRunComplete).toHaveBeenCalledTimes(1);
    const audit = onRunComplete.mock.calls[0]![0] as RunAudit;
    expect(audit.status).toBe("errored");
    expect(audit.error?.category).toBe("transient");

    // Error metric incremented and active gauge balanced
    const snap = metrics.getMetrics();
    const errs = snap.counters[METRIC_NAMES.errorsByType]?.find(
      (e) => e.labels.code === "RATE_LIMITED",
    );
    expect(errs?.value).toBeGreaterThanOrEqual(1);
    const active = snap.gauges[METRIC_NAMES.runsActive]?.[0];
    expect(active?.value).toBe(0);
  });

  it("records guardrail trigger metric when a guardrail fails (info severity, non-blocking)", async () => {
    const metrics = new MetricsCollector();
    const runner = new Runner({
      provider: mockProvider([{ content: "done" }]),
      metrics,
    });

    const agent = defineAgent({
      name: "evan",
      instructions: "x",
      guardrails: [
        {
          guardrail: {
            type: "output",
            name: "soft-warn",
            tripwire: false,
            execute: async () => ({
              name: "soft-warn",
              type: "output",
              passed: false,
              tripwire: false,
              severity: "info",
              message: "minor",
            }),
          },
        },
      ],
    });

    await runner.run(agent, { input: "hi" });

    const snap = metrics.getMetrics();
    const trig = snap.counters[METRIC_NAMES.guardrailTriggers]?.find(
      (e) => e.labels.guardrail === "soft-warn",
    );
    expect(trig?.value).toBe(1);
  });
});
