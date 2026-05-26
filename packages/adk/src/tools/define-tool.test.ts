import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "./define-tool";

describe("defineTool", () => {
  it("creates a tool from config", () => {
    const tool = defineTool({
      name: "search",
      description: "Search the web",
      inputSchema: z.object({ query: z.string() }),
      execute: async (input) => `Results for: ${input.query}`,
    });

    expect(tool.name).toBe("search");
    expect(tool.description).toBe("Search the web");
  });

  it("creates a tool with JSON Schema", () => {
    const tool = defineTool({
      name: "calculator",
      description: "Calculate",
      inputSchema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
      execute: async (input) => String(input),
    });

    expect(tool.inputSchema).toHaveProperty("type", "object");
  });

  it("throws on empty name", () => {
    expect(() =>
      defineTool({
        name: "",
        description: "test",
        inputSchema: { type: "object" },
        execute: async () => "ok",
      }),
    ).toThrow("Tool name is required");
  });

  it("throws on empty description", () => {
    expect(() =>
      defineTool({
        name: "test",
        description: "",
        inputSchema: { type: "object" },
        execute: async () => "ok",
      }),
    ).toThrow("Tool description is required");
  });

  it("throws on missing execute", () => {
    expect(() =>
      defineTool({
        name: "test",
        description: "test",
        inputSchema: { type: "object" },
        execute: undefined as unknown as () => Promise<unknown>,
      }),
    ).toThrow("Tool execute function is required");
  });

  it("preserves hooks", () => {
    const tool = defineTool({
      name: "guarded",
      description: "Tool with hooks",
      inputSchema: { type: "object" },
      execute: async () => "ok",
      hooks: {
        preExecute: async () => ({ allow: true }),
        postExecute: async () => ({}),
      },
    });

    expect(tool.hooks?.preExecute).toBeDefined();
    expect(tool.hooks?.postExecute).toBeDefined();
  });

  it("preserves metadata", () => {
    const tool = defineTool({
      name: "meta",
      description: "Tool with metadata",
      inputSchema: { type: "object" },
      execute: async () => "ok",
      metadata: { category: "search", version: 2 },
    });

    expect(tool.metadata).toEqual({ category: "search", version: 2 });
  });

  it("execute function works", async () => {
    const tool = defineTool({
      name: "echo",
      description: "Echo input",
      inputSchema: z.object({ message: z.string() }),
      execute: async (input) => ({ echoed: input.message }),
    });

    const ctx = {
      runContext: {
        runId: "run-1",
        agentName: "test",
        turnNumber: 1,
        traceId: "trace-1",
        usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
        metadata: {},
      },
      toolCallId: "tc-1",
      agentName: "test",
    };

    const result = await tool.execute({ message: "hello" }, ctx);
    expect(result).toEqual({ echoed: "hello" });
  });
});
