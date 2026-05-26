// ──────────────────────────────────────────────────────
// Built-in memory tools — persistent key-value for agents
// ──────────────────────────────────────────────────────

import type { AgenticMemory } from "../../sessions/agentic-memory";
import type { ToolContext, ToolDef } from "../../types/tool";

export function createMemoryWriteTool(
  memory: AgenticMemory,
): ToolDef<{ key: string; value: string }> {
  return {
    name: "memory_write",
    description:
      "Write a value to persistent memory. Use this to remember information across sessions.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Memory key" },
        value: { type: "string", description: "Value to store" },
      },
      required: ["key", "value"],
    },
    execute: async (input: { key: string; value: string }, _ctx: ToolContext) => {
      await memory.set(input.key, input.value);
      return { written: true, key: input.key };
    },
  };
}

export function createMemoryReadTool(memory: AgenticMemory): ToolDef<{ key: string }> {
  return {
    name: "memory_read",
    description: "Read a value from persistent memory by key.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Memory key to read" },
      },
      required: ["key"],
    },
    execute: async (input: { key: string }, _ctx: ToolContext) => {
      const value = await memory.get(input.key);
      return { key: input.key, value: value ?? null, found: value !== undefined };
    },
  };
}

export function createMemorySearchTool(memory: AgenticMemory): ToolDef<{ prefix: string }> {
  return {
    name: "memory_search",
    description: "Search persistent memory by key prefix. Returns all matching key-value pairs.",
    inputSchema: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Key prefix to search" },
      },
      required: ["prefix"],
    },
    execute: async (input: { prefix: string }, _ctx: ToolContext) => {
      const results = await memory.search(input.prefix);
      return { results, count: results.length };
    },
  };
}
