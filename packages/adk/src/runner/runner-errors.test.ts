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

function makeMockProvider(
  responses: Array<Partial<ChatResponseWithToolCalls>>,
): ADKLLMProvider & { chatWithTools: ReturnType<typeof vi.fn> } {
  let idx = 0;
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
      const r = responses[idx] ?? responses[responses.length - 1]!;
      idx++;
      return {
        content: r.content ?? "",
        model: "mock-model",
        providerId: "mock",
        inputTokens: r.inputTokens ?? 10,
        outputTokens: r.outputTokens ?? 5,
        totalTokens: 15,
        latencyMs: 50,
        costUsd: r.costUsd ?? 0.001,
        finishReason: r.finishReason ?? "stop",
        toolCalls: r.toolCalls,
      };
    }),
    async *chatStream(_p: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
      yield { type: "text_delta", content: "x" };
      yield { type: "message_end", usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

describe("Runner error paths", () => {
  it("throws when provider is unavailable / missing", async () => {
    const agent = defineAgent({ name: "noprov", instructions: "x" });
    const runner = new Runner();
    await expect(runner.run(agent, { input: "Hi" })).rejects.toThrow(
      "No LLM provider configured",
    );
  });

  it("setProvider() can recover from a missing provider", async () => {
    const agent = defineAgent({ name: "lateprov", instructions: "x" });
    const runner = new Runner();
    runner.setProvider(makeMockProvider([{ content: "done" }]));
    const result = await runner.run(agent, { input: "Hi" });
    expect(result.output).toBe("done");
  });

  it("stream throws when provider is missing", async () => {
    const agent = defineAgent({ name: "noprov-stream", instructions: "x" });
    const runner = new Runner();
    const iter = runner.stream(agent, { input: "Hi" });
    await expect(iter.next()).rejects.toThrow("No LLM provider configured");
  });

  it("respects maxTurns when LLM keeps requesting tools", async () => {
    const tool = defineTool({
      name: "loop",
      description: "loop",
      inputSchema: { type: "object" },
      execute: async () => "ok",
    });
    const agent = defineAgent({ name: "infloop", instructions: "x", tools: [tool] });
    const provider = makeMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "loop", input: {} }],
        finishReason: "tool_use",
      },
    ]);
    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Go", maxTurns: 5 });
    expect(result.totalTurns).toBe(5);
    expect(provider.chatWithTools).toHaveBeenCalledTimes(5);
  });

  it("aborts mid-run when signal fires", async () => {
    const tool = defineTool({
      name: "slow",
      description: "slow",
      inputSchema: { type: "object" },
      execute: async () => "ok",
    });
    const agent = defineAgent({ name: "abort-mid", instructions: "x", tools: [tool] });

    const controller = new AbortController();
    const provider = makeMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "slow", input: {} }],
        finishReason: "tool_use",
      },
      { content: "never" },
    ]);
    // Abort after first chatWithTools resolves
    const originalChat = provider.chatWithTools;
    provider.chatWithTools = vi.fn(async (p: ChatParamsWithTools) => {
      const r = await originalChat(p);
      controller.abort();
      return r;
    });
    const runner = new Runner({ provider });
    await expect(
      runner.run(agent, { input: "Go", signal: controller.signal, maxTurns: 5 }),
    ).rejects.toThrow("Run aborted");
  });

  it("stream throws on aborted signal", async () => {
    const agent = defineAgent({ name: "abort-stream", instructions: "x" });
    const controller = new AbortController();
    controller.abort();
    const provider = makeMockProvider([{ content: "x" }]);
    const runner = new Runner({ provider });
    const iter = runner.stream(agent, { input: "Hi", signal: controller.signal });
    await expect(iter.next()).rejects.toThrow("Run aborted");
  });

  it("throws on handoff to unregistered agent", async () => {
    const agent = defineAgent({
      name: "router",
      instructions: "x",
      handoffs: [{ agent: "ghost", description: "Missing target" }],
    });
    const provider = makeMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "transfer_to_ghost", input: { reason: "go" } }],
        finishReason: "tool_use",
      },
    ]);
    const runner = new Runner({ provider });
    await expect(runner.run(agent, { input: "Help" })).rejects.toThrow(
      /Handoff target "ghost" not registered/,
    );
  });

  it("stream throws on unregistered handoff target", async () => {
    const agent = defineAgent({
      name: "router-stream",
      instructions: "x",
      handoffs: [{ agent: "ghost", description: "Missing" }],
    });
    const provider = makeMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "transfer_to_ghost", input: { reason: "go" } }],
        finishReason: "tool_use",
      },
    ]);
    const runner = new Runner({ provider });
    const iter = runner.stream(agent, { input: "Help" });
    await expect(async () => {
      for await (const _e of iter) {
        // drain until handoff throw
      }
    }).rejects.toThrow(/Handoff target "ghost" not registered/);
  });

  it("emits run.completed even when maxTurns is reached", async () => {
    const tool = defineTool({
      name: "loop",
      description: "loop",
      inputSchema: { type: "object" },
      execute: async () => "ok",
    });
    const agent = defineAgent({ name: "loopy", instructions: "x", tools: [tool] });
    const provider = makeMockProvider([
      {
        content: "",
        toolCalls: [{ id: "tc-1", name: "loop", input: {} }],
        finishReason: "tool_use",
      },
    ]);
    const bus = new ADKEventBus();
    const completed = vi.fn();
    bus.on("run.completed", completed);
    const runner = new Runner({ provider, eventBus: bus });
    const r = await runner.run(agent, { input: "Go", maxTurns: 2 });
    expect(r.totalTurns).toBe(2);
    expect(completed).toHaveBeenCalledOnce();
  });

  it("supports concurrent runs on the same Runner instance", async () => {
    const provider = makeMockProvider([{ content: "ok" }]);
    const runner = new Runner({ provider });

    const a = defineAgent({ name: "a", instructions: "x" });
    const b = defineAgent({ name: "b", instructions: "x" });

    const [ra, rb] = await Promise.all([
      runner.run(a, { input: "1" }),
      runner.run(b, { input: "2" }),
    ]);

    expect(ra.runId).not.toBe(rb.runId);
    expect(ra.traceId).not.toBe(rb.traceId);
    expect(ra.finalAgent).toBe("a");
    expect(rb.finalAgent).toBe("b");
    expect(provider.chatWithTools).toHaveBeenCalledTimes(2);
  });

  it("propagates provider exceptions to the caller", async () => {
    const agent = defineAgent({ name: "boom", instructions: "x" });
    const provider = makeMockProvider([{ content: "x" }]);
    provider.chatWithTools = vi.fn(async () => {
      throw new Error("upstream failure");
    }) as typeof provider.chatWithTools;
    const runner = new Runner({ provider });
    await expect(runner.run(agent, { input: "Hi" })).rejects.toThrow("upstream failure");
  });
});
