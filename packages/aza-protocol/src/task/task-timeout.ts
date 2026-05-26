import type Redis from "ioredis";
import { TASK_STATE_TIMEOUTS, TaskStatus, isTerminalStatus } from "../types/task";
import type { TaskManager } from "./task-manager";

// ──────────────────────────────────────────────────────
// Task Timeout Manager
// ──────────────────────────────────────────────────────
// Uses a Redis sorted set to schedule and detect per-state
// timeouts for tasks. When a task sits in a non-terminal
// state beyond its configured timeout, the manager
// transitions it to TIMED_OUT.
//
// The sorted set uses:
//   score  = Unix timestamp (seconds) when the timeout fires
//   member = "taskId:status" (compound key to detect stale entries)
//
// A background polling loop runs at a configurable interval
// and processes any expired entries.
// ──────────────────────────────────────────────────────

/** Default polling interval for checking expired timeouts. */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/** System DID used for timeout-initiated transitions. */
const SYSTEM_DID = "did:aza:system:timeout-manager";

export class TaskTimeoutManager {
  private static readonly TIMEOUT_KEY = "aza:task:timeouts";
  private running = false;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private redis: Redis,
    private taskManager: TaskManager,
  ) {}

  // ────────────────────────────────────────────────────
  // Scheduling
  // ────────────────────────────────────────────────────

  /**
   * Schedule a timeout for a task in a given state.
   * If `timeoutSeconds` is not provided, the default from
   * TASK_STATE_TIMEOUTS is used. Terminal states and states
   * with a zero timeout are silently skipped.
   */
  async scheduleTimeout(
    taskId: string,
    status: TaskStatus,
    timeoutSeconds?: number,
  ): Promise<void> {
    // Terminal states do not time out
    if (isTerminalStatus(status)) return;

    const seconds = timeoutSeconds ?? TASK_STATE_TIMEOUTS[status];
    if (seconds <= 0) return;

    const expiresAtSeconds = Math.floor(Date.now() / 1000) + seconds;
    const member = `${taskId}:${status}`;

    await this.redis.zadd(TaskTimeoutManager.TIMEOUT_KEY, expiresAtSeconds, member);
  }

  /**
   * Cancel all pending timeouts for a task.
   * This removes any member whose key starts with the given taskId.
   *
   * Because Redis sorted sets don't support prefix deletion natively,
   * we remove both the exact current status entry and do a scan-based
   * cleanup for any stale entries from previous states.
   */
  async cancelTimeout(taskId: string): Promise<void> {
    // Get all members that match this taskId prefix
    const allStatuses = Object.values(TaskStatus);
    const members = allStatuses.map((s) => `${taskId}:${s}`);

    if (members.length > 0) {
      await this.redis.zrem(TaskTimeoutManager.TIMEOUT_KEY, ...members);
    }
  }

  // ────────────────────────────────────────────────────
  // Background Polling Loop
  // ────────────────────────────────────────────────────

  /**
   * Start the background polling loop that checks for
   * expired timeouts at the given interval.
   */
  async start(pollIntervalMs?: number): Promise<void> {
    if (this.running) return;
    this.running = true;

    const interval = pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

    const poll = async () => {
      if (!this.running) return;

      try {
        await this.checkTimeouts();
      } catch (error) {
        console.error(
          "[TaskTimeoutManager] Error checking timeouts:",
          error instanceof Error ? error.message : error,
        );
      }

      if (this.running) {
        this.pollTimer = setTimeout(poll, interval);
      }
    };

    // Start the first poll
    await poll();
  }

  /**
   * Stop the background polling loop.
   */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ────────────────────────────────────────────────────
  // Timeout Checking
  // ────────────────────────────────────────────────────

  /**
   * Check the sorted set for entries with scores <= now,
   * meaning their timeout has expired. For each expired entry,
   * verify the task is still in the expected state and transition
   * it to TIMED_OUT.
   *
   * @internal
   */
  private async checkTimeouts(): Promise<void> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    // ZRANGEBYSCORE: get all members with score <= now
    const expired = await this.redis.zrangebyscore(
      TaskTimeoutManager.TIMEOUT_KEY,
      "-inf",
      nowSeconds,
    );

    if (!expired || expired.length === 0) return;

    for (const member of expired) {
      // Parse the member: "taskId:status"
      const separatorIndex = member.lastIndexOf(":");
      if (separatorIndex === -1) {
        // Malformed member, remove it
        await this.redis.zrem(TaskTimeoutManager.TIMEOUT_KEY, member);
        continue;
      }

      const taskId = member.substring(0, separatorIndex);
      const expectedStatus = member.substring(separatorIndex + 1);

      try {
        // Fetch the current task state
        const task = await this.taskManager.getTask(taskId);

        if (!task) {
          // Task no longer exists, clean up
          await this.redis.zrem(TaskTimeoutManager.TIMEOUT_KEY, member);
          continue;
        }

        // Only transition if the task is still in the expected state.
        // If it moved to a different state, this timeout entry is stale.
        if (task.status !== expectedStatus) {
          await this.redis.zrem(TaskTimeoutManager.TIMEOUT_KEY, member);
          continue;
        }

        // Already in a terminal state — nothing to do
        if (isTerminalStatus(task.status as TaskStatus)) {
          await this.redis.zrem(TaskTimeoutManager.TIMEOUT_KEY, member);
          continue;
        }

        // Transition to TIMED_OUT via the task manager's fail path
        // We use cancelTask-like logic but target TIMED_OUT specifically.
        // Since TaskManager doesn't expose a direct "timeout" method,
        // we use failTask with a timeout error code.
        await this.taskManager
          .failTask(
            taskId,
            SYSTEM_DID,
            "AZA-3009",
            `Task timed out in state ${expectedStatus}`,
            false,
          )
          .catch(async () => {
            // If failTask doesn't work (e.g., state doesn't allow FAILED),
            // try cancellation as a fallback
            try {
              await this.taskManager.cancelTask(
                taskId,
                SYSTEM_DID,
                `Timeout: task exceeded time limit in state ${expectedStatus}`,
              );
            } catch (cancelError) {
              console.error(
                `[TaskTimeoutManager] Failed to timeout task ${taskId}:`,
                cancelError instanceof Error ? cancelError.message : cancelError,
              );
            }
          });

        // Remove the processed member
        await this.redis.zrem(TaskTimeoutManager.TIMEOUT_KEY, member);
      } catch (error) {
        console.error(
          `[TaskTimeoutManager] Error processing timeout for ${member}:`,
          error instanceof Error ? error.message : error,
        );
        // Don't remove on error — it will be retried on next poll
      }
    }
  }
}
