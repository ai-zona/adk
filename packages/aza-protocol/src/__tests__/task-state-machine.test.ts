import { describe, expect, it } from "vitest";
import { TaskStateMachine, type TransitionContext } from "../task/task-state-machine";
import { AZAError, AZAErrorCode } from "../types/errors";
import { TaskStatus } from "../types/task";

const sm = new TaskStateMachine();

// Helper DIDs for role-based tests
const REQUESTER_DID = "did:aza:testnet:aaaaaaaaaaaaaaaaaaaaaaaa";
const PROVIDER_DID = "did:aza:testnet:bbbbbbbbbbbbbbbbbbbbbbbb";
const SYSTEM_DID = "did:aza:testnet:cccccccccccccccccccccccc"; // unknown to both roles => treated as system

function makeCtx(overrides: Partial<TransitionContext> = {}): TransitionContext {
  return {
    taskId: "test-task-001",
    currentStatus: TaskStatus.SUBMITTED,
    targetStatus: TaskStatus.APPROVED,
    actorDid: REQUESTER_DID,
    requesterDid: REQUESTER_DID,
    providerDid: PROVIDER_DID,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────
// canTransition
// ──────────────────────────────────────────────────────

describe("TaskStateMachine.canTransition", () => {
  it("should return true for valid transitions", () => {
    expect(sm.canTransition(TaskStatus.SUBMITTED, TaskStatus.APPROVED)).toBe(true);
    expect(sm.canTransition(TaskStatus.SUBMITTED, TaskStatus.CONSENT_REQUIRED)).toBe(true);
    expect(sm.canTransition(TaskStatus.SUBMITTED, TaskStatus.PAYMENT_REQUIRED)).toBe(true);
    expect(sm.canTransition(TaskStatus.SUBMITTED, TaskStatus.CANCELED)).toBe(true);
    expect(sm.canTransition(TaskStatus.SUBMITTED, TaskStatus.TIMED_OUT)).toBe(true);
    expect(sm.canTransition(TaskStatus.APPROVED, TaskStatus.WORKING)).toBe(true);
    expect(sm.canTransition(TaskStatus.WORKING, TaskStatus.COMPLETED)).toBe(true);
    expect(sm.canTransition(TaskStatus.WORKING, TaskStatus.FAILED)).toBe(true);
    expect(sm.canTransition(TaskStatus.WORKING, TaskStatus.INPUT_REQUIRED)).toBe(true);
    expect(sm.canTransition(TaskStatus.WORKING, TaskStatus.REVIEWING)).toBe(true);
    expect(sm.canTransition(TaskStatus.REVIEWING, TaskStatus.COMPLETED)).toBe(true);
    expect(sm.canTransition(TaskStatus.REVIEWING, TaskStatus.WORKING)).toBe(true);
  });

  it("should return false for invalid transitions", () => {
    expect(sm.canTransition(TaskStatus.COMPLETED, TaskStatus.WORKING)).toBe(false);
    expect(sm.canTransition(TaskStatus.CANCELED, TaskStatus.WORKING)).toBe(false);
    expect(sm.canTransition(TaskStatus.SUBMITTED, TaskStatus.COMPLETED)).toBe(false);
    expect(sm.canTransition(TaskStatus.APPROVED, TaskStatus.SUBMITTED)).toBe(false);
    expect(sm.canTransition(TaskStatus.WORKING, TaskStatus.SUBMITTED)).toBe(false);
    expect(sm.canTransition(TaskStatus.WORKING, TaskStatus.APPROVED)).toBe(false);
  });

  it("should allow retry from FAILED back to SUBMITTED", () => {
    expect(sm.canTransition(TaskStatus.FAILED, TaskStatus.SUBMITTED)).toBe(true);
  });

  it("should allow retry from TIMED_OUT back to SUBMITTED", () => {
    expect(sm.canTransition(TaskStatus.TIMED_OUT, TaskStatus.SUBMITTED)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────
// getValidNextStates
// ──────────────────────────────────────────────────────

describe("TaskStateMachine.getValidNextStates", () => {
  it("should return correct next states for SUBMITTED", () => {
    const next = sm.getValidNextStates(TaskStatus.SUBMITTED);
    expect(next).toContain(TaskStatus.CONSENT_REQUIRED);
    expect(next).toContain(TaskStatus.PAYMENT_REQUIRED);
    expect(next).toContain(TaskStatus.APPROVED);
    expect(next).toContain(TaskStatus.CANCELED);
    expect(next).toContain(TaskStatus.TIMED_OUT);
    expect(next.length).toBe(5);
  });

  it("should return correct next states for WORKING", () => {
    const next = sm.getValidNextStates(TaskStatus.WORKING);
    expect(next).toContain(TaskStatus.INPUT_REQUIRED);
    expect(next).toContain(TaskStatus.REVIEWING);
    expect(next).toContain(TaskStatus.COMPLETED);
    expect(next).toContain(TaskStatus.FAILED);
    expect(next).toContain(TaskStatus.CANCELED);
    expect(next).toContain(TaskStatus.TIMED_OUT);
    expect(next.length).toBe(6);
  });

  it("should return an empty array for terminal state COMPLETED", () => {
    expect(sm.getValidNextStates(TaskStatus.COMPLETED)).toEqual([]);
  });

  it("should return an empty array for terminal state CANCELED", () => {
    expect(sm.getValidNextStates(TaskStatus.CANCELED)).toEqual([]);
  });

  it("should return [SUBMITTED] for FAILED (retry path)", () => {
    expect(sm.getValidNextStates(TaskStatus.FAILED)).toEqual([TaskStatus.SUBMITTED]);
  });

  it("should return [SUBMITTED] for TIMED_OUT (retry path)", () => {
    expect(sm.getValidNextStates(TaskStatus.TIMED_OUT)).toEqual([TaskStatus.SUBMITTED]);
  });
});

// ──────────────────────────────────────────────────────
// isTerminal
// ──────────────────────────────────────────────────────

describe("TaskStateMachine.isTerminal", () => {
  it("should return true for COMPLETED", () => {
    expect(sm.isTerminal(TaskStatus.COMPLETED)).toBe(true);
  });

  it("should return true for CANCELED", () => {
    expect(sm.isTerminal(TaskStatus.CANCELED)).toBe(true);
  });

  it("should return false for FAILED (has retry path)", () => {
    // FAILED allows transition to SUBMITTED, so it is NOT terminal per the state graph
    expect(sm.isTerminal(TaskStatus.FAILED)).toBe(false);
  });

  it("should return false for TIMED_OUT (has retry path)", () => {
    // TIMED_OUT allows transition to SUBMITTED, so it is NOT terminal per the state graph
    expect(sm.isTerminal(TaskStatus.TIMED_OUT)).toBe(false);
  });

  it("should return false for non-terminal states", () => {
    expect(sm.isTerminal(TaskStatus.SUBMITTED)).toBe(false);
    expect(sm.isTerminal(TaskStatus.APPROVED)).toBe(false);
    expect(sm.isTerminal(TaskStatus.WORKING)).toBe(false);
    expect(sm.isTerminal(TaskStatus.INPUT_REQUIRED)).toBe(false);
    expect(sm.isTerminal(TaskStatus.REVIEWING)).toBe(false);
    expect(sm.isTerminal(TaskStatus.TEAM_FORMING)).toBe(false);
    expect(sm.isTerminal(TaskStatus.CONSENT_REQUIRED)).toBe(false);
    expect(sm.isTerminal(TaskStatus.PAYMENT_REQUIRED)).toBe(false);
  });
});

// ──────────────────────────────────────────────────────
// validate
// ──────────────────────────────────────────────────────

describe("TaskStateMachine.validate", () => {
  it("should succeed for a valid transition with proper role", () => {
    // requester approves: SUBMITTED -> APPROVED
    const ctx = makeCtx({
      currentStatus: TaskStatus.SUBMITTED,
      targetStatus: TaskStatus.APPROVED,
      actorDid: REQUESTER_DID,
    });
    expect(() => sm.validate(ctx)).not.toThrow();
  });

  it("should succeed when provider transitions to WORKING", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.APPROVED,
      targetStatus: TaskStatus.WORKING,
      actorDid: PROVIDER_DID,
    });
    expect(() => sm.validate(ctx)).not.toThrow();
  });

  it("should throw AZAError for invalid state transition", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.COMPLETED,
      targetStatus: TaskStatus.WORKING,
      actorDid: PROVIDER_DID,
    });
    expect(() => sm.validate(ctx)).toThrow(AZAError);
    try {
      sm.validate(ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(AZAError);
      expect((err as AZAError).code).toBe(AZAErrorCode.TASK_INVALID_TRANSITION);
    }
  });

  it("should throw AZAError when actor does not have permission", () => {
    // provider tries to approve (only requester/system can approve)
    const ctx = makeCtx({
      currentStatus: TaskStatus.SUBMITTED,
      targetStatus: TaskStatus.APPROVED,
      actorDid: PROVIDER_DID,
    });
    expect(() => sm.validate(ctx)).toThrow(AZAError);
    try {
      sm.validate(ctx);
    } catch (err) {
      expect(err).toBeInstanceOf(AZAError);
      expect((err as AZAError).code).toBe(AZAErrorCode.TASK_INVALID_TRANSITION);
      expect((err as AZAError).message).toContain("not authorized");
    }
  });
});

// ──────────────────────────────────────────────────────
// canActorTransition (role-based permissions)
// ──────────────────────────────────────────────────────

describe("TaskStateMachine.canActorTransition", () => {
  it("requester can cancel tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.CANCELED,
      actorDid: REQUESTER_DID,
    });
    expect(sm.canActorTransition(ctx)).toBe(true);
  });

  it("provider can complete tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.COMPLETED,
      actorDid: PROVIDER_DID,
    });
    expect(sm.canActorTransition(ctx)).toBe(true);
  });

  it("unknown DID (system) can timeout tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.TIMED_OUT,
      actorDid: SYSTEM_DID,
    });
    expect(sm.canActorTransition(ctx)).toBe(true);
  });

  it("provider cannot submit tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.FAILED,
      targetStatus: TaskStatus.SUBMITTED,
      actorDid: PROVIDER_DID,
    });
    // SUBMITTED target is only allowed for requester and system
    expect(sm.canActorTransition(ctx)).toBe(false);
  });

  it("requester cannot complete tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.COMPLETED,
      actorDid: REQUESTER_DID,
    });
    // COMPLETED target is only allowed for provider
    expect(sm.canActorTransition(ctx)).toBe(false);
  });

  it("provider can transition to WORKING", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.APPROVED,
      targetStatus: TaskStatus.WORKING,
      actorDid: PROVIDER_DID,
    });
    expect(sm.canActorTransition(ctx)).toBe(true);
  });

  it("system (unknown DID) cannot complete tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.COMPLETED,
      actorDid: SYSTEM_DID,
    });
    // COMPLETED is only allowed for provider
    expect(sm.canActorTransition(ctx)).toBe(false);
  });

  it("requester can approve tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.SUBMITTED,
      targetStatus: TaskStatus.APPROVED,
      actorDid: REQUESTER_DID,
    });
    expect(sm.canActorTransition(ctx)).toBe(true);
  });

  it("provider cannot approve tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.SUBMITTED,
      targetStatus: TaskStatus.APPROVED,
      actorDid: PROVIDER_DID,
    });
    expect(sm.canActorTransition(ctx)).toBe(false);
  });

  it("system can fail tasks", () => {
    const ctx = makeCtx({
      currentStatus: TaskStatus.WORKING,
      targetStatus: TaskStatus.FAILED,
      actorDid: SYSTEM_DID,
    });
    expect(sm.canActorTransition(ctx)).toBe(true);
  });
});
