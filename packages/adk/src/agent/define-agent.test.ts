import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { RunContext } from "../types/runner";
import { Agent, defineAgent } from "./define-agent";

const mockContext: RunContext = {
  runId: "run-1",
  agentName: "test",
  turnNumber: 1,
  traceId: "trace-1",
  usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
  metadata: {},
};

describe("defineAgent", () => {
  it("creates an Agent from config", () => {
    const agent = defineAgent({
      name: "test-agent",
      instructions: "You are helpful.",
    });

    expect(agent).toBeInstanceOf(Agent);
    expect(agent.name).toBe("test-agent");
  });

  it("throws on empty name", () => {
    expect(() => defineAgent({ name: "", instructions: "test" })).toThrow("Agent name is required");
  });

  it("throws on whitespace-only name", () => {
    expect(() => defineAgent({ name: "  ", instructions: "test" })).toThrow(
      "Agent name is required",
    );
  });
});

describe("Agent", () => {
  it("getInstructions() resolves static string", async () => {
    const agent = defineAgent({
      name: "test",
      instructions: "Be helpful.",
    });

    const instructions = await agent.getInstructions(mockContext);
    expect(instructions).toBe("Be helpful.");
  });

  it("getInstructions() resolves dynamic function", async () => {
    const agent = defineAgent({
      name: "test",
      instructions: (ctx) => `Helping run ${ctx.runId}`,
    });

    const instructions = await agent.getInstructions(mockContext);
    expect(instructions).toBe("Helping run run-1");
  });

  it("getInstructions() resolves async function", async () => {
    const agent = defineAgent({
      name: "test",
      instructions: async (ctx) => `Async: ${ctx.agentName}`,
    });

    const instructions = await agent.getInstructions(mockContext);
    expect(instructions).toBe("Async: test");
  });

  it("getTools() returns tools or empty array", () => {
    const agent1 = defineAgent({ name: "a", instructions: "x" });
    expect(agent1.getTools()).toEqual([]);

    const agent2 = defineAgent({
      name: "b",
      instructions: "x",
      tools: [
        {
          name: "search",
          description: "Search",
          inputSchema: { type: "object" },
          execute: async () => "ok",
        },
      ],
    });
    expect(agent2.getTools()).toHaveLength(1);
  });

  it("getHandoffs() returns handoffs or empty array", () => {
    const agent1 = defineAgent({ name: "a", instructions: "x" });
    expect(agent1.getHandoffs()).toEqual([]);

    const agent2 = defineAgent({
      name: "b",
      instructions: "x",
      handoffs: [{ agent: "c", description: "Transfer to C" }],
    });
    expect(agent2.getHandoffs()).toHaveLength(1);
  });

  it("getOutputSchema() returns schema or undefined", () => {
    const agent1 = defineAgent({ name: "a", instructions: "x" });
    expect(agent1.getOutputSchema()).toBeUndefined();

    const schema = z.object({ answer: z.string() });
    const agent2 = defineAgent({ name: "b", instructions: "x", outputSchema: schema });
    expect(agent2.getOutputSchema()).toBeDefined();
  });

  it("getConsentLevel() defaults to auto", () => {
    const agent = defineAgent({ name: "a", instructions: "x" });
    expect(agent.getConsentLevel()).toBe("auto");
  });

  it("getConsentLevel() returns configured level", () => {
    const agent = defineAgent({ name: "a", instructions: "x", consentLevel: "explicit" });
    expect(agent.getConsentLevel()).toBe("explicit");
  });

  it("getMaxTurns() defaults to 25", () => {
    const agent = defineAgent({ name: "a", instructions: "x" });
    expect(agent.getMaxTurns()).toBe(25);
  });

  it("getMaxTurns() returns configured value", () => {
    const agent = defineAgent({ name: "a", instructions: "x", maxTurns: 5 });
    expect(agent.getMaxTurns()).toBe(5);
  });

  it("getBudgetLimit() returns undefined by default", () => {
    const agent = defineAgent({ name: "a", instructions: "x" });
    expect(agent.getBudgetLimit()).toBeUndefined();
  });

  it("clone() creates a copy with overrides", () => {
    const agent = defineAgent({
      name: "original",
      instructions: "Original instructions",
      maxTurns: 10,
    });

    const cloned = agent.clone({ name: "cloned", maxTurns: 5 });

    expect(cloned.name).toBe("cloned");
    expect(cloned.getMaxTurns()).toBe(5);
    // Original unchanged
    expect(agent.name).toBe("original");
    expect(agent.getMaxTurns()).toBe(10);
  });

  it("config is frozen (immutable)", () => {
    const agent = defineAgent({ name: "test", instructions: "x" });

    expect(() => {
      (agent.config as Record<string, unknown>).name = "hacked";
    }).toThrow();
  });
});
