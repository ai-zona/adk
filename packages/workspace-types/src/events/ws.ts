/**
 * WebSocket events broadcast on /ws/workspace/[id].
 *
 * Stream E (multi-user chat + WebSocket) implements the server side.
 * Stream G (UI) implements the client subscription. Both reference
 * these types as the single source of truth.
 */

import type { EntitlementRef, EntitlementSource } from "../capabilities/identifiers.js";

export type WSEvent =
  | PresenceOnlineEvent
  | PresenceOfflineEvent
  | MessageCreatedEvent
  | MessageEditedEvent
  | AgentStateEvent
  | AgentTypingEvent
  | EntitlementUnlockedEvent
  | SkillExecutedEvent
  | ManifestStepEvent
  | ArchitectTurnEvent
  | ArchitectStreamingEvent
  | ManifestChangedEvent
  | SnapshotCreatedEvent
  | EntitlementUnlockTriggeredEvent
  | TestExecutionEvent
  | VoiceProviderHealthEvent
  | AgentChatEventEvent;

export interface PresenceOnlineEvent {
  type: "presence.online";
  userId: string;
  at: string; // ISO 8601
}

export interface PresenceOfflineEvent {
  type: "presence.offline";
  userId: string;
  at: string;
}

export interface MessageCreatedEvent {
  type: "message.created";
  message: WorkspaceMessageWire;
}

export interface MessageEditedEvent {
  type: "message.edited";
  messageId: string;
  content: ContentPart[];
  editedAt: string;
}

export interface AgentStateEvent {
  type: "agent.state";
  agentId: string;
  state: "IDLE" | "WORKING" | "WAITING" | "ERROR";
  detail?: string;
}

export interface AgentTypingEvent {
  type: "agent.typing";
  agentId: string;
  channelId: string;
}

export interface EntitlementUnlockedEvent {
  type: "entitlement.unlocked";
  ref: EntitlementRef;
  source: EntitlementSource;
  unlockedBy: string;
  at: string;
}

export interface SkillExecutedEvent {
  type: "skill.executed";
  skillRef: string;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

/** Broadcast versions of hydrator step events; full type lives in hydrator.ts */
export type ManifestStepEvent =
  | {
      type: "manifest.step.started";
      jobId: string;
      step: string;
      estimatedMs: number;
      detail?: string;
    }
  | {
      type: "manifest.step.progress";
      jobId: string;
      step: string;
      fraction: number;
      narration?: string;
    }
  | {
      type: "manifest.step.completed";
      jobId: string;
      step: string;
      durationMs: number;
      summary?: string;
    }
  | {
      type: "manifest.step.failed";
      jobId: string;
      step: string;
      reason: string;
      recoverable: boolean;
    };

/**
 * Wire-format of a WorkspaceMessage. The DB-side row uses Prisma-generated
 * types; this is what travels over the WebSocket.
 */
export interface WorkspaceMessageWire {
  id: string;
  channelId: string;
  authorType: "USER" | "AGENT" | "SYSTEM";
  authorId: string;
  content: { parts: ContentPart[] };
  inReplyToId?: string;
  metadata?: WorkspaceMessageMetadata;
  createdAt: string;
  editedAt?: string;
}

export interface WorkspaceMessageMetadata {
  toolCalls?: ToolCallTrace[];
  tokenCounts?: { input: number; output: number };
  latencyMs?: number;
}

export interface ToolCallTrace {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  errorMessage?: string;
  durationMs: number;
}

/**
 * ContentPart — multimodal message content. Mirrors @aizona/adk ContentPart
 * but is duplicated here so this contracts package depends on nothing.
 */
export type ContentPart =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; alt?: string; mimeType?: string }
  | { kind: "audio"; url: string; mimeType?: string; durationSeconds?: number }
  | { kind: "video"; url: string; mimeType?: string; durationSeconds?: number }
  | { kind: "ui-artifact"; artifactId: string; preview?: string };

// ─── Wave 2 events ───────────────────────────────────────────────────────────

/** One turn in the architect conversation (user or assistant). */
export interface ArchitectTurnEvent {
  type: "architect.turn";
  workspaceId: string;
  turnIdx: number;
  role: "user" | "assistant";
  content: string;
  at: string; // ISO 8601
}

/** Streaming token from the architect LLM response. */
export interface ArchitectStreamingEvent {
  type: "architect.streaming";
  workspaceId: string;
  token: string;
  at: string;
}

/** Workspace manifest was mutated and a new snapshot captured. */
export interface ManifestChangedEvent {
  type: "manifest.changed";
  workspaceId: string;
  snapshotId: string;
  changeSummary: string;
  at: string;
}

/** A workspace snapshot was persisted. */
export interface SnapshotCreatedEvent {
  type: "snapshot.created";
  workspaceId: string;
  snapshotId: string;
  snapshotIdx: number;
  triggerType: "RECIPE_APPLY" | "INCREMENTAL" | "REVERT" | "IMPORT" | "DUPLICATE";
  at: string;
}

/** An entitlement unlock flow was initiated (e.g. payment prompt). */
export interface EntitlementUnlockTriggeredEvent {
  type: "entitlement.unlock.triggered";
  workspaceId: string;
  refType: string;
  refId: string;
  suggestedAmount: number;
  at: string;
}

/** Result of an automated test run against an agent, workspace, or tool. */
export interface TestExecutionEvent {
  type: "test.execution";
  scope: "AGENT" | "WORKSPACE" | "TOOL";
  targetId: string;
  result: "PASS" | "FAIL" | "ERROR";
  at: string;
}

/** Health status broadcast for a voice provider (e.g. Whisper, ElevenLabs). */
export interface VoiceProviderHealthEvent {
  type: "voice.provider.health";
  kind: string;
  healthy: boolean;
  at: string;
}

/**
 * Multiplex envelope for per-agent / per-team chat stream events.
 *
 * The browser opens ONE WS connection per workspace (`/ws/workspace/[id]`) and
 * demultiplexes per-tab streams via `streamId`. The inner `event` is the
 * existing `ChatStreamEvent` union exported by `@aizona/platform-agents` —
 * this contract package keeps it as `unknown` so it stays decoupled from the
 * platform-agents internal types (zod-validated upstream by the producer).
 *
 * `streamId` is generated server-side as a fresh UUID per `startStream`
 * mutation; the client never sends it. It scopes events to a single chat tab.
 */
export interface AgentChatEventEvent {
  type: "agent.chat.event";
  /** Server-generated UUID — opaque demux key for the browser. */
  streamId: string;
  /** Inner ChatStreamEvent (text_delta / tool_call_start / run_complete / error / ...). */
  event: unknown;
}
