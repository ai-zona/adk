import { randomUUID } from "node:crypto";
import { db } from "@aizona/db";
import type { AuditLogger } from "../audit/audit-logger";
import { RedisStreamTransport } from "../transport/redis-streams";
import { AZAError, AZAErrorCode } from "../types/errors";
import type { AZAEnvelope } from "../types/messages";
import { AZAMessageType } from "../types/messages";
import { TASK_STATE_TIMEOUTS, TaskStatus, isTerminalStatus } from "../types/task";
import type {
  PaymentInfo,
  TaskCancelPayload,
  TaskCompletePayload,
  TaskFailPayload,
  TaskProgressPayload,
  TaskRequestPayload,
} from "../types/task";
import type { MessagePriority, TaskTopology } from "../types/task";
import type { ArtifactInput } from "./artifact-manager";
import type { TaskStateMachine } from "./task-state-machine";
import type { TransitionContext } from "./task-state-machine";

// ──────────────────────────────────────────────────────
// Task Manager
// ──────────────────────────────────────────────────────
// High-level task lifecycle operations backed by Prisma
// for durable storage and Redis Streams for real-time
// message distribution.
//
// Invariants:
//   - Every state change is validated via TaskStateMachine
//   - Every state change is published as a protocol message
//   - Every state change is audit-logged
//   - Terminal states are immutable
// ──────────────────────────────────────────────────────

/** Input parameters for creating a new task. */
export interface CreateTaskParams {
  requesterDid: string;
  title: string;
  description?: string;
  skill: string;
  input?: unknown;
  payment?: PaymentInfo;
  topology?: TaskTopology;
  timeoutSeconds?: number;
  priority?: MessagePriority;
  tags?: string[];
  parentTaskId?: string;
  teamId?: string;
}

/** Parameters for listing tasks with cursor-based pagination. */
export interface TaskListParams {
  requesterDid?: string;
  providerDid?: string;
  status?: TaskStatus;
  skill?: string;
  parentTaskId?: string;
  teamId?: string;
  cursor?: string;
  limit?: number;
}

/** The Prisma AZATask record type. */
export type TaskRecord = Awaited<ReturnType<typeof db.aZATask.findUniqueOrThrow>>;

export class TaskManager {
  constructor(
    private stateMachine: TaskStateMachine,
    private transport: RedisStreamTransport,
    private auditLogger: AuditLogger,
  ) {}

  // ────────────────────────────────────────────────────
  // Task Creation
  // ────────────────────────────────────────────────────

  /**
   * Create a new task, persist it to the database, and publish
   * a task.request message to the task's event stream.
   */
  async createTask(params: CreateTaskParams): Promise<TaskRecord> {
    const taskId = randomUUID();
    const now = new Date();
    const timeoutSeconds = params.timeoutSeconds ?? TASK_STATE_TIMEOUTS[TaskStatus.SUBMITTED];

    const task = await db.aZATask.create({
      data: {
        id: taskId,
        title: params.title,
        description: params.description ?? null,
        skill: params.skill,
        requesterDid: params.requesterDid,
        providerDid: null,
        topology: (params.topology ?? "ONE_TO_ONE") as never,
        status: TaskStatus.SUBMITTED as never,
        input: (params.input ?? null) as any,
        output: null as any,
        payment: params.payment ? (params.payment as any) : (null as any),
        timeoutSeconds: timeoutSeconds,
        maxRetries: 3,
        retryCount: 0,
        priority: (params.priority ?? "NORMAL") as never,
        tags: params.tags ?? [],
        parentTaskId: params.parentTaskId ?? null,
        teamId: params.teamId ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Publish task.request to the task event stream
    const payload: TaskRequestPayload = {
      taskId,
      title: params.title,
      description: params.description,
      skill: params.skill,
      topology: params.topology ?? "ONE_TO_ONE",
      input: params.input,
      payment: params.payment,
      timeoutSeconds: timeoutSeconds,
      maxRetries: 3,
      priority: params.priority ?? "NORMAL",
      tags: params.tags ?? [],
      parentTaskId: params.parentTaskId,
      teamId: params.teamId,
    };

    const envelope = this.buildEnvelope(
      params.requesterDid,
      null,
      AZAMessageType.TASK_REQUEST,
      payload,
      taskId,
      params.priority,
    );

    await this.transport.publish(RedisStreamTransport.taskStream(taskId), envelope);
    await this.auditLogger.logMessage(envelope, { action: "task.created" });

    return task;
  }

  // ────────────────────────────────────────────────────
  // Task Acceptance
  // ────────────────────────────────────────────────────

  /**
   * Accept a task: transitions from SUBMITTED or APPROVED to WORKING
   * and assigns the provider DID.
   */
  async acceptTask(taskId: string, providerDid: string): Promise<TaskRecord> {
    const task = await this.getTaskOrThrow(taskId);

    // Provider must not already be assigned
    if (task.providerDid && task.providerDid !== providerDid) {
      throw new AZAError(
        AZAErrorCode.TASK_ALREADY_ASSIGNED,
        `Task ${taskId} is already assigned to ${task.providerDid}`,
        { details: { taskId, existingProvider: task.providerDid, requestedProvider: providerDid } },
      );
    }

    return this.transition(taskId, providerDid, TaskStatus.WORKING, {
      providerDid,
    });
  }

  // ────────────────────────────────────────────────────
  // Task Completion
  // ────────────────────────────────────────────────────

  /**
   * Complete a task: transitions from WORKING or REVIEWING to COMPLETED.
   * Stores the output and optional artifacts.
   */
  async completeTask(
    taskId: string,
    actorDid: string,
    output: unknown,
    artifacts?: ArtifactInput[],
  ): Promise<TaskRecord> {
    const result = await this.transition(taskId, actorDid, TaskStatus.COMPLETED, {
      output,
    });

    // Store artifacts if provided
    if (artifacts && artifacts.length > 0) {
      for (const artifact of artifacts) {
        const data = JSON.stringify(artifact.data);
        const { sha256 } = await import("@noble/hashes/sha2.js");
        const checksum = Buffer.from(sha256(new TextEncoder().encode(data))).toString("hex");

        await db.aZATaskArtifact.create({
          data: {
            id: randomUUID(),
            taskId,
            artifactType: artifact.artifactType,
            mimeType: artifact.mimeType,
            data: artifact.data as any,
            size: new TextEncoder().encode(data).byteLength,
            checksum,
          },
        });
      }
    }

    // Publish task.complete message
    const payload: TaskCompletePayload = {
      taskId,
      output,
    };

    const envelope = this.buildEnvelope(
      actorDid,
      result.requesterDid,
      AZAMessageType.TASK_COMPLETE,
      payload,
      taskId,
    );

    await this.transport.publish(RedisStreamTransport.taskStream(taskId), envelope);
    await this.auditLogger.logMessage(envelope, { action: "task.completed" });

    return result;
  }

  // ────────────────────────────────────────────────────
  // Task Failure
  // ────────────────────────────────────────────────────

  /**
   * Fail a task: transitions to FAILED and increments the retry count.
   */
  async failTask(
    taskId: string,
    actorDid: string,
    errorCode: string,
    errorMessage: string,
    retryable?: boolean,
  ): Promise<TaskRecord> {
    const task = await this.getTaskOrThrow(taskId);

    const result = await this.transition(taskId, actorDid, TaskStatus.FAILED, {
      retryCount: { increment: 1 },
    });

    // Publish task.fail message
    const payload: TaskFailPayload = {
      taskId,
      errorCode,
      errorMessage,
      retryable: retryable ?? task.retryCount < task.maxRetries,
    };

    const envelope = this.buildEnvelope(
      actorDid,
      task.requesterDid,
      AZAMessageType.TASK_FAIL,
      payload,
      taskId,
    );

    await this.transport.publish(RedisStreamTransport.taskStream(taskId), envelope);
    await this.auditLogger.logMessage(envelope, { action: "task.failed" });

    return result;
  }

  // ────────────────────────────────────────────────────
  // Task Cancellation
  // ────────────────────────────────────────────────────

  /**
   * Cancel a task from any non-terminal state.
   */
  async cancelTask(taskId: string, actorDid: string, reason?: string): Promise<TaskRecord> {
    const task = await this.getTaskOrThrow(taskId);

    if (isTerminalStatus(task.status as TaskStatus)) {
      throw new AZAError(
        AZAErrorCode.TASK_INVALID_TRANSITION,
        `Cannot cancel task ${taskId}: already in terminal state ${task.status}`,
        { details: { taskId, status: task.status } },
      );
    }

    const result = await this.transition(taskId, actorDid, TaskStatus.CANCELED);

    // Publish task.cancel message
    const payload: TaskCancelPayload = {
      taskId,
      reason,
      canceledBy: actorDid,
    };

    const notifyDid = task.providerDid ?? task.requesterDid;
    const envelope = this.buildEnvelope(
      actorDid,
      notifyDid !== actorDid ? notifyDid : null,
      AZAMessageType.TASK_CANCEL,
      payload,
      taskId,
    );

    await this.transport.publish(RedisStreamTransport.taskStream(taskId), envelope);
    await this.auditLogger.logMessage(envelope, { action: "task.canceled" });

    return result;
  }

  // ────────────────────────────────────────────────────
  // Progress Updates
  // ────────────────────────────────────────────────────

  /**
   * Publish a progress update for a task that is currently in WORKING state.
   * This does not change the task status; it publishes a task.progress message.
   */
  async updateProgress(
    taskId: string,
    actorDid: string,
    progress: number,
    message?: string,
  ): Promise<void> {
    const task = await this.getTaskOrThrow(taskId);

    if (task.status !== TaskStatus.WORKING) {
      throw new AZAError(
        AZAErrorCode.TASK_INVALID_STATE,
        `Cannot update progress for task ${taskId}: status is ${task.status}, expected WORKING`,
        { details: { taskId, status: task.status } },
      );
    }

    const payload: TaskProgressPayload = {
      taskId,
      status: TaskStatus.WORKING,
      progress: Math.min(100, Math.max(0, progress)),
      message,
    };

    const envelope = this.buildEnvelope(
      actorDid,
      task.requesterDid,
      AZAMessageType.TASK_PROGRESS,
      payload,
      taskId,
    );

    await this.transport.publish(RedisStreamTransport.taskStream(taskId), envelope);
    await this.auditLogger.logMessage(envelope, { action: "task.progress" });
  }

  // ────────────────────────────────────────────────────
  // Query Operations
  // ────────────────────────────────────────────────────

  /**
   * Get a single task by ID.
   */
  async getTask(taskId: string): Promise<TaskRecord | null> {
    return db.aZATask.findUnique({ where: { id: taskId } });
  }

  /**
   * List tasks with optional filtering and cursor-based pagination.
   */
  async listTasks(
    params: TaskListParams,
  ): Promise<{ tasks: TaskRecord[]; nextCursor: string | null }> {
    const limit = params.limit ?? 20;

    const where: Record<string, unknown> = {};
    if (params.requesterDid) where.requesterDid = params.requesterDid;
    if (params.providerDid) where.providerDid = params.providerDid;
    if (params.status) where.status = params.status;
    if (params.skill) where.skill = params.skill;
    if (params.parentTaskId) where.parentTaskId = params.parentTaskId;
    if (params.teamId) where.teamId = params.teamId;

    const tasks = await db.aZATask.findMany({
      where: {
        ...where,
        ...(params.cursor ? { id: { gt: params.cursor } } : {}),
      } as any,
      orderBy: { createdAt: "asc" },
      take: limit + 1,
    });

    let nextCursor: string | null = null;
    if (tasks.length > limit) {
      tasks.pop();
      const lastTask = tasks[tasks.length - 1];
      nextCursor = lastTask ? lastTask.id : null;
    }

    return { tasks, nextCursor };
  }

  // ────────────────────────────────────────────────────
  // Internal State Transition
  // ────────────────────────────────────────────────────

  /**
   * Core transition method: validates the transition, updates the
   * database, publishes a status message, and logs to audit trail.
   *
   * @internal
   */
  private async transition(
    taskId: string,
    actorDid: string,
    targetStatus: TaskStatus,
    data?: Record<string, unknown>,
  ): Promise<TaskRecord> {
    const task = await this.getTaskOrThrow(taskId);
    const currentStatus = task.status as TaskStatus;

    // Build transition context for validation
    const ctx: TransitionContext = {
      taskId,
      currentStatus,
      targetStatus,
      actorDid,
      requesterDid: task.requesterDid,
      providerDid: task.providerDid ?? undefined,
    };

    // Validate the transition (throws on failure)
    this.stateMachine.validate(ctx);

    // Update the database with optimistic locking:
    // The WHERE clause includes the current status to prevent TOCTOU races.
    // If another concurrent transition changed the status between our read
    // and this update, the updateMany will match 0 rows.
    const updateData: Record<string, unknown> = {
      status: targetStatus as never,
      updatedAt: new Date(),
      ...data,
    };

    // Set completedAt for terminal states
    if (isTerminalStatus(targetStatus)) {
      updateData.completedAt = new Date();
    }

    const result = await db.aZATask.updateMany({
      where: {
        id: taskId,
        status: currentStatus as never, // Only update if status hasn't changed
      },
      data: updateData as any,
    });

    if (result.count === 0) {
      throw new AZAError(
        AZAErrorCode.TASK_INVALID_TRANSITION,
        `Task ${taskId} status changed concurrently (expected ${currentStatus})`,
        {
          details: { taskId, expectedStatus: currentStatus, targetStatus },
        },
      );
    }

    // Fetch the updated record to return
    const updated = await this.getTaskOrThrow(taskId);

    return updated;
  }

  // ────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────

  /**
   * Fetch a task or throw TASK_NOT_FOUND.
   */
  private async getTaskOrThrow(taskId: string): Promise<TaskRecord> {
    const task = await db.aZATask.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new AZAError(AZAErrorCode.TASK_NOT_FOUND, `Task ${taskId} not found`, {
        details: { taskId },
      });
    }
    return task;
  }

  /**
   * Build a protocol envelope for a given message type and payload.
   */
  private buildEnvelope(
    from: string,
    to: string | null,
    type: (typeof AZAMessageType)[keyof typeof AZAMessageType],
    payload: unknown,
    correlationTaskId: string,
    priority?: MessagePriority,
  ): AZAEnvelope {
    return {
      id: randomUUID(),
      from,
      to: to ?? null,
      correlationId: correlationTaskId,
      type,
      payload,
      timestamp: Date.now(),
      priority: priority ?? "NORMAL",
      metadata: {
        protocolVersion: "2.0.0",
      },
    } as AZAEnvelope;
  }
}
