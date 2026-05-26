// ──────────────────────────────────────────────────────
// ADK Tool — defineTool()
// ──────────────────────────────────────────────────────

import type { ToolDef, ToolDefConfig } from "../types/tool";

/** Define a tool from config */
export function defineTool<TInput = unknown, TOutput = unknown>(
  config: ToolDefConfig<TInput, TOutput>,
): ToolDef<TInput, TOutput> {
  if (!config.name || config.name.trim().length === 0) {
    throw new Error("Tool name is required");
  }
  if (!config.description || config.description.trim().length === 0) {
    throw new Error("Tool description is required");
  }
  if (!config.execute) {
    throw new Error("Tool execute function is required");
  }

  return {
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: config.execute,
    hooks: config.hooks,
    metadata: config.metadata,
    deferLoading: config.deferLoading,
    examples: config.examples,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
  };
}
