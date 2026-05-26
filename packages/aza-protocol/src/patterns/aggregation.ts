import type Redis from "ioredis";
import type { TaskManager, TaskRecord } from "../task/task-manager";
import { TaskStatus } from "../types/task";

// ──────────────────────────────────────────────────────
// Aggregation Pattern (N:1 Coordinator)
// ──────────────────────────────────────────────────────
// Splits work into sub-tasks, dispatches them to multiple
// agents (in parallel or sequentially), and aggregates
// the results into a single combined output.
//
// This pattern is used by coordinator agents to orchestrate
// multi-step workflows where each step is performed by
// a specialized agent.
// ──────────────────────────────────────────────────────

export type ExecutionMode = "parallel" | "sequential";

export interface SubTaskDefinition {
  /** DID of the agent to execute this sub-task. */
  targetDid: string;
  /** Human-readable title for the sub-task. */
  title: string;
  /** Required skill for the sub-task. */
  skill: string;
  /** Input data for the sub-task. */
  input?: unknown;
}

export interface AggregationConfig {
  /** Execute sub-tasks in parallel or sequentially. */
  mode: ExecutionMode;
  /** Definitions of all sub-tasks to be executed. */
  subTasks: SubTaskDefinition[];
  /** Maximum time for the entire aggregation (milliseconds). */
  timeoutMs: number;
  /**
   * Stop on first failure.
   * Defaults to true for sequential mode, false for parallel mode.
   */
  failFast?: boolean;
  /**
   * Custom function to combine all successful results.
   * Defaults to returning an array of outputs.
   */
  combiner?: (results: TaskResult[]) => unknown;
}

export interface TaskResult {
  /** ID of the sub-task. */
  taskId: string;
  /** DID of the agent that executed the sub-task. */
  targetDid: string;
  /** Whether the sub-task completed successfully. */
  success: boolean;
  /** Output from the sub-task (if successful). */
  output?: unknown;
  /** Error message (if failed). */
  error?: string;
}

export interface AggregationResult {
  /** Combined output from all successful sub-tasks. */
  combined: unknown;
  /** Individual results for each sub-task. */
  results: TaskResult[];
  /** Sub-tasks that failed. */
  failed: TaskResult[];
  /** Total time taken for the aggregation (milliseconds). */
  durationMs: number;
}

/** Polling interval for checking sub-task completion. */
const POLL_INTERVAL_MS = 1000;

/** Terminal task statuses that indicate completion (success or failure). */
const TERMINAL_STATUSES = new Set<string>([
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
  TaskStatus.TIMED_OUT,
]);

export class AggregationPattern {
  constructor(
    private taskManager: TaskManager,
    private redis: Redis,
  ) {}

  /**
   * Execute an aggregation: create sub-tasks, monitor progress,
   * and combine the results.
   *
   * @param coordinatorDid - DID of the coordinating agent.
   * @param config         - Aggregation configuration.
   */
  async execute(coordinatorDid: string, config: AggregationConfig): Promise<AggregationResult> {
    if (config.subTasks.length === 0) {
      return {
        combined: [],
        results: [],
        failed: [],
        durationMs: 0,
      };
    }

    if (config.mode === "parallel") {
      return this.executeParallel(coordinatorDid, config);
    }

    return this.executeSequential(coordinatorDid, config);
  }

  // ────────────────────────────────────────────────────
  // Parallel Execution
  // ────────────────────────────────────────────────────

  /**
   * Create all sub-tasks simultaneously and wait for all
   * of them to complete (or timeout).
   *
   * @internal
   */
  private async executeParallel(
    coordinatorDid: string,
    config: AggregationConfig,
  ): Promise<AggregationResult> {
    const startTime = Date.now();
    const failFast = config.failFast ?? false;
    const deadline = startTime + config.timeoutMs;

    // Create all sub-tasks in parallel
    const taskEntries = await Promise.all(
      config.subTasks.map(async (subTask) => {
        const task = await this.taskManager.createTask({
          requesterDid: coordinatorDid,
          title: subTask.title,
          skill: subTask.skill,
          input: subTask.input,
        });
        return { task, definition: subTask };
      }),
    );

    // Accept all sub-tasks on behalf of their target providers
    for (const entry of taskEntries) {
      try {
        await this.taskManager.acceptTask(entry.task.id, entry.definition.targetDid);
      } catch {
        // If accept fails, the task remains in SUBMITTED state
        // and will eventually time out or be processed by the target
      }
    }

    // Poll for completion
    const results: TaskResult[] = [];
    const failed: TaskResult[] = [];
    const pendingIds = new Set(taskEntries.map((e) => e.task.id));

    while (pendingIds.size > 0 && Date.now() < deadline) {
      for (const entry of taskEntries) {
        if (!pendingIds.has(entry.task.id)) continue;

        const current = await this.taskManager.getTask(entry.task.id);
        if (!current) continue;

        if (TERMINAL_STATUSES.has(current.status)) {
          pendingIds.delete(entry.task.id);

          const result: TaskResult = {
            taskId: entry.task.id,
            targetDid: entry.definition.targetDid,
            success: current.status === TaskStatus.COMPLETED,
            output: current.status === TaskStatus.COMPLETED ? current.output : undefined,
            error:
              current.status !== TaskStatus.COMPLETED
                ? `Task ended with status ${current.status}`
                : undefined,
          };

          results.push(result);
          if (!result.success) {
            failed.push(result);
            if (failFast) {
              // Cancel remaining pending tasks
              for (const remainingId of pendingIds) {
                try {
                  await this.taskManager.cancelTask(
                    remainingId,
                    coordinatorDid,
                    "Aggregation failed fast due to sub-task failure",
                  );
                } catch {
                  // Best-effort cancellation
                }
              }
              pendingIds.clear();
              break;
            }
          }
        }
      }

      if (pendingIds.size > 0 && Date.now() < deadline) {
        await sleep(POLL_INTERVAL_MS);
      }
    }

    // Handle any remaining pending tasks (timed out at aggregation level)
    for (const entry of taskEntries) {
      if (pendingIds.has(entry.task.id)) {
        const timedOutResult: TaskResult = {
          taskId: entry.task.id,
          targetDid: entry.definition.targetDid,
          success: false,
          error: "Sub-task timed out waiting for aggregation deadline",
        };
        results.push(timedOutResult);
        failed.push(timedOutResult);
      }
    }

    const combined = config.combiner
      ? config.combiner(results.filter((r) => r.success))
      : results.filter((r) => r.success).map((r) => r.output);

    return {
      combined,
      results,
      failed,
      durationMs: Date.now() - startTime,
    };
  }

  // ────────────────────────────────────────────────────
  // Sequential Execution
  // ────────────────────────────────────────────────────

  /**
   * Create and execute sub-tasks one at a time, in order.
   * Each sub-task must complete before the next one starts.
   *
   * @internal
   */
  private async executeSequential(
    coordinatorDid: string,
    config: AggregationConfig,
  ): Promise<AggregationResult> {
    const startTime = Date.now();
    const failFast = config.failFast ?? true;
    const deadline = startTime + config.timeoutMs;

    const results: TaskResult[] = [];
    const failed: TaskResult[] = [];

    for (const subTask of config.subTasks) {
      if (Date.now() >= deadline) {
        // Out of time — mark remaining as timed out
        const timedOutResult: TaskResult = {
          taskId: "",
          targetDid: subTask.targetDid,
          success: false,
          error: "Aggregation deadline exceeded before sub-task could start",
        };
        results.push(timedOutResult);
        failed.push(timedOutResult);
        if (failFast) break;
        continue;
      }

      // Create the sub-task
      const task = await this.taskManager.createTask({
        requesterDid: coordinatorDid,
        title: subTask.title,
        skill: subTask.skill,
        input: subTask.input,
      });

      // Accept on behalf of the target provider
      try {
        await this.taskManager.acceptTask(task.id, subTask.targetDid);
      } catch {
        // Continue — task may still be picked up
      }

      // Poll until this sub-task completes or times out
      let finalTask: TaskRecord | null = null;
      while (Date.now() < deadline) {
        const current = await this.taskManager.getTask(task.id);
        if (current && TERMINAL_STATUSES.has(current.status)) {
          finalTask = current;
          break;
        }
        await sleep(POLL_INTERVAL_MS);
      }

      const result: TaskResult = {
        taskId: task.id,
        targetDid: subTask.targetDid,
        success: finalTask?.status === TaskStatus.COMPLETED,
        output: finalTask?.status === TaskStatus.COMPLETED ? finalTask.output : undefined,
        error: !finalTask
          ? "Sub-task timed out"
          : finalTask.status !== TaskStatus.COMPLETED
            ? `Task ended with status ${finalTask.status}`
            : undefined,
      };

      results.push(result);
      if (!result.success) {
        failed.push(result);
        if (failFast) break;
      }
    }

    const combined = config.combiner
      ? config.combiner(results.filter((r) => r.success))
      : results.filter((r) => r.success).map((r) => r.output);

    return {
      combined,
      results,
      failed,
      durationMs: Date.now() - startTime,
    };
  }
}

// ────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
