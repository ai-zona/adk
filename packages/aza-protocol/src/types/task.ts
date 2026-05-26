import { z } from "zod";

// ──────────────────────────────────────────────────────
// Task Status (aligned with Prisma AZATaskStatus)
// ──────────────────────────────────────────────────────

export const TaskStatus = {
  SUBMITTED: "SUBMITTED",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  PAYMENT_REQUIRED: "PAYMENT_REQUIRED",
  APPROVED: "APPROVED",
  WORKING: "WORKING",
  INPUT_REQUIRED: "INPUT_REQUIRED",
  TEAM_FORMING: "TEAM_FORMING",
  REVIEWING: "REVIEWING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELED: "CANCELED",
  TIMED_OUT: "TIMED_OUT",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskStatusSchema = z.enum([
  TaskStatus.SUBMITTED,
  TaskStatus.CONSENT_REQUIRED,
  TaskStatus.PAYMENT_REQUIRED,
  TaskStatus.APPROVED,
  TaskStatus.WORKING,
  TaskStatus.INPUT_REQUIRED,
  TaskStatus.TEAM_FORMING,
  TaskStatus.REVIEWING,
  TaskStatus.COMPLETED,
  TaskStatus.FAILED,
  TaskStatus.CANCELED,
  TaskStatus.TIMED_OUT,
]);

// ──────────────────────────────────────────────────────
// Task Topology (aligned with Prisma AZATaskTopology)
// ──────────────────────────────────────────────────────

export const TaskTopology = {
  ONE_TO_ONE: "ONE_TO_ONE",
  ONE_TO_MANY: "ONE_TO_MANY",
  MANY_TO_ONE: "MANY_TO_ONE",
  MANY_TO_MANY: "MANY_TO_MANY",
} as const;

export type TaskTopology = (typeof TaskTopology)[keyof typeof TaskTopology];

export const TaskTopologySchema = z.enum([
  TaskTopology.ONE_TO_ONE,
  TaskTopology.ONE_TO_MANY,
  TaskTopology.MANY_TO_ONE,
  TaskTopology.MANY_TO_MANY,
]);

// ──────────────────────────────────────────────────────
// Message Priority (aligned with Prisma AZAMessagePriority)
// ──────────────────────────────────────────────────────

export const MessagePriority = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
  URGENT: "URGENT",
} as const;

export type MessagePriority = (typeof MessagePriority)[keyof typeof MessagePriority];

export const MessagePrioritySchema = z.enum([
  MessagePriority.LOW,
  MessagePriority.NORMAL,
  MessagePriority.HIGH,
  MessagePriority.URGENT,
]);

// ──────────────────────────────────────────────────────
// Valid State Transitions
// ──────────────────────────────────────────────────────

/**
 * Defines all valid state transitions for tasks.
 * Each key is the current state, and the value is an array of valid next states.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  [TaskStatus.SUBMITTED]: [
    TaskStatus.CONSENT_REQUIRED,
    TaskStatus.PAYMENT_REQUIRED,
    TaskStatus.APPROVED,
    TaskStatus.CANCELED,
    TaskStatus.TIMED_OUT,
  ],
  [TaskStatus.CONSENT_REQUIRED]: [
    TaskStatus.PAYMENT_REQUIRED,
    TaskStatus.APPROVED,
    TaskStatus.CANCELED,
    TaskStatus.TIMED_OUT,
  ],
  [TaskStatus.PAYMENT_REQUIRED]: [TaskStatus.APPROVED, TaskStatus.CANCELED, TaskStatus.TIMED_OUT],
  [TaskStatus.APPROVED]: [
    TaskStatus.WORKING,
    TaskStatus.TEAM_FORMING,
    TaskStatus.CANCELED,
    TaskStatus.TIMED_OUT,
  ],
  [TaskStatus.WORKING]: [
    TaskStatus.INPUT_REQUIRED,
    TaskStatus.REVIEWING,
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.CANCELED,
    TaskStatus.TIMED_OUT,
  ],
  [TaskStatus.INPUT_REQUIRED]: [TaskStatus.WORKING, TaskStatus.CANCELED, TaskStatus.TIMED_OUT],
  [TaskStatus.TEAM_FORMING]: [
    TaskStatus.WORKING,
    TaskStatus.FAILED,
    TaskStatus.CANCELED,
    TaskStatus.TIMED_OUT,
  ],
  [TaskStatus.REVIEWING]: [
    TaskStatus.WORKING,
    TaskStatus.COMPLETED,
    TaskStatus.FAILED,
    TaskStatus.CANCELED,
  ],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.FAILED]: [TaskStatus.SUBMITTED], // Allow retry via re-submission
  [TaskStatus.CANCELED]: [],
  [TaskStatus.TIMED_OUT]: [TaskStatus.SUBMITTED], // Allow retry via re-submission
} as const;

/**
 * Check whether a transition from `from` to `to` is valid.
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  const validTargets = TASK_TRANSITIONS[from];
  return validTargets.includes(to);
}

// ──────────────────────────────────────────────────────
// State Timeout Configuration (seconds)
// ──────────────────────────────────────────────────────

/**
 * Default timeout in seconds for each task state.
 * A value of 0 means no timeout (terminal or indefinite states).
 */
export const TASK_STATE_TIMEOUTS: Record<TaskStatus, number> = {
  [TaskStatus.SUBMITTED]: 300, // 5 min to be picked up
  [TaskStatus.CONSENT_REQUIRED]: 600, // 10 min for consent
  [TaskStatus.PAYMENT_REQUIRED]: 600, // 10 min for payment
  [TaskStatus.APPROVED]: 120, // 2 min to start working
  [TaskStatus.WORKING]: 3600, // 1 hour default work time
  [TaskStatus.INPUT_REQUIRED]: 1800, // 30 min waiting for input
  [TaskStatus.TEAM_FORMING]: 600, // 10 min to form team
  [TaskStatus.REVIEWING]: 900, // 15 min for review
  [TaskStatus.COMPLETED]: 0, // Terminal state
  [TaskStatus.FAILED]: 0, // Terminal state
  [TaskStatus.CANCELED]: 0, // Terminal state
  [TaskStatus.TIMED_OUT]: 0, // Terminal state
} as const;

/**
 * Returns true if the given status is a terminal state (no further transitions possible).
 */
export function isTerminalStatus(status: TaskStatus): boolean {
  return TASK_TRANSITIONS[status].length === 0;
}

// ──────────────────────────────────────────────────────
// Payment Info
// ──────────────────────────────────────────────────────

export const PaymentInfoSchema = z.object({
  amount: z.string(), // String to avoid floating-point issues (e.g., "1.5" SOL)
  currency: z.string(), // "SOL", "USDC", "AZA"
  escrowId: z.string().optional(),
  escrowAddress: z.string().optional(),
  status: z.enum(["pending", "escrowed", "released", "refunded", "failed"]).default("pending"),
});

export type PaymentInfo = z.infer<typeof PaymentInfoSchema>;

// ──────────────────────────────────────────────────────
// Task Artifact
// ──────────────────────────────────────────────────────

export const TaskArtifactSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  artifactType: z.enum(["result", "log", "report", "media", "data"]),
  mimeType: z.string(),
  data: z.unknown(),
  size: z.number().int().nonnegative().optional(),
  checksum: z.string().optional(),
  createdAt: z.number(), // Unix timestamp ms
});

export type TaskArtifact = z.infer<typeof TaskArtifactSchema>;

// ──────────────────────────────────────────────────────
// Task Payloads (used inside message envelopes)
// ──────────────────────────────────────────────────────

/**
 * Payload for task.request messages: an agent is requesting a task to be performed.
 */
export const TaskRequestPayloadSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(5000).optional(),
  skill: z.string().min(1),
  topology: TaskTopologySchema.default("ONE_TO_ONE"),
  input: z.unknown().optional(),
  payment: PaymentInfoSchema.optional(),
  timeoutSeconds: z.number().int().positive().default(3600),
  maxRetries: z.number().int().nonnegative().default(3),
  priority: MessagePrioritySchema.default("NORMAL"),
  tags: z.array(z.string()).default([]),
  parentTaskId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
});

export type TaskRequestPayload = z.infer<typeof TaskRequestPayloadSchema>;

/**
 * Payload for task.response messages: the provider agent accepts or acknowledges the task.
 */
export const TaskResponsePayloadSchema = z.object({
  taskId: z.string().uuid(),
  accepted: z.boolean(),
  reason: z.string().optional(),
  estimatedDurationSeconds: z.number().int().positive().optional(),
  counterOffer: PaymentInfoSchema.optional(),
});

export type TaskResponsePayload = z.infer<typeof TaskResponsePayloadSchema>;

/**
 * Payload for task.progress messages: intermediate progress updates.
 */
export const TaskProgressPayloadSchema = z.object({
  taskId: z.string().uuid(),
  status: TaskStatusSchema,
  progress: z.number().min(0).max(100).optional(), // Percentage 0-100
  message: z.string().max(2000).optional(),
  artifacts: z.array(TaskArtifactSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type TaskProgressPayload = z.infer<typeof TaskProgressPayloadSchema>;

/**
 * Payload for task.complete messages: the task has been completed.
 */
export const TaskCompletePayloadSchema = z.object({
  taskId: z.string().uuid(),
  output: z.unknown(),
  artifacts: z.array(TaskArtifactSchema).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type TaskCompletePayload = z.infer<typeof TaskCompletePayloadSchema>;

/**
 * Payload for task.fail messages: the task has failed.
 */
export const TaskFailPayloadSchema = z.object({
  taskId: z.string().uuid(),
  errorCode: z.string(),
  errorMessage: z.string(),
  retryable: z.boolean().default(false),
  retryAfterMs: z.number().int().positive().optional(),
  artifacts: z.array(TaskArtifactSchema).optional(), // Partial results or logs
  metadata: z.record(z.unknown()).optional(),
});

export type TaskFailPayload = z.infer<typeof TaskFailPayloadSchema>;

/**
 * Payload for task.cancel messages.
 */
export const TaskCancelPayloadSchema = z.object({
  taskId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
  canceledBy: z.string(), // DID of the canceling agent
});

export type TaskCancelPayload = z.infer<typeof TaskCancelPayloadSchema>;

/**
 * Payload for task.accept messages: explicit acceptance separate from response.
 */
export const TaskAcceptPayloadSchema = z.object({
  taskId: z.string().uuid(),
  estimatedDurationSeconds: z.number().int().positive().optional(),
  message: z.string().max(2000).optional(),
});

export type TaskAcceptPayload = z.infer<typeof TaskAcceptPayloadSchema>;

/**
 * Payload for task.reject messages: explicit rejection.
 */
export const TaskRejectPayloadSchema = z.object({
  taskId: z.string().uuid(),
  reason: z.string().max(2000),
  suggestAlternative: z.string().optional(), // DID of an alternative provider
});

export type TaskRejectPayload = z.infer<typeof TaskRejectPayloadSchema>;
