import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineAgent } from "../agent/define-agent";
import { defineTool } from "../tools/define-tool";
import type { SpanData } from "../tracing/span";
import { Tracer } from "../tracing/tracer";
import type { TraceData, TraceExporter } from "../tracing/tracer";
import type { ADKLLMProvider, ChatResponseWithToolCalls } from "../types/llm";
import { Runner } from "./runner";

/** Create a mock provider with scripted responses */
function createMockProvider(responses: Array<Partial<ChatResponseWithToolCalls>>): ADKLLMProvider {
  let callIndex = 0;
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
      const response = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return {
        content: response.content ?? "",
        model: "mock-model",
        providerId: "mock",
        inputTokens: response.inputTokens ?? 10,
        outputTokens: response.outputTokens ?? 5,
        totalTokens: 15,
        latencyMs: response.latencyMs ?? 100,
        costUsd: response.costUsd ?? 0.001,
        finishReason: response.finishReason ?? "stop",
        toolCalls: response.toolCalls,
      };
    }),
    async *chatStream() {
      yield { type: "text_delta" as const, content: "Hello" };
      yield { type: "message_end" as const, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

/** Collect exported trace data */
function createCollectorExporter(): { exporter: TraceExporter; traces: TraceData[] } {
  const traces: TraceData[] = [];
  return {
    exporter: {
      async export(trace: TraceData) {
        traces.push(trace);
      },
    },
    traces,
  };
}

describe("Runner Tracing", () => {
  it("produces a trace with run > turn > llm span hierarchy on single-turn run", async () => {
    const tracer = new Tracer();
    const { exporter, traces } = createCollectorExporter();
    tracer.addExporter(exporter);

    const agent = defineAgent({
      name: "greeter",
      instructions: "You greet people.",
    });

    const provider = createMockProvider([{ content: "Hello!" }]);
    const runner = new Runner({ provider, tracer });

    const result = await runner.run(agent, { input: "Hi" });

    expect(result.output).toBe("Hello!");
    expect(traces).toHaveLength(1);

    const trace = traces[0]!;
    expect(trace.name).toBe("greeter");
    expect(trace.metadata.runId).toContain("run-");

    // Should have spans: run, turn-1, llm
    const spans = trace.spans;
    expect(spans.length).toBeGreaterThanOrEqual(3);

    const runSpan = spans.find((s: SpanData) => s.name === "run");
    expect(runSpan).toBeDefined();
    expect(runSpan?.type).toBe("agent");
    expect(runSpan?.attributes.agentName).toBe("greeter");
    expect(runSpan?.attributes.totalTurns).toBe(1);

    const turnSpan = spans.find((s: SpanData) => s.name === "turn-1");
    expect(turnSpan).toBeDefined();
    expect(turnSpan?.type).toBe("agent");
    expect(turnSpan?.parentSpanId).toBe(runSpan?.id);

    const llmSpan = spans.find((s: SpanData) => s.name === "llm");
    expect(llmSpan).toBeDefined();
    expect(llmSpan?.type).toBe("llm");
    expect(llmSpan?.attributes.inputTokens).toBe(10);
    expect(llmSpan?.attributes.outputTokens).toBe(5);
  });

  it("produces tool spans when tools are called", async () => {
    const tracer = new Tracer();
    const { exporter, traces } = createCollectorExporter();
    tracer.addExporter(exporter);

    const searchTool = defineTool({
      name: "search",
      description: "Search the web",
      inputSchema: z.object({ query: z.string() }),
      execute: async (input) => `Results for: ${input.query}`,
    });

    const agent = defineAgent({
      name: "researcher",
      instructions: "Use search tool.",
      tools: [searchTool],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "search", input: { query: "AI" } }],
        finishReason: "tool_use",
      },
      { content: "AI is great!" },
    ]);

    const runner = new Runner({ provider, tracer });
    const result = await runner.run(agent, { input: "Tell me about AI" });

    expect(result.output).toBe("AI is great!");
    expect(traces).toHaveLength(1);

    const spans = traces[0]?.spans;

    // Should have a tool span
    const toolSpan = spans.find((s: SpanData) => s.name === "tool:search");
    expect(toolSpan).toBeDefined();
    expect(toolSpan?.type).toBe("tool");
    expect(toolSpan?.attributes.toolName).toBe("search");
    expect(toolSpan?.attributes.success).toBe(true);
    expect(typeof toolSpan?.attributes.latencyMs).toBe("number");

    // Should have 2 llm spans (2 turns)
    const llmSpans = spans.filter((s: SpanData) => s.type === "llm");
    expect(llmSpans).toHaveLength(2);

    // Should have 2 turn spans
    const turnSpans = spans.filter((s: SpanData) => s.name.startsWith("turn-"));
    expect(turnSpans).toHaveLength(2);
  });

  it("works gracefully without a tracer (no errors)", async () => {
    const agent = defineAgent({
      name: "greeter",
      instructions: "You greet people.",
    });

    const provider = createMockProvider([{ content: "Hello!" }]);

    // No tracer passed — should work fine
    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Hi" });

    expect(result.output).toBe("Hello!");
    expect(result.totalTurns).toBe(1);
  });

  it("calls endAndExport on successful completion", async () => {
    const tracer = new Tracer();
    const endAndExportSpy = vi.spyOn(tracer, "endAndExport");
    const { exporter } = createCollectorExporter();
    tracer.addExporter(exporter);

    const agent = defineAgent({
      name: "greeter",
      instructions: "You greet people.",
    });

    const provider = createMockProvider([{ content: "Hello!" }]);
    const runner = new Runner({ provider, tracer });

    await runner.run(agent, { input: "Hi" });

    expect(endAndExportSpy).toHaveBeenCalledTimes(1);
    // The trace passed to endAndExport should be valid
    const trace = endAndExportSpy.mock.calls[0]?.[0];
    expect(trace.name).toBe("greeter");
  });

  it("calls endAndExport on max turns reached", async () => {
    const tracer = new Tracer();
    const endAndExportSpy = vi.spyOn(tracer, "endAndExport");
    const { exporter } = createCollectorExporter();
    tracer.addExporter(exporter);

    const agent = defineAgent({
      name: "looper",
      instructions: "Always call tools.",
      tools: [
        defineTool({
          name: "noop",
          description: "Do nothing",
          inputSchema: { type: "object" },
          execute: async () => "ok",
        }),
      ],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "noop", input: {} }],
        finishReason: "tool_use",
      },
    ]);

    const runner = new Runner({ provider, tracer });
    const result = await runner.run(agent, { input: "Loop", maxTurns: 2 });

    expect(result.totalTurns).toBe(2);
    expect(endAndExportSpy).toHaveBeenCalledTimes(1);
  });

  it("records error attributes on tool failure spans", async () => {
    const tracer = new Tracer();
    const { exporter, traces } = createCollectorExporter();
    tracer.addExporter(exporter);

    const failingTool = defineTool({
      name: "fail_tool",
      description: "Always fails",
      inputSchema: z.object({ input: z.string() }),
      execute: async () => {
        throw new Error("Tool exploded");
      },
    });

    const agent = defineAgent({
      name: "failure-tester",
      instructions: "Use the tool.",
      tools: [failingTool],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "fail_tool", input: { input: "test" } }],
        finishReason: "tool_use",
      },
      { content: "Tool failed, sorry." },
    ]);

    const runner = new Runner({ provider, tracer });
    const result = await runner.run(agent, { input: "Test" });

    expect(result.output).toBe("Tool failed, sorry.");
    expect(traces).toHaveLength(1);

    const spans = traces[0]?.spans;
    const toolSpan = spans.find((s: SpanData) => s.name === "tool:fail_tool");
    expect(toolSpan).toBeDefined();
    expect(toolSpan?.attributes.success).toBe(false);
    expect(toolSpan?.status).toBe("error");
    expect(toolSpan?.error).toContain("Tool exploded");
  });

  it("includes run metadata (runId, sessionId) on the trace", async () => {
    const tracer = new Tracer();
    const { exporter, traces } = createCollectorExporter();
    tracer.addExporter(exporter);

    const agent = defineAgent({
      name: "session-agent",
      instructions: "Session test.",
    });

    const provider = createMockProvider([{ content: "Done." }]);
    const runner = new Runner({ provider, tracer });

    await runner.run(agent, { input: "Hi", sessionId: "sess-123" });

    expect(traces).toHaveLength(1);
    const trace = traces[0]!;
    expect(trace.metadata.runId).toBeDefined();
    expect(trace.metadata.sessionId).toBe("sess-123");
  });

  it("all spans have end times (are properly closed)", async () => {
    const tracer = new Tracer();
    const { exporter, traces } = createCollectorExporter();
    tracer.addExporter(exporter);

    const agent = defineAgent({
      name: "complete-agent",
      instructions: "Do things.",
    });

    const provider = createMockProvider([{ content: "Done." }]);
    const runner = new Runner({ provider, tracer });

    await runner.run(agent, { input: "Hi" });

    const spans = traces[0]?.spans;
    for (const span of spans) {
      expect(span.endTime).toBeDefined();
      expect(span.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
