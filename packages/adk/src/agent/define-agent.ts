// ──────────────────────────────────────────────────────
// ADK Agent — defineAgent() + Agent class
// ──────────────────────────────────────────────────────

import type { z } from "zod";
import type { ToolSelectionConfig } from "../tools/tool-selector";
import type {
  AgentConfig,
  ConsentLevel,
  ContextConfig,
  HandoffTarget,
  JsonSchema,
} from "../types/agent";
import type { RunContext } from "../types/runner";
import type { ToolDef } from "../types/tool";

/** Agent class — wraps config with utility methods */
export class Agent {
  readonly name: string;
  readonly config: Readonly<AgentConfig>;
  private runtimeTools: ToolDef[] = [];

  constructor(config: AgentConfig) {
    if (!config.name || config.name.trim().length === 0) {
      throw new Error("Agent name is required");
    }
    this.name = config.name;
    this.config = Object.freeze({ ...config });
  }

  /** Resolve instructions (handles static string or dynamic function) */
  async getInstructions(ctx: RunContext): Promise<string> {
    if (typeof this.config.instructions === "function") {
      return this.config.instructions(ctx);
    }
    return this.config.instructions;
  }

  /** Get tool definitions (config tools + runtime-injected tools) */
  getTools(): ToolDef[] {
    return [...(this.config.tools ?? []), ...this.runtimeTools];
  }

  /** Add a tool at runtime (e.g., harness tools injected by Runner) */
  // biome-ignore lint/suspicious/noExplicitAny: accept typed ToolDef variants
  addTool(tool: ToolDef<any, any>): void {
    const allTools = this.getTools();
    if (!allTools.some((t) => t.name === tool.name)) {
      this.runtimeTools.push(tool as ToolDef);
    }
  }

  /** Get handoff targets */
  getHandoffs(): HandoffTarget[] {
    return this.config.handoffs ?? [];
  }

  /** Get output schema (Zod or JSON Schema) */
  getOutputSchema(): z.ZodSchema | JsonSchema | undefined {
    return this.config.outputSchema;
  }

  /** Get consent level */
  getConsentLevel(): ConsentLevel {
    return this.config.consentLevel ?? "auto";
  }

  /** Get max turns */
  getMaxTurns(): number {
    return this.config.maxTurns ?? 25;
  }

  /** Get budget limit */
  getBudgetLimit(): number | undefined {
    return this.config.budgetLimitUsd;
  }

  /** Get tool selection config */
  getToolSelection(): ToolSelectionConfig | undefined {
    return this.config.toolSelection;
  }

  /** Get context config */
  getContextConfig(): ContextConfig | undefined {
    return this.config.contextConfig;
  }

  /** Clone agent with config overrides */
  clone(overrides?: Partial<AgentConfig>): Agent {
    return new Agent({ ...this.config, ...overrides });
  }
}

/** Define an agent from config */
export function defineAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
