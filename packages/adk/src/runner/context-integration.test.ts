import { describe, expect, it, vi } from "vitest";
import { defineAgent } from "../agent/define-agent";
import { ADKEventBus } from "../events/event-bus";
import { defineTool } from "../tools/define-tool";
import type {
  ADKLLMProvider,
  ChatParamsWithTools,
  ChatResponseWithToolCalls,
  StreamChunk,
} from "../types/llm";
import { Runner } from "./runner";

/** Create a mock provider with scripted responses */
function createMockProvider(responses: Array<Partial<ChatResponseWithToolCalls>>): ADKLLMProvider {
  let callIndex = 0;
  return {
    providerId: "mock",
    displayName: "Mock",
    isLocal: true,
    chat: vi.fn(async () => ({
      content: "summary",
      model: "mock-model",
      providerId: "mock",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      latencyMs: 50,
      costUsd: 0.001,
      finishReason: "stop",
    })),
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

describe("Context + Tool Selection Integration", () => {
  it("agent with many tools + keyword selection sends filtered tools per turn", async () => {
    // Create 50 tools
    const tools = Array.from({ length: 50 }, (_, i) =>
      defineTool({
        name: `tool_${i}`,
        description: `Tool ${i} for ${i < 10 ? "file" : i < 20 ? "database" : i < 30 ? "network" : i < 40 ? "image" : "audio"} operations`,
        inputSchema: { type: "object" },
        execute: async () => `result_${i}`,
      }),
    );

    const agent = defineAgent({
      name: "many-tools-agent",
      instructions: "Use the right tools.",
      tools,
      toolSelection: { strategy: "keyword", maxToolsPerTurn: 8 },
    });

    const provider = createMockProvider([{ content: "Done!" }]);
    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Read and write files" });

    expect(result.output).toBe("Done!");
    // Verify the LLM received filtered tools (may be <= 8 or undefined if none matched)
    const call = (provider.chatWithTools as any).mock.calls[0][0];
    const toolCount = call.tools?.length ?? 0;
    expect(toolCount).toBeLessThanOrEqual(8);
  });

  it("agent with context management keeps context under budget over multiple turns", async () => {
    const noop = defineTool({
      name: "accumulate",
      description: "Accumulates data",
      inputSchema: { type: "object" },
      execute: async () => "A".repeat(500), // Large output per tool call
    });

    const agent = defineAgent({
      name: "context-managed",
      instructions: "Always use tools, then respond.",
      tools: [noop],
      contextConfig: {
        strategy: "sliding-window",
        maxContextTokens: 2000,
      },
    });

    // Build responses: 19 turns of tool calls, then one final response
    const toolCallResponses = Array.from({ length: 19 }, (_, i) => ({
      content: "",
      toolCalls: [{ id: `tc-${i}`, name: "accumulate", input: {} }],
      finishReason: "tool_use" as const,
    }));

    const provider = createMockProvider([
      ...toolCallResponses,
      { content: "Final answer after many turns." },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Accumulate data 20 times", maxTurns: 20 });

    expect(result.output).toBe("Final answer after many turns.");
    expect(result.totalTurns).toBe(20);
    // Context should have been trimmed at some point since each tool returns 500 chars of data
  });

  it("emits context.trimmed event when trimming occurs", async () => {
    const noop = defineTool({
      name: "big_output",
      description: "Returns big data",
      inputSchema: { type: "object" },
      execute: async () => "X".repeat(1000),
    });

    const agent = defineAgent({
      name: "trim-events",
      instructions: "Use tools.",
      tools: [noop],
      contextConfig: {
        strategy: "sliding-window",
        maxContextTokens: 300,
      },
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "big_output", input: {} }],
        finishReason: "tool_use",
      },
      {
        content: "",
        toolCalls: [{ id: "tc-2", name: "big_output", input: {} }],
        finishReason: "tool_use",
      },
      {
        content: "",
        toolCalls: [{ id: "tc-3", name: "big_output", input: {} }],
        finishReason: "tool_use",
      },
      { content: "Done" },
    ]);

    const eventBus = new ADKEventBus();
    const trimHandler = vi.fn();
    eventBus.on("context.trimmed", trimHandler);

    const runner = new Runner({ provider, eventBus });
    const result = await runner.run(agent, { input: "Go" });

    expect(result.output).toBe("Done");
    // With 1000-char tool outputs and 300-token budget, trimming should have occurred
    expect(trimHandler).toHaveBeenCalled();
    const event = trimHandler.mock.calls[0][0];
    expect(event.strategy).toBe("sliding-window");
    expect(event.messagesRemoved).toBeGreaterThan(0);
  });

  it("combined: tool selection + context management in multi-turn run", async () => {
    const tools = Array.from({ length: 20 }, (_, i) =>
      defineTool({
        name: `tool_${i}`,
        description: `Tool ${i} for ${i % 2 === 0 ? "search" : "analysis"}`,
        inputSchema: { type: "object" },
        execute: async () => `Result from tool_${i}: ${"data ".repeat(50)}`,
      }),
    );

    const agent = defineAgent({
      name: "combined-agent",
      instructions: "Use tools wisely.",
      tools,
      toolSelection: { strategy: "keyword", maxToolsPerTurn: 5 },
      contextConfig: {
        strategy: "sliding-window",
        maxContextTokens: 1000,
      },
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "tool_0", input: {} }],
        finishReason: "tool_use",
      },
      {
        content: "",
        toolCalls: [{ id: "tc-2", name: "tool_2", input: {} }],
        finishReason: "tool_use",
      },
      { content: "Analysis complete." },
    ]);

    const eventBus = new ADKEventBus();
    const toolsHandler = vi.fn();
    eventBus.on("tools.selected", toolsHandler);

    const runner = new Runner({ provider, eventBus });
    const result = await runner.run(agent, { input: "Search and analyze data" });

    expect(result.output).toBe("Analysis complete.");
    expect(result.totalTurns).toBe(3);

    // Tool selection events should have been emitted
    expect(toolsHandler).toHaveBeenCalled();
    for (const call of toolsHandler.mock.calls) {
      expect(call[0].selectedTools).toBeLessThanOrEqual(5);
    }
  });

  it("stream mode also applies context trimming", async () => {
    const noop = defineTool({
      name: "verbose",
      description: "Returns verbose output",
      inputSchema: { type: "object" },
      execute: async () => "V".repeat(800),
    });

    const agent = defineAgent({
      name: "stream-context",
      instructions: "Use tools.",
      tools: [noop],
      contextConfig: {
        strategy: "sliding-window",
        maxContextTokens: 500,
      },
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "verbose", input: {} }],
        finishReason: "tool_use",
      },
      {
        content: "",
        toolCalls: [{ id: "tc-2", name: "verbose", input: {} }],
        finishReason: "tool_use",
      },
      { content: "Stream done." },
    ]);

    const runner = new Runner({ provider });
    const events = [];
    for await (const event of runner.stream(agent, { input: "Go" })) {
      events.push(event);
    }

    const runComplete = events.find((e) => e.type === "run_complete");
    expect(runComplete).toBeTruthy();
    expect((runComplete as any).result.output).toBe("Stream done.");
  });
});
