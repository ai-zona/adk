// ──────────────────────────────────────────────────────
// Built-in tool_search tool — discovers deferred tools
// ──────────────────────────────────────────────────────

import type { ToolContext, ToolDef } from "../../types/tool";
import type { ToolRegistry } from "../tool-registry";

/**
 * Create a tool_search tool bound to a specific ToolRegistry.
 * Agents use this to discover and load deferred tools at runtime.
 */
export function createToolSearchTool(
  registry: ToolRegistry,
): ToolDef<{ query: string }, { tools: { name: string; description: string }[] }> {
  return {
    name: "tool_search",
    description:
      "Search for available tools by keyword. Returns matching tool names and descriptions. Use this when you need a tool that isn't currently available.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords to search for tools (e.g., 'file system', 'database query')",
        },
      },
      required: ["query"],
    },
    execute: async (input: { query: string }, _ctx: ToolContext) => {
      const results = registry.search(input.query, 5);
      // Auto-load found tools
      for (const r of results) {
        registry.load(r.name);
      }
      return {
        tools: results.map((r) => ({ name: r.name, description: r.description })),
      };
    },
  };
}
