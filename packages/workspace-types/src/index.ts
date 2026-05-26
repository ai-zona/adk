// @aizonaai/contracts-workspace-architect — Day-0 contracts substrate.
//
// Single source of truth for types, Zod schemas, RPC signatures, and
// IPC protocol consumed by the 9 Workspace Architect implementation
// streams. Pure types/schemas — zero runtime deps on the rest of the
// monorepo.
//
// Streams import the deep paths declared in package.json `exports`.

export const CONTRACTS_VERSION = "0.2.0" as const;

// Manifest
export type {
  WorkspaceManifest,
  ManifestMetadata,
  ManifestSpec,
  ManifestAgent,
  ManifestTeam,
  ManifestSkill,
  ManifestTool,
  ManifestDataApi,
  ManifestKnowledge,
  ManifestSop,
  ManifestSopStep,
  ManifestChannel,
  ManifestSecret,
  ManifestSandbox,
  ManifestEntitlements,
  ManifestLoadingSequence,
  ManifestLoadingStep,
} from "./manifest/types.js";
export { workspaceManifestSchema } from "./manifest/zod.js";

// Events
export type {
  WSEvent,
  PresenceOnlineEvent,
  PresenceOfflineEvent,
  MessageCreatedEvent,
  MessageEditedEvent,
  AgentStateEvent,
  AgentTypingEvent,
  EntitlementUnlockedEvent,
  SkillExecutedEvent,
  ManifestStepEvent,
  WorkspaceMessageWire,
  WorkspaceMessageMetadata,
  ToolCallTrace,
  ContentPart,
} from "./events/ws.js";
export type {
  HydratorStep,
  HydratorEvent,
  HydratorStepStartedEvent,
  HydratorStepProgressEvent,
  HydratorStepCompletedEvent,
  HydratorStepFailedEvent,
} from "./events/hydrator.js";
export { HYDRATOR_STEP_BUDGETS_MS } from "./events/hydrator.js";
export { wsEventSchema } from "./events/zod.js";

// Capabilities
export {
  CAPABILITY_IDS,
  ENTITLEMENT_TYPES,
  ENTITLEMENT_SOURCES,
  ref,
} from "./capabilities/identifiers.js";
export type {
  EntitlementType,
  EntitlementSource,
  EntitlementRef,
  UnlockOption,
  SkillKind,
  ReviewItemKind,
} from "./capabilities/identifiers.js";

// Test runner
export type { TestFixture } from "./test-runner/types.js";
export { testFixtureSchema } from "./test-runner/types.js";

// Marketplace
export type { PricingMode } from "./marketplace/promote.js";
export { pricingSchema } from "./marketplace/promote.js";

// IPC
export type {
  IpcMessage,
  IpcExecuteMessage,
  IpcResultMessage,
  IpcHostFnCallMessage,
  IpcHostFnResultMessage,
  IpcPingMessage,
  IpcPongMessage,
  IpcErrorKind,
} from "./ipc/protocol.js";
export { ipcMessageSchema } from "./ipc/protocol.js";

// RPC procedures
export { workspaceArchitectProcedures } from "./rpc/workspace-architect.js";
export { workspaceChannelProcedures } from "./rpc/workspace-channel.js";
export { workspaceEntitlementProcedures } from "./rpc/workspace-entitlement.js";
