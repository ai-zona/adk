import { AZAError, AZAErrorCode } from "../types/errors";
import { TASK_TRANSITIONS, TaskStatus, isTerminalStatus, isValidTransition } from "../types/task";

// ──────────────────────────────────────────────────────
// Task State Machine
// ──────────────────────────────────────────────────────
// Formal state machine that enforces valid task status
// transitions with role-based permission checks.
//
// Three actor roles:
//   - requester: the DID that created the task
//   - provider:  the DID assigned to execute the task
//   - system:    internal system transitions (timeouts, retries)
// ──────────────────────────────────────────────────────

export interface TransitionContext {
  taskId: string;
  currentStatus: TaskStatus;
  targetStatus: TaskStatus;
  /** DID of who is performing this transition. */
  actorDid: string;
  /** DID of the task requester (creator). */
  requesterDid: string;
  /** DID of the task provider (executor), if assigned. */
  providerDid?: string;
}

type ActorRole = "requester" | "provider" | "system";

/**
 * For each target status, define which actor roles are allowed to
 * transition *into* that status. A "system" role represents internal
 * transitions triggered by timeouts, retries, or orchestration logic.
 */
const TARGET_ROLE_PERMISSIONS: Record<TaskStatus, readonly ActorRole[]> = {
  // Pre-work gating states
  [TaskStatus.SUBMITTED]: ["requester", "system"],
  [TaskStatus.CONSENT_REQUIRED]: ["provider", "system"],
  [TaskStatus.PAYMENT_REQUIRED]: ["provider", "system"],
  [TaskStatus.APPROVED]: ["requester", "system"],

  // Active work states
  [TaskStatus.WORKING]: ["provider", "system"],
  [TaskStatus.INPUT_REQUIRED]: ["provider"],
  [TaskStatus.TEAM_FORMING]: ["provider", "system"],
  [TaskStatus.REVIEWING]: ["provider", "system"],

  // Terminal states
  [TaskStatus.COMPLETED]: ["provider"],
  [TaskStatus.FAILED]: ["provider", "system"],
  [TaskStatus.CANCELED]: ["requester", "provider", "system"],
  [TaskStatus.TIMED_OUT]: ["system"],
} as const;

/**
 * Determine the actor's role relative to a task.
 * If the actor matches neither requester nor provider, returns undefined.
 */
function resolveRole(
  actorDid: string,
  requesterDid: string,
  providerDid: string | undefined,
): ActorRole | undefined {
  if (actorDid === requesterDid) return "requester";
  if (providerDid && actorDid === providerDid) return "provider";
  return undefined;
}

export class TaskStateMachine {
  /**
   * Validate a state transition. Throws AZAError if the transition
   * is invalid according to the state graph or role permissions.
   */
  validate(ctx: TransitionContext): void {
    // 1. Check the transition is valid in the state graph
    if (!isValidTransition(ctx.currentStatus, ctx.targetStatus)) {
      throw new AZAError(
        AZAErrorCode.TASK_INVALID_TRANSITION,
        `Invalid transition from ${ctx.currentStatus} to ${ctx.targetStatus}`,
        {
          details: {
            taskId: ctx.taskId,
            from: ctx.currentStatus,
            to: ctx.targetStatus,
            actor: ctx.actorDid,
          },
        },
      );
    }

    // 2. Check the actor has permission for this transition
    if (!this.canActorTransition(ctx)) {
      throw new AZAError(
        AZAErrorCode.TASK_INVALID_TRANSITION,
        `Actor ${ctx.actorDid} is not authorized to transition task ${ctx.taskId} to ${ctx.targetStatus}`,
        {
          details: {
            taskId: ctx.taskId,
            from: ctx.currentStatus,
            to: ctx.targetStatus,
            actor: ctx.actorDid,
            requester: ctx.requesterDid,
            provider: ctx.providerDid,
          },
        },
      );
    }
  }

  /**
   * Check whether a transition from `from` to `to` is valid
   * according to the state graph (ignores role permissions).
   */
  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return isValidTransition(from, to);
  }

  /**
   * Get all valid next states from the current state.
   */
  getValidNextStates(current: TaskStatus): readonly TaskStatus[] {
    return TASK_TRANSITIONS[current];
  }

  /**
   * Returns true if the status is terminal (no further transitions).
   */
  isTerminal(status: TaskStatus): boolean {
    return isTerminalStatus(status);
  }

  /**
   * Check whether a specific actor has permission to perform
   * the given transition based on their role.
   *
   * An actor whose DID matches neither requester nor provider
   * is treated as "system" -- this allows internal processes
   * (timeout managers, orchestrators) to perform system-level
   * transitions without matching a task participant DID.
   */
  canActorTransition(ctx: TransitionContext): boolean {
    const role = resolveRole(ctx.actorDid, ctx.requesterDid, ctx.providerDid);
    const allowedRoles = TARGET_ROLE_PERMISSIONS[ctx.targetStatus];

    if (!allowedRoles) {
      return false;
    }

    // If the actor is a known participant, check their role
    if (role) {
      return allowedRoles.includes(role);
    }

    // Unknown actor is treated as "system" — only allowed if "system" is in the permitted roles
    return allowedRoles.includes("system");
  }
}
