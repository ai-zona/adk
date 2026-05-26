/**
 * Hydrator step events — the canonical step graph the hydrator walks.
 *
 * Each step emits .started, optionally .progress (one or more), then
 * either .completed or .failed. The WS broadcast variants in events/ws.ts
 * are a strict subset of these, so the WS handler can serialize directly.
 */

export type HydratorStep =
  | "VALIDATING"
  | "ENTITLEMENT_CHECK"
  | "SANDBOX_PROVISIONING"
  | "SECRET_PROVISIONING"
  | "AGENT_PROVISIONING"
  | "SKILL_RESOLUTION"
  | "KNOWLEDGE_INDEXING"
  | "TEAM_ASSEMBLY"
  | "SOP_INSTALLATION"
  | "CHANNEL_CREATION"
  | "DATA_API_BINDING"
  | "COMMIT";

export interface HydratorStepStartedEvent {
  type: "manifest.step.started";
  jobId: string;
  step: HydratorStep;
  estimatedMs: number;
  detail?: string;
}

export interface HydratorStepProgressEvent {
  type: "manifest.step.progress";
  jobId: string;
  step: HydratorStep;
  fraction: number; // 0..1
  narration?: string;
}

export interface HydratorStepCompletedEvent {
  type: "manifest.step.completed";
  jobId: string;
  step: HydratorStep;
  durationMs: number;
  summary?: string;
}

export interface HydratorStepFailedEvent {
  type: "manifest.step.failed";
  jobId: string;
  step: HydratorStep;
  reason: string;
  recoverable: boolean;
}

export type HydratorEvent =
  | HydratorStepStartedEvent
  | HydratorStepProgressEvent
  | HydratorStepCompletedEvent
  | HydratorStepFailedEvent;

/** Total wall-clock budget per step (used for the loading-screen UX). */
export const HYDRATOR_STEP_BUDGETS_MS: Record<HydratorStep, number> = {
  VALIDATING: 800,
  ENTITLEMENT_CHECK: 400,
  SANDBOX_PROVISIONING: 2000,
  SECRET_PROVISIONING: 600,
  AGENT_PROVISIONING: 3000,
  SKILL_RESOLUTION: 4000,
  KNOWLEDGE_INDEXING: 6000,
  TEAM_ASSEMBLY: 1500,
  SOP_INSTALLATION: 1500,
  CHANNEL_CREATION: 600,
  DATA_API_BINDING: 1000,
  COMMIT: 500,
};
