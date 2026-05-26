// ──────────────────────────────────────────────────────
// ADK Code Executor — Sandboxed JavaScript execution
// ──────────────────────────────────────────────────────
// Enables programmatic tool calling: agent writes code
// that orchestrates tools, reducing token usage by ~37%.
// ──────────────────────────────────────────────────────

import * as vm from "node:vm";
import type { ToolContext, ToolDef } from "../types/tool";

/** Configuration for the code executor */
export interface CodeExecutorConfig {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

/** Result of code execution */
export interface CodeExecutionResult {
  success: boolean;
  result: unknown;
  error?: string;
  toolCallsPerformed: string[];
}

/**
 * CodeExecutor — sandboxed JavaScript executor with tool bindings.
 * Agent code can call tools via `tools.toolName(input)` which returns a Promise.
 * No filesystem, network, or process access from the sandbox.
 */
export class CodeExecutor {
  private timeoutMs: number;

  constructor(config?: CodeExecutorConfig) {
    this.timeoutMs = config?.timeoutMs ?? 30_000;
  }

  /**
   * Execute code in a sandbox with tool bindings.
   * @param code JavaScript code to execute
   * @param tools Available tools that the code can call
   * @param toolCtx Tool context for tool calls
   */
  async execute(
    code: string,
    tools: ToolDef[],
    toolCtx: ToolContext,
  ): Promise<CodeExecutionResult> {
    const toolCallsPerformed: string[] = [];

    // Build tool bindings as async functions
    const toolBindings: Record<string, (input: unknown) => Promise<unknown>> = {};
    for (const tool of tools) {
      toolBindings[tool.name] = async (input: unknown) => {
        toolCallsPerformed.push(tool.name);
        return tool.execute(input as never, toolCtx);
      };
    }

    // Create sandbox with safe globals only
    const sandbox: Record<string, unknown> = {
      tools: toolBindings,
      console: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
      JSON,
      Math,
      Date,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Map,
      Set,
      RegExp,
      Error,
      Promise,
      setTimeout: undefined,
      setInterval: undefined,
      setImmediate: undefined,
      // Explicitly block dangerous APIs
      require: undefined,
      process: undefined,
      global: undefined,
      globalThis: undefined,
      __dirname: undefined,
      __filename: undefined,
      Buffer: undefined,
      fetch: undefined,
      XMLHttpRequest: undefined,
    };

    const context = vm.createContext(sandbox);

    // Wrap code in an async IIFE to support await
    const wrappedCode = `
      (async () => {
        ${code}
      })()
    `;

    try {
      const script = new vm.Script(wrappedCode, {
        filename: "agent-code.js",
      });

      const result = await script.runInContext(context, {
        timeout: this.timeoutMs,
      });

      return {
        success: true,
        result,
        toolCallsPerformed,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        result: null,
        error: errorMsg,
        toolCallsPerformed,
      };
    }
  }
}
