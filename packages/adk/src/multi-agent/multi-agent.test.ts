import { describe, expect, it, vi } from "vitest";
import { type Agent, defineAgent } from "../agent/define-agent";
import type { ADKLLMProvider, ChatResponseWithToolCalls } from "../types/llm";
import type { RunContext } from "../types/runner";
import { agentAsTool } from "./agent-tool";
import { HANDOFF_PREFIX, HandoffManager } from "./handoff";
import { ParallelRunner } from "./parallel-runner";
import { Team } from "./team";

// ── Helpers ──

function createMockProvider(responses: Array<Partial<ChatResponseWithToolCalls>>): ADKLLMProvider {
  let callIndex = 0;
  return {
    id: "mock",
    name: "Mock",
    isLocal: false,
    isAvailable: () => true,
    chat: vi.fn().mockResolvedValue({
      content: "mock",
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0,
      latencyMs: 10,
    }),
    complete: vi.fn().mockResolvedValue({
      content: "mock",
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0,
      latencyMs: 10,
    }),
    chatWithTools: vi.fn().mockImplementation(async () => {
      const idx = Math.min(callIndex++, responses.length - 1);
      return {
        content: responses[idx]?.content ?? "ok",
        inputTokens: responses[idx]?.inputTokens ?? 5,
        outputTokens: responses[idx]?.outputTokens ?? 5,
        costUsd: responses[idx]?.costUsd ?? 0,
        latencyMs: responses[idx]?.latencyMs ?? 10,
        toolCalls: responses[idx]?.toolCalls ?? undefined,
      };
    }),
    chatStream: vi.fn(),
  };
}

const agentA = defineAgent({
  name: "agent-a",
  instructions: "I am agent A",
  description: "Agent A handles general tasks",
});

const agentB = defineAgent({
  name: "agent-b",
  instructions: "I am agent B",
  description: "Agent B handles specialized tasks",
});

const agentC = defineAgent({
  name: "agent-c",
  instructions: "I am agent C",
  description: "Agent C handles review tasks",
});

// ── HandoffManager ──

describe("HandoffManager", () => {
  it("registers and retrieves handoffs", () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "Send to B for details");

    const handoffs = manager.getHandoffsForAgent(agentA);
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.to.name).toBe("agent-b");
  });

  it("prevents duplicate registrations", () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "Desc 1");
    manager.registerHandoff(agentA, agentB, "Desc 2");

    expect(manager.getHandoffsForAgent(agentA)).toHaveLength(1);
  });

  it("generates handoff tool definitions", () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "Escalate to B");

    const tools = manager.getHandoffTools(agentA);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe(`${HANDOFF_PREFIX}agent-b`);
    expect(tools[0]?.description).toBe("Escalate to B");
  });

  it("generates LLM tool definitions", () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "Escalate");

    const defs = manager.getHandoffToolDefs(agentA);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe("transfer_to_agent-b");
  });

  it("auto-registers from agent config", () => {
    const agentWithHandoffs = defineAgent({
      name: "router",
      instructions: "Route to the right agent",
      handoffs: [
        { agent: "agent-a", description: "General tasks" },
        { agent: "agent-b", description: "Special tasks" },
      ],
    });

    const map = new Map<string, Agent>([
      ["agent-a", agentA],
      ["agent-b", agentB],
    ]);

    const manager = new HandoffManager();
    manager.registerFromConfig(agentWithHandoffs, map);

    const handoffs = manager.getHandoffsForAgent(agentWithHandoffs);
    expect(handoffs).toHaveLength(2);
  });

  it("executes handoff", async () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "Escalate");

    const ctx: RunContext = {
      runId: "run-1",
      agentName: "agent-a",
      turnNumber: 1,
      traceId: "trace-1",
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
      metadata: {},
    };

    await expect(manager.executeHandoff(agentA, agentB, ctx, "Need help")).resolves.not.toThrow();
  });

  it("detects circular handoffs", async () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "A→B");

    const ctx: RunContext = {
      runId: "run-1",
      agentName: "agent-a",
      turnNumber: 1,
      traceId: "trace-1",
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
      metadata: {},
    };

    await manager.executeHandoff(agentA, agentB, ctx, "first");
    // Same handoff at same turn → circular
    await expect(manager.executeHandoff(agentA, agentB, ctx, "second")).rejects.toThrow("Circular");
  });

  it("blocks handoff via filter", async () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "Conditional", () => false);

    const ctx: RunContext = {
      runId: "run-2",
      agentName: "agent-a",
      turnNumber: 1,
      traceId: "trace-2",
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
      metadata: {},
    };

    await expect(manager.executeHandoff(agentA, agentB, ctx, "blocked")).rejects.toThrow(
      "blocked by filter",
    );
  });

  it("rejects unregistered handoff", async () => {
    const manager = new HandoffManager();
    const ctx: RunContext = {
      runId: "run-3",
      agentName: "agent-a",
      turnNumber: 1,
      traceId: "trace-3",
      usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
      metadata: {},
    };

    await expect(manager.executeHandoff(agentA, agentB, ctx, "none")).rejects.toThrow(
      "No handoff registered",
    );
  });

  it("clears registrations", () => {
    const manager = new HandoffManager();
    manager.registerHandoff(agentA, agentB, "test");
    manager.clear();
    expect(manager.getHandoffsForAgent(agentA)).toHaveLength(0);
  });
});

// ── agentAsTool ──

describe("agentAsTool", () => {
  it("creates a tool from an agent", () => {
    const tool = agentAsTool(agentB);
    expect(tool.name).toBe("agent-b");
    expect(tool.description).toBe("Agent B handles specialized tasks");
  });

  it("uses custom name and description", () => {
    const tool = agentAsTool(agentB, {
      name: "specialist",
      description: "Custom desc",
    });
    expect(tool.name).toBe("specialist");
    expect(tool.description).toBe("Custom desc");
  });

  it("returns error when no provider configured", async () => {
    const tool = agentAsTool(agentB);
    const result = await tool.execute(
      { input: "test" },
      {
        runContext: {
          runId: "r1",
          agentName: "a",
          turnNumber: 1,
          traceId: "t1",
          usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
          metadata: {},
        },
        toolCallId: "tc-1",
        agentName: "a",
      },
    );
    expect(result).toHaveProperty("error");
  });

  it("runs agent and returns output when provider given", async () => {
    const provider = createMockProvider([{ content: "Agent B result" }]);
    const tool = agentAsTool(agentB, { provider });

    const result = await tool.execute(
      { input: "Do something" },
      {
        runContext: {
          runId: "r1",
          agentName: "a",
          turnNumber: 1,
          traceId: "t1",
          usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
          metadata: {},
        },
        toolCallId: "tc-1",
        agentName: "a",
      },
    );
    expect(result).toBe("Agent B result");
  });
});

// ── ParallelRunner ──

describe("ParallelRunner", () => {
  it("runs all agents concurrently", async () => {
    const provider = createMockProvider([{ content: "Result A" }, { content: "Result B" }]);

    const runner = new ParallelRunner({ provider });
    const results = await runner.runAll([agentA, agentB], { input: "test" });

    expect(results).toHaveLength(2);
    expect(results[0]?.output).toBeTruthy();
    expect(results[1]?.output).toBeTruthy();
  });

  it("races agents and returns first result", async () => {
    const provider = createMockProvider([{ content: "Fast result" }, { content: "Slow result" }]);

    const runner = new ParallelRunner({ provider });
    const result = await runner.race([agentA, agentB], { input: "test" });

    expect(result.output).toBeTruthy();
  });

  it("pipelines agents sequentially", async () => {
    const provider = createMockProvider([{ content: "Step 1 done" }, { content: "Step 2 done" }]);

    const runner = new ParallelRunner({ provider });
    const result = await runner.pipeline([agentA, agentB], { input: "start" });

    expect(result.output).toBe("Step 2 done");
  });

  it("throws on empty pipeline", async () => {
    const provider = createMockProvider([]);
    const runner = new ParallelRunner({ provider });

    await expect(runner.pipeline([], { input: "test" })).rejects.toThrow("at least one agent");
  });
});

// ── Team ──

describe("Team", () => {
  it("requires a coordinator", () => {
    expect(
      () =>
        new Team({
          name: "test-team",
          coordinator: undefined as unknown as Agent,
          members: [agentA],
          provider: createMockProvider([]),
        }),
    ).toThrow("coordinator");
  });

  it("requires at least one member", () => {
    expect(
      () =>
        new Team({
          name: "test-team",
          coordinator: agentA,
          members: [],
          provider: createMockProvider([]),
        }),
    ).toThrow("at least one member");
  });

  it("runs with coordinator_decides consensus", async () => {
    const provider = createMockProvider([{ content: "Coordinator says: Result from team" }]);

    const team = new Team({
      name: "test-team",
      coordinator: agentA,
      members: [agentB, agentC],
      provider,
      consensusType: "coordinator_decides",
    });

    const result = await team.run({ input: "solve this problem" });
    expect(result.output).toContain("Coordinator says");
    expect(result.rounds).toBeGreaterThanOrEqual(1);
  });

  it("streams events from team", async () => {
    const provider = createMockProvider([{ content: "Team output" }]);

    const team = new Team({
      name: "test-team",
      coordinator: agentA,
      members: [agentB],
      provider,
    });

    const events = [];
    for await (const event of team.stream({ input: "test" })) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1]?.type).toBe("run_complete");
  });
});
