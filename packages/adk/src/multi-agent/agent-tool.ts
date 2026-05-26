// ──────────────────────────────────────────────────────
// ADK Agent-as-Tool — Wrap an Agent as a callable ToolDef
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import { Runner } from "../runner/runner";
import type { ADKLLMProvider } from "../types/llm";
import type { RunConfig } from "../types/runner";
import type { ToolContext, ToolDef } from "../types/tool";

export interface AgentAsToolConfig {
  /** Custom tool name (defaults to agent name) */
  name?: string;
  /** Custom description (defaults to agent description or instructions summary) */
  description?: string;
  /** Provider to use for the inner run */
  provider?: ADKLLMProvider;
  /** Max turns for the inner run */
  maxTurns?: number;
  /** Whether to return full RunResult or just output text */
  fullResult?: boolean;
}

/**
 * Wrap an Agent as a ToolDef. When another agent calls this tool,
 * it runs the wrapped agent as a sub-agent and returns the output.
 */
export function agentAsTool(agent: Agent, config?: AgentAsToolConfig): ToolDef {
  const toolName = config?.name ?? agent.name;
  const description =
    config?.description ?? agent.config.description ?? `Delegate to ${agent.name} agent`;

  return {
    name: toolName,
    description,
    inputSchema: {
      type: "object",
      properties: {
        input: {
          type: "string",
          description: "The task or question to delegate to this agent",
        },
      },
      required: ["input"],
    },
    execute: async (rawInput: unknown, ctx: ToolContext) => {
      const input = rawInput as { input: string };

      if (!config?.provider) {
        return {
          error: `No provider configured for agent-as-tool "${toolName}". Pass provider in config.`,
        };
      }

      const runner = new Runner({ provider: config.provider });

      const runConfig: RunConfig = {
        input: input.input,
        maxTurns: config?.maxTurns ?? 10,
        signal: ctx.runContext.signal,
        metadata: {
          parentRunId: ctx.runContext.runId,
          parentAgent: ctx.agentName,
        },
      };

      const result = await runner.run(agent, runConfig);

      if (config?.fullResult) {
        return result;
      }

      return result.output;
    },
  };
}
