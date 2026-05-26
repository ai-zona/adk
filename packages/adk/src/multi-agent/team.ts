// ──────────────────────────────────────────────────────
// ADK Team — Coordinator-based multi-agent orchestration
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/orchestrator/team-coordinator.ts
// Generalized — no DB dependency, no platform-specific types.
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import type { ADKEventBus } from "../events/event-bus";
import { Runner } from "../runner/runner";
import type { ADKLLMProvider } from "../types/llm";
import type { RunConfig, RunResult, StreamEvent } from "../types/runner";
import { agentAsTool } from "./agent-tool";

/** Team consensus types */
export type ConsensusType = "coordinator_decides" | "majority" | "unanimous" | "weighted";

/** Team configuration */
export interface TeamConfig {
  /** Team name */
  name: string;
  /** Coordinator agent — orchestrates the team */
  coordinator: Agent;
  /** Team member agents */
  members: Agent[];
  /** How decisions are made */
  consensusType?: ConsensusType;
  /** Maximum coordination rounds */
  maxRounds?: number;
  /** LLM provider */
  provider: ADKLLMProvider;
  /** Event bus (optional) */
  eventBus?: ADKEventBus;
}

/** Team execution result */
export interface TeamResult extends RunResult {
  /** Individual member results */
  memberResults: { agentName: string; result: RunResult }[];
  /** Number of coordination rounds */
  rounds: number;
}

export class Team {
  private config: TeamConfig;

  constructor(config: TeamConfig) {
    if (!config.coordinator) {
      throw new Error("Team requires a coordinator agent");
    }
    if (!config.members || config.members.length === 0) {
      throw new Error("Team requires at least one member");
    }
    this.config = config;
  }

  /** Run the team: coordinator delegates to members, aggregates results */
  async run(input: RunConfig): Promise<TeamResult> {
    const {
      coordinator,
      members,
      provider,
      maxRounds = 3,
      consensusType = "coordinator_decides",
      eventBus,
    } = this.config;

    // Wrap each member as a tool for the coordinator
    const memberTools = members.map((member) =>
      agentAsTool(member, {
        provider,
        maxTurns: 10,
        description: member.config.description ?? `Delegate to ${member.name}`,
      }),
    );

    // Create a coordinator agent clone with member tools injected
    const coordinatorWithTools = coordinator.clone({
      tools: [...coordinator.getTools(), ...memberTools],
    });

    const runner = new Runner({ provider, eventBus });

    // Register all agents
    runner.registerAgent(coordinatorWithTools);
    for (const m of members) {
      runner.registerAgent(m);
    }

    // Run coordinator — it will call member tools as needed
    const result = await runner.run(coordinatorWithTools, {
      ...input,
      maxTurns: maxRounds * (members.length + 1),
    });

    // Collect member results from tool calls in the message history
    const memberResults: { agentName: string; result: RunResult }[] = [];

    // In coordinator_decides mode, the coordinator's final output is the answer
    // For other consensus types, we would need separate logic
    if (consensusType !== "coordinator_decides") {
      // For majority/unanimous/weighted, run all members independently
      const independentResults = await Promise.all(
        members.map(async (member) => {
          const memberRunner = new Runner({ provider });
          const memberResult = await memberRunner.run(member, input);
          return { agentName: member.name, result: memberResult };
        }),
      );
      memberResults.push(...independentResults);
    }

    return {
      ...result,
      memberResults,
      rounds: Math.ceil(result.totalTurns / Math.max(members.length, 1)),
    };
  }

  /** Stream events from a team run */
  async *stream(input: RunConfig): AsyncGenerator<StreamEvent> {
    const result = await this.run(input);
    yield { type: "text_delta", content: result.output, agentName: result.finalAgent };
    yield { type: "run_complete", result };
  }
}
