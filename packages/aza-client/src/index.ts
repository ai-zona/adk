// ──────────────────────────────────────────────────────
// AZA Client SDK v2
// ──────────────────────────────────────────────────────
// High-level SDK for building agents on the AZA protocol.
// Provides the AZAAgent class (connection, task lifecycle,
// message handling), heartbeat management, and re-exports
// commonly used types from @aizona/aza-protocol.
// ──────────────────────────────────────────────────────

/** Client SDK version constant. */
export const AZA_CLIENT_VERSION = "2.0.0";

// Agent SDK
export { AZAAgent } from "./aza-agent";
export type { AZAAgentConfig, TaskRequestHandler, MessageHandler_ } from "./aza-agent";

// Heartbeat sender
export { HeartbeatSender } from "./heartbeat";
export type { HeartbeatConfig } from "./heartbeat";

// Re-export commonly used protocol types for convenience
export type {
  AZAEnvelope,
  AZAMessageType,
  TaskRequestPayload,
  TaskCompletePayload,
  TaskFailPayload,
  TaskProgressPayload,
  TaskCancelPayload,
  TaskAcceptPayload,
  HeartbeatPayload,
  ConsentRequestPayload,
  ConsentResponsePayload,
} from "@aizona/aza-protocol";

// Re-export value-level constants (TaskStatus enum object, AZAMessageType message type constants)
export { TaskStatus } from "@aizona/aza-protocol";
export { AZAMessageType as MessageTypes } from "@aizona/aza-protocol";
