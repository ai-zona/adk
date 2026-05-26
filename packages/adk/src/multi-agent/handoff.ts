// ──────────────────────────────────────────────────────
// ADK Handoff Manager
// ──────────────────────────────────────────────────────
// Manages agent-to-agent handoffs (OpenAI Swarm pattern)
// Injects synthetic `transfer_to_{name}` tools.
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import type { HandoffTarget } from "../types/agent";
import type { LLMToolDefinition } from "../types/llm";
import type { RunContext } from "../types/runner";
import type { ToolContext, ToolDef } from "../types/tool";

export const HANDOFF_PREFIX = "transfer_to_";

/** Record of a handoff registration */
interface HandoffRegistration {
  from: Agent;
  to: Agent;
  description: string;
  filter?: (ctx: RunContext) => boolean | Promise<boolean>;
}

/** Manages handoff registrations and tool generation */
export class HandoffManager {
  private registrations: HandoffRegistration[] = [];
  private circularGuard = new Set<string>();

  /** Register a handoff from one agent to another */
  registerHandoff(
    from: Agent,
    to: Agent,
    description: string,
    filter?: (ctx: RunContext) => boolean | Promise<boolean>,
  ): void {
    // Prevent duplicate registrations
    const existing = this.registrations.find(
      (r) => r.from.name === from.name && r.to.name === to.name,
    );
    if (existing) return;

    this.registrations.push({ from, to, description, filter });
  }

  /** Auto-register handoffs from an agent's config.handoffs */
  registerFromConfig(agent: Agent, agentMap: Map<string, Agent>): void {
    for (const handoff of agent.getHandoffs()) {
      const targetName = typeof handoff.agent === "string" ? handoff.agent : handoff.agent.name;
      const targetAgent = agentMap.get(targetName);
      if (targetAgent) {
        this.registerHandoff(agent, targetAgent, handoff.description, handoff.filter);
      }
    }
  }

  /** Get handoff tools for a given agent (as ToolDefs) */
  getHandoffTools(agent: Agent): ToolDef[] {
    const handoffs = this.getHandoffsForAgent(agent);
    return handoffs.map((h) => ({
      name: `${HANDOFF_PREFIX}${h.to.name}`,
      description: h.description,
      inputSchema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Reason for the handoff",
          },
        },
      },
      execute: async (_input: unknown, _ctx: ToolContext) => {
        // Handoffs are intercepted by the runner/turn-executor before execute() is called.
        // This is a fallback that should not normally be reached.
        return { handoff: true, target: h.to.name };
      },
    }));
  }

  /** Get handoff LLMToolDefinitions for a given agent */
  getHandoffToolDefs(agent: Agent): LLMToolDefinition[] {
    const handoffs = this.getHandoffsForAgent(agent);
    return handoffs.map((h) => ({
      name: `${HANDOFF_PREFIX}${h.to.name}`,
      description: h.description,
      inputSchema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Reason for the handoff",
          },
        },
      },
    }));
  }

  /** Execute a handoff (validates, checks circular, emits) */
  async executeHandoff(from: Agent, to: Agent, ctx: RunContext, reason: string): Promise<void> {
    // Circular handoff prevention
    const key = `${ctx.runId}:${from.name}->${to.name}@${ctx.turnNumber}`;
    if (this.circularGuard.has(key)) {
      throw new Error(
        `Circular handoff detected: ${from.name} → ${to.name} (turn ${ctx.turnNumber})`,
      );
    }
    this.circularGuard.add(key);

    // Validate registration exists
    const reg = this.registrations.find((r) => r.from.name === from.name && r.to.name === to.name);
    if (!reg) {
      throw new Error(`No handoff registered from "${from.name}" to "${to.name}"`);
    }

    // Run filter
    if (reg.filter) {
      const allowed = await reg.filter(ctx);
      if (!allowed) {
        throw new Error(`Handoff from "${from.name}" to "${to.name}" blocked by filter`);
      }
    }
  }

  /** Get all registered handoffs for a given agent */
  getHandoffsForAgent(agent: Agent): HandoffRegistration[] {
    return this.registrations.filter((r) => r.from.name === agent.name);
  }

  /** Reset circular guard (call between runs) */
  resetCircularGuard(): void {
    this.circularGuard.clear();
  }

  /** Clear all registrations */
  clear(): void {
    this.registrations = [];
    this.circularGuard.clear();
  }
}
