import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

describe("Runner", () => {
  it("runs a single-turn agent", async () => {
    const agent = defineAgent({
      name: "greeter",
      instructions: "You greet people.",
    });

    const provider = createMockProvider([{ content: "Hello there!" }]);
    const runner = new Runner({ provider });

    const result = await runner.run(agent, { input: "Hi" });

    expect(result.output).toBe("Hello there!");
    expect(result.totalTurns).toBe(1);
    expect(result.finalAgent).toBe("greeter");
    expect(result.runId).toContain("run-");
    expect(result.traceId).toContain("trace-");
  });

  it("runs multi-turn with tool calls", async () => {
    const searchTool = defineTool({
      name: "search",
      description: "Search the web",
      inputSchema: z.object({ query: z.string() }),
      execute: async (input) => `Results for: ${input.query}`,
    });

    const agent = defineAgent({
      name: "researcher",
      instructions: "Use search tool to answer questions.",
      tools: [searchTool],
    });

    const provider = createMockProvider([
      // Turn 1: tool call
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "search", input: { query: "AI" } }],
        finishReason: "tool_use",
      },
      // Turn 2: final response
      { content: "Based on my search, AI is awesome!" },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Tell me about AI" });

    expect(result.output).toBe("Based on my search, AI is awesome!");
    expect(result.totalTurns).toBe(2);
    expect(provider.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it("respects maxTurns", async () => {
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

    // Always returns tool calls — never finishes
    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "noop", input: {} }],
        finishReason: "tool_use",
      },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Go", maxTurns: 3 });

    expect(result.totalTurns).toBe(3);
  });

  it("handles abort signal", async () => {
    const agent = defineAgent({ name: "abortable", instructions: "test" });
    const controller = new AbortController();
    controller.abort();

    // Provider that would hang, but abort should prevent the call
    const provider = createMockProvider([{ content: "never" }]);
    const runner = new Runner({ provider });

    await expect(runner.run(agent, { input: "Go", signal: controller.signal })).rejects.toThrow(
      "Run aborted",
    );
  });

  it("emits events via eventBus", async () => {
    const agent = defineAgent({ name: "emitter", instructions: "test" });
    const provider = createMockProvider([{ content: "Hello!" }]);
    const eventBus = new ADKEventBus();

    const startHandler = vi.fn();
    const completeHandler = vi.fn();
    eventBus.on("run.started", startHandler);
    eventBus.on("run.completed", completeHandler);

    const runner = new Runner({ provider, eventBus });
    await runner.run(agent, { input: "Hi" });

    expect(startHandler).toHaveBeenCalledOnce();
    expect(completeHandler).toHaveBeenCalledOnce();
  });

  it("tracks usage across turns", async () => {
    const agent = defineAgent({
      name: "tracked",
      instructions: "test",
      tools: [
        defineTool({
          name: "noop",
          description: "noop",
          inputSchema: { type: "object" },
          execute: async () => "ok",
        }),
      ],
    });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "noop", input: {} }],
        inputTokens: 20,
        outputTokens: 10,
        costUsd: 0.005,
      },
      { content: "Done", inputTokens: 30, outputTokens: 15, costUsd: 0.008 },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Go" });

    expect(result.usage.inputTokens).toBe(50);
    expect(result.usage.outputTokens).toBe(25);
    expect(result.usage.totalCostUsd).toBeCloseTo(0.013);
  });

  it("handles unknown tool gracefully", async () => {
    const agent = defineAgent({ name: "test", instructions: "test" });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "unknown_tool", input: {} }],
        finishReason: "tool_use",
      },
      { content: "Oops, that tool doesn't exist." },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Go" });

    expect(result.output).toBe("Oops, that tool doesn't exist.");
  });

  it("handles tool execution errors", async () => {
    const failingTool = defineTool({
      name: "fail",
      description: "Always fails",
      inputSchema: { type: "object" },
      execute: async () => {
        throw new Error("Tool broke");
      },
    });

    const agent = defineAgent({ name: "test", instructions: "test", tools: [failingTool] });

    const provider = createMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "fail", input: {} }],
        finishReason: "tool_use",
      },
      { content: "Tool failed, sorry." },
    ]);

    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Go" });

    expect(result.output).toBe("Tool failed, sorry.");
  });

  it("throws without provider", async () => {
    const agent = defineAgent({ name: "test", instructions: "test" });
    const runner = new Runner();

    await expect(runner.run(agent, { input: "Hi" })).rejects.toThrow("No LLM provider configured");
  });

  it("handles handoff to registered agent", async () => {
    const agentA = defineAgent({
      name: "router",
      instructions: "Route to specialist",
      handoffs: [{ agent: "specialist", description: "For specialized tasks" }],
    });

    const agentB = defineAgent({
      name: "specialist",
      instructions: "You are a specialist.",
    });

    const provider = createMockProvider([
      // Agent A: handoff
      {
        content: "",
        toolCalls: [
          { id: "tc-1", name: "transfer_to_specialist", input: { reason: "Needs expertise" } },
        ],
        finishReason: "tool_use",
      },
      // Agent B: final response
      { content: "I'm the specialist. Here's the answer." },
    ]);

    const runner = new Runner({ provider });
    runner.registerAgent(agentA);
    runner.registerAgent(agentB);

    const result = await runner.run(agentA, { input: "Help me" });

    expect(result.output).toBe("I'm the specialist. Here's the answer.");
    expect(result.finalAgent).toBe("specialist");
    expect(result.handoffs).toHaveLength(1);
    expect(result.handoffs[0]?.fromAgent).toBe("router");
    expect(result.handoffs[0]?.toAgent).toBe("specialist");
  });

  it("applies tool selection to filter tools per turn", async () => {
    // Create 10 tools
    const tools = Array.from({ length: 10 }, (_, i) =>
      defineTool({
        name: `tool_${i}`,
        description: `Tool ${i} for task ${i}`,
        inputSchema: { type: "object" },
        execute: async () => `result_${i}`,
      }),
    );

    const agent = defineAgent({
      name: "selective",
      instructions: "Use tools wisely.",
      tools,
      toolSelection: { strategy: "keyword", maxToolsPerTurn: 3 },
    });

    const provider = createMockProvider([{ content: "Done!" }]);
    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Use tool_0" });

    // Should complete without error — tools were filtered
    expect(result.output).toBe("Done!");
    // Verify provider was called with filtered tools
    const call = (provider.chatWithTools as any).mock.calls[0][0];
    expect(call.tools.length).toBeLessThanOrEqual(3);
  });

  it("sends all tools when no toolSelection configured", async () => {
    const tools = Array.from({ length: 5 }, (_, i) =>
      defineTool({
        name: `tool_${i}`,
        description: `Tool ${i}`,
        inputSchema: { type: "object" },
        execute: async () => `result_${i}`,
      }),
    );

    const agent = defineAgent({
      name: "all-tools",
      instructions: "Use all tools.",
      tools,
    });

    const provider = createMockProvider([{ content: "Done!" }]);
    const runner = new Runner({ provider });
    await runner.run(agent, { input: "Go" });

    const call = (provider.chatWithTools as any).mock.calls[0][0];
    expect(call.tools).toHaveLength(5);
  });

  it("never filters handoff tools", async () => {
    const tools = Array.from({ length: 5 }, (_, i) =>
      defineTool({
        name: `tool_${i}`,
        description: `Tool ${i}`,
        inputSchema: { type: "object" },
        execute: async () => `result_${i}`,
      }),
    );

    const agentA = defineAgent({
      name: "router",
      instructions: "Route requests.",
      tools,
      toolSelection: { strategy: "keyword", maxToolsPerTurn: 2 },
      handoffs: [{ agent: "specialist", description: "For specialized tasks" }],
    });

    const agentB = defineAgent({
      name: "specialist",
      instructions: "Specialist agent.",
    });

    const provider = createMockProvider([{ content: "Done!" }]);
    const runner = new Runner({ provider });
    runner.registerAgent(agentA);
    runner.registerAgent(agentB);
    await runner.run(agentA, { input: "Do something" });

    const call = (provider.chatWithTools as any).mock.calls[0][0];
    // Should have filtered tools + handoff tool
    const handoffTools = call.tools.filter((t: any) => t.name.startsWith("transfer_to_"));
    expect(handoffTools).toHaveLength(1);
    expect(handoffTools[0].name).toBe("transfer_to_specialist");
  });

  it("trims context when contextConfig is set", async () => {
    const agent = defineAgent({
      name: "context-managed",
      instructions: "Be concise.",
      contextConfig: { strategy: "sliding-window", maxContextTokens: 200 },
    });

    const provider = createMockProvider([
      // Turn 1: tool call to accumulate messages
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "noop", input: {} }],
        finishReason: "tool_use",
      },
      // Turn 2: done
      { content: "Done!" },
    ]);

    // Give agent a noop tool so it has tool calls
    const agentWithTool = defineAgent({
      ...agent.config,
      tools: [
        defineTool({
          name: "noop",
          description: "noop",
          inputSchema: { type: "object" },
          execute: async () => "ok",
        }),
      ],
      contextConfig: { strategy: "sliding-window", maxContextTokens: 200 },
    });

    const runner = new Runner({ provider });
    const result = await runner.run(agentWithTool, { input: "Go" });

    expect(result.output).toBe("Done!");
  });

  it("does not trim context when no contextConfig set (backward compat)", async () => {
    const agent = defineAgent({ name: "no-context", instructions: "test" });
    const provider = createMockProvider([{ content: "Hello!" }]);
    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Hi" });

    expect(result.output).toBe("Hello!");
    expect(result.messages.length).toBeGreaterThanOrEqual(2); // system + user + assistant
  });

  it("emits tools.selected events when tool selection is active", async () => {
    const tools = Array.from({ length: 5 }, (_, i) =>
      defineTool({
        name: `tool_${i}`,
        description: `Tool ${i}`,
        inputSchema: { type: "object" },
        execute: async () => `result_${i}`,
      }),
    );

    const agent = defineAgent({
      name: "event-selector",
      instructions: "test",
      tools,
      toolSelection: { strategy: "keyword", maxToolsPerTurn: 3 },
    });

    const provider = createMockProvider([{ content: "Done!" }]);
    const eventBus = new ADKEventBus();
    const handler = vi.fn();
    eventBus.on("tools.selected", handler);

    const runner = new Runner({ provider, eventBus });
    await runner.run(agent, { input: "Use tool_0" });

    expect(handler).toHaveBeenCalled();
    const event = handler.mock.calls[0][0];
    expect(event.totalTools).toBe(5);
    expect(event.selectedTools).toBeLessThanOrEqual(3);
    expect(event.strategy).toBe("keyword");
  });

  it("uses model catalog for context budget", async () => {
    const agent = defineAgent({
      name: "catalog-agent",
      instructions: "test",
      model: "claude-opus-4-6",
      contextConfig: { strategy: "sliding-window", contextBudgetRatio: 0.5 },
    });

    const provider = createMockProvider([{ content: "Done!" }]);
    const runner = new Runner({
      provider,
      modelCatalog: [
        {
          modelId: "claude-opus-4-6",
          providerId: "anthropic",
          displayName: "Claude Opus 4.6",
          description: "Best model",
          modality: "chat",
          capabilities: ["text"],
          costPerMTInput: 15,
          costPerMTOutput: 75,
          contextWindowInput: 200000,
          contextWindowOutput: 32000,
        },
      ],
    });

    const result = await runner.run(agent, { input: "Go" });
    expect(result.output).toBe("Done!");
  });

  it("stream yields events", async () => {
    const agent = defineAgent({ name: "streamer", instructions: "test" });
    const provider = createMockProvider([{ content: "Hello!" }]);
    const runner = new Runner({ provider });

    const events = [];
    for await (const event of runner.stream(agent, { input: "Hi" })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1]?.type).toBe("run_complete");
  });
});
