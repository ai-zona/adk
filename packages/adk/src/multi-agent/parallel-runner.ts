// ──────────────────────────────────────────────────────
// ADK Parallel Runner — Concurrent agent execution
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import { Runner } from "../runner/runner";
import type { ADKLLMProvider } from "../types/llm";
import type { RunConfig, RunResult } from "../types/runner";

export interface ParallelRunnerConfig {
  /** LLM provider to use */
  provider: ADKLLMProvider;
}

export class ParallelRunner {
  private provider: ADKLLMProvider;

  constructor(config: ParallelRunnerConfig) {
    this.provider = config.provider;
  }

  /**
   * Run all agents concurrently. Returns all results.
   * All agents receive the same input.
   */
  async runAll(agents: Agent[], input: RunConfig): Promise<RunResult[]> {
    const promises = agents.map((agent) => {
      const runner = new Runner({ provider: this.provider });
      return runner.run(agent, input);
    });

    return Promise.all(promises);
  }

  /**
   * Race agents. Returns the first result that completes.
   * Other runs are aborted.
   */
  async race(agents: Agent[], input: RunConfig): Promise<RunResult> {
    const controller = new AbortController();

    const promises = agents.map((agent) => {
      const runner = new Runner({ provider: this.provider });
      return runner.run(agent, {
        ...input,
        signal: controller.signal,
      });
    });

    try {
      const result = await Promise.race(promises);
      controller.abort();
      return result;
    } catch (error) {
      controller.abort();
      throw error;
    }
  }

  /**
   * Run agents in pipeline — output of one becomes input of the next.
   * The first agent gets the original input; subsequent agents get the
   * previous agent's output as their input.
   */
  async pipeline(agents: Agent[], input: RunConfig): Promise<RunResult> {
    if (agents.length === 0) {
      throw new Error("Pipeline requires at least one agent");
    }

    let currentInput = input;
    let lastResult: RunResult | undefined;

    for (const agent of agents) {
      const runner = new Runner({ provider: this.provider });
      lastResult = await runner.run(agent, currentInput);

      // Feed output of this agent as input to the next
      currentInput = {
        ...input,
        input: lastResult.output,
        messages: lastResult.messages,
      };
    }

    return lastResult!;
  }
}
