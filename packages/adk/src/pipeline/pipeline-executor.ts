// ──────────────────────────────────────────────────────
// ADK Pipeline Executor
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/pipeline/pipeline-executor.ts
// Generalized — no Prisma, no DB, no platform-specific types.
// Pipeline: workspace → agent → validate → report
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import type { ADKEventBus } from "../events/event-bus";
import { Runner } from "../runner/runner";
import type { ADKLLMProvider } from "../types/llm";
import type { RunConfig, RunResult } from "../types/runner";

/** Pipeline task definition */
export interface PipelineTask {
  /** Task ID */
  id: string;
  /** Task description / instructions */
  description: string;
  /** File context (paths, diffs, etc.) */
  context?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Pipeline step type */
export type PipelineStepType = "workspace" | "agent" | "validate" | "report";

/** Pipeline step result */
export interface PipelineStepResult {
  step: PipelineStepType;
  success: boolean;
  output: string;
  durationMs: number;
  error?: string;
}

/** Full pipeline result */
export interface PipelineResult {
  taskId: string;
  success: boolean;
  steps: PipelineStepResult[];
  agentResult?: RunResult;
  totalDurationMs: number;
  output: string;
}

/** Pipeline configuration */
export interface PipelineConfig {
  /** LLM provider */
  provider: ADKLLMProvider;
  /** Event bus (optional) */
  eventBus?: ADKEventBus;
  /** Workspace setup function (optional — returns context string) */
  workspaceSetup?: (task: PipelineTask) => Promise<string>;
  /** Validation function (optional — returns { valid, errors }) */
  validator?: (output: string, task: PipelineTask) => Promise<{ valid: boolean; errors: string[] }>;
  /** Report function (optional — generates report from results) */
  reporter?: (result: PipelineResult) => Promise<string>;
  /** Max agent turns */
  maxTurns?: number;
}

export class ADKPipeline {
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
  }

  /** Execute the full pipeline */
  async execute(agent: Agent, task: PipelineTask): Promise<PipelineResult> {
    const startTime = Date.now();
    const steps: PipelineStepResult[] = [];

    let contextFromWorkspace = "";
    let agentResult: RunResult | undefined;

    // Step 1: Workspace setup
    if (this.config.workspaceSetup) {
      const stepStart = Date.now();
      try {
        contextFromWorkspace = await this.config.workspaceSetup(task);
        steps.push({
          step: "workspace",
          success: true,
          output: contextFromWorkspace.slice(0, 200),
          durationMs: Date.now() - stepStart,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        steps.push({
          step: "workspace",
          success: false,
          output: "",
          durationMs: Date.now() - stepStart,
          error: msg,
        });
        return {
          taskId: task.id,
          success: false,
          steps,
          totalDurationMs: Date.now() - startTime,
          output: `Workspace setup failed: ${msg}`,
        };
      }
    }

    // Step 2: Agent execution
    const agentStepStart = Date.now();
    try {
      const input = this.buildAgentInput(task, contextFromWorkspace);
      const runner = new Runner({
        provider: this.config.provider,
        eventBus: this.config.eventBus,
      });

      const runConfig: RunConfig = {
        input,
        maxTurns: this.config.maxTurns ?? 15,
        metadata: { pipelineTaskId: task.id, ...task.metadata },
      };

      agentResult = await runner.run(agent, runConfig);

      steps.push({
        step: "agent",
        success: true,
        output: agentResult.output.slice(0, 500),
        durationMs: Date.now() - agentStepStart,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      steps.push({
        step: "agent",
        success: false,
        output: "",
        durationMs: Date.now() - agentStepStart,
        error: msg,
      });
      return {
        taskId: task.id,
        success: false,
        steps,
        totalDurationMs: Date.now() - startTime,
        output: `Agent execution failed: ${msg}`,
      };
    }

    // Step 3: Validation
    if (this.config.validator) {
      const validateStart = Date.now();
      try {
        const validation = await this.config.validator(agentResult.output, task);
        steps.push({
          step: "validate",
          success: validation.valid,
          output: validation.valid
            ? "Validation passed"
            : `Validation failed: ${validation.errors.join(", ")}`,
          durationMs: Date.now() - validateStart,
          error: validation.valid ? undefined : validation.errors.join(", "),
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        steps.push({
          step: "validate",
          success: false,
          output: "",
          durationMs: Date.now() - validateStart,
          error: msg,
        });
      }
    }

    const pipelineResult: PipelineResult = {
      taskId: task.id,
      success: steps.every((s) => s.success),
      steps,
      agentResult,
      totalDurationMs: Date.now() - startTime,
      output: agentResult.output,
    };

    // Step 4: Report
    if (this.config.reporter) {
      const reportStart = Date.now();
      try {
        const report = await this.config.reporter(pipelineResult);
        steps.push({
          step: "report",
          success: true,
          output: report.slice(0, 500),
          durationMs: Date.now() - reportStart,
        });
        pipelineResult.output = report;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        steps.push({
          step: "report",
          success: false,
          output: "",
          durationMs: Date.now() - reportStart,
          error: msg,
        });
      }
    }

    pipelineResult.totalDurationMs = Date.now() - startTime;
    return pipelineResult;
  }

  private buildAgentInput(task: PipelineTask, workspace: string): string {
    const parts: string[] = [];
    parts.push(`Task: ${task.description}`);
    if (task.context) {
      parts.push(`\nContext:\n${task.context}`);
    }
    if (workspace) {
      parts.push(`\nWorkspace:\n${workspace}`);
    }
    return parts.join("\n");
  }
}
