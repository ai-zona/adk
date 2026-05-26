// ──────────────────────────────────────────────────────
// Built-in execute_code tool
// ──────────────────────────────────────────────────────

import { CodeExecutor } from "../../runner/code-executor";
import type { ToolContext, ToolDef } from "../../types/tool";

interface ExecuteCodeInput {
  code: string;
  description?: string;
}

/**
 * Create an execute_code tool that runs agent-written JavaScript
 * in a sandboxed environment with access to all available tools.
 */
export function createExecuteCodeTool(
  availableTools: ToolDef[],
  config?: { timeoutMs?: number },
): ToolDef<ExecuteCodeInput> {
  const executor = new CodeExecutor({ timeoutMs: config?.timeoutMs });

  return {
    name: "execute_code",
    description:
      "Execute JavaScript code with access to all tools via `tools.toolName(input)`. " +
      "Use this to call multiple tools in a single step, process results, or implement complex logic. " +
      "Return a value from the code block to see the result.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "JavaScript code to execute. Tools are available as `tools.toolName(input)`. Use `return` to return a value.",
        },
        description: {
          type: "string",
          description: "Brief description of what the code does",
        },
      },
      required: ["code"],
    },
    examples: [
      {
        input: {
          code: 'const result = await tools.read_file({ path: "config.json" }); return JSON.parse(result);',
          description: "Read and parse a config file",
        },
        description: "Call a tool and process its result",
      },
    ],
    execute: async (input: ExecuteCodeInput, ctx: ToolContext) => {
      // Filter out execute_code itself to prevent recursion
      const safeTools = availableTools.filter((t) => t.name !== "execute_code");
      const result = await executor.execute(input.code, safeTools, ctx);
      return result;
    },
  };
}
