import { describe, expect, it } from "vitest";
import { TaskStateMachine, type TransitionContext } from "../task/task-state-machine";
import { AZAError, AZAErrorCode } from "../types/errors";
import { TaskStatus } from "../types/task";

// ──────────────────────────────────────────────────────
// Role-based transition validation (Rank 18)
// ──────────────────────────────────────────────────────

const REQUESTER = "did:aza:testnet:requester-did-aaaaaaaaaaaaaaaa";
const PROVIDER = "did:aza:testnet:provider-did-bbbbbbbbbbbbbbbb";
const SYSTEM = "did:aza:system:timeout-worker-cccccccccccccccccc";

const sm = new TaskStateMachine();

function ctx(overrides: Partial<TransitionContext>): TransitionContext {
  return {
    taskId: "task-role-001",
    currentStatus: TaskStatus.SUBMITTED,
    targetStatus: TaskStatus.APPROVED,
    actorDid: REQUESTER,
    requesterDid: REQUESTER,
    providerDid: PROVIDER,
    ...overrides,
  };
}

// ── Test 1: requester-only cancel pre-work ───────────

describe("TaskStateMachine (role matrix)", () => {
  it("allows the REQUESTER to cancel a SUBMITTED task before work begins", () => {
    const t = ctx({
      currentStatus: TaskStatus.SUBMITTED,
      targetStatus: TaskStatus.CANCELED,
      actorDid: REQUESTER,
    });
    expect(() => sm.validate(t)).not.toThrow();
    expect(sm.canActorTransition(t)).toBe(true);
  });

  // ── Test 2: provider-only complete / fail ────────────

  it("allows only the PROVIDER (not requester, not system) to COMPLETE a task", () => {
    const providerOk = ctx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.COMPLETED,
      actorDid: PROVIDER,
    });
    expect(() => sm.validate(providerOk)).not.toThrow();

    const requesterBad = ctx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.COMPLETED,
      actorDid: REQUESTER,
    });
    expect(() => sm.validate(requesterBad)).toThrow(AZAError);

    // System (unknown DID) is also blocked for COMPLETED
    const systemBad = ctx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.COMPLETED,
      actorDid: SYSTEM,
    });
    expect(() => sm.validate(systemBad)).toThrow(AZAError);

    // FAILED is allowed for provider and system (but not requester)
    const failReqBad = ctx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.FAILED,
      actorDid: REQUESTER,
    });
    expect(() => sm.validate(failReqBad)).toThrow(AZAError);
  });

  // ── Test 3: system-only TIMED_OUT transition ─────────

  it("allows ONLY system actors to move a task to TIMED_OUT", () => {
    const systemOk = ctx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.TIMED_OUT,
      actorDid: SYSTEM,
    });
    expect(() => sm.validate(systemOk)).not.toThrow();

    const requesterBad = ctx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.TIMED_OUT,
      actorDid: REQUESTER,
    });
    expect(() => sm.validate(requesterBad)).toThrow(AZAError);

    const providerBad = ctx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.TIMED_OUT,
      actorDid: PROVIDER,
    });
    expect(() => sm.validate(providerBad)).toThrow(AZAError);
  });

  // ── Test 4: illegal transitions carry correct code ───

  it("rejects illegal transitions with AZA-3002 and an actionable message", () => {
    const bad = ctx({
      currentStatus: TaskStatus.APPROVED,
      // APPROVED cannot go straight to COMPLETED
      targetStatus: TaskStatus.COMPLETED,
      actorDid: PROVIDER,
    });

    let thrown: unknown = null;
    try {
      sm.validate(bad);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(AZAError);
    expect((thrown as AZAError).code).toBe(AZAErrorCode.TASK_INVALID_TRANSITION);
    expect((thrown as AZAError).message).toContain("Invalid transition from APPROVED to COMPLETED");
  });

  // ── Test 5: terminal state lock ──────────────────────

  it("locks tasks in terminal states (COMPLETED / CANCELED) against any transition", () => {
    expect(sm.isTerminal(TaskStatus.COMPLETED)).toBe(true);
    expect(sm.isTerminal(TaskStatus.CANCELED)).toBe(true);

    // No actor role can escape a terminal state
    for (const actor of [REQUESTER, PROVIDER, SYSTEM]) {
      // COMPLETED -> WORKING (invalid)
      const fromCompleted = ctx({
        currentStatus: TaskStatus.COMPLETED,
        targetStatus: TaskStatus.WORKING,
        actorDid: actor,
      });
      expect(() => sm.validate(fromCompleted)).toThrow(AZAError);

      // CANCELED -> SUBMITTED (invalid — CANCELED has no retry path)
      const fromCanceled = ctx({
        currentStatus: TaskStatus.CANCELED,
        targetStatus: TaskStatus.SUBMITTED,
        actorDid: actor,
      });
      expect(() => sm.validate(fromCanceled)).toThrow(AZAError);
    }

    // getValidNextStates for terminal states returns an empty list
    expect(sm.getValidNextStates(TaskStatus.COMPLETED)).toEqual([]);
    expect(sm.getValidNextStates(TaskStatus.CANCELED)).toEqual([]);
  });
});
