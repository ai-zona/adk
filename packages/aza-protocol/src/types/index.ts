// ──────────────────────────────────────────────────────
// AZA Protocol Type Definitions
// ──────────────────────────────────────────────────────

// Task types and state machine
export {
  TaskStatus,
  TaskStatusSchema,
  TaskTopology,
  TaskTopologySchema,
  MessagePriority,
  MessagePrioritySchema,
  TASK_TRANSITIONS,
  TASK_STATE_TIMEOUTS,
  isValidTransition,
  isTerminalStatus,
  PaymentInfoSchema,
  TaskArtifactSchema,
  TaskRequestPayloadSchema,
  TaskResponsePayloadSchema,
  TaskProgressPayloadSchema,
  TaskCompletePayloadSchema,
  TaskFailPayloadSchema,
  TaskCancelPayloadSchema,
  TaskAcceptPayloadSchema,
  TaskRejectPayloadSchema,
} from "./task";

export type {
  TaskRequestPayload,
  TaskResponsePayload,
  TaskProgressPayload,
  TaskCompletePayload,
  TaskFailPayload,
  TaskCancelPayload,
  TaskAcceptPayload,
  TaskRejectPayload,
  PaymentInfo,
  TaskArtifact,
} from "./task";

// Team types
export {
  TeamMemberRole,
  TeamMemberRoleSchema,
  TeamStatus,
  TeamStatusSchema,
  ConsensusType,
  ConsensusTypeSchema,
  TeamMemberStatus,
  TeamMemberStatusSchema,
  TEAM_TRANSITIONS,
  isValidTeamTransition,
  TeamBudgetSchema,
  TeamMemberSchema,
  TeamConfigSchema,
  SharedContextSchema,
  TeamInvitePayloadSchema,
  TeamAcceptPayloadSchema,
  TeamDeclinePayloadSchema,
  TeamKickPayloadSchema,
  TeamDissolvePayloadSchema,
} from "./team";

export type {
  TeamBudget,
  TeamMember,
  TeamConfig,
  SharedContext,
  TeamInvitePayload,
  TeamAcceptPayload,
  TeamDeclinePayload,
  TeamKickPayload,
  TeamDissolvePayload,
} from "./team";

// Channel types
export {
  ChannelType,
  ChannelTypeSchema,
  SubscriptionFilterSchema,
  ChannelConfigSchema,
  SubscriptionSchema,
  ChannelPublishPayloadSchema,
  ChannelSubscribePayloadSchema,
  ChannelUnsubscribePayloadSchema,
} from "./channel";

export type {
  SubscriptionFilter,
  ChannelConfig,
  Subscription,
  ChannelPublishPayload,
  ChannelSubscribePayload,
  ChannelUnsubscribePayload,
} from "./channel";

// Error types
export {
  AZAErrorCode,
  AZAErrorCodeSchema,
  AZAErrorDetailsSchema,
  AZAError,
} from "./errors";

export type { AZAErrorDetails } from "./errors";

// Message types and envelope
export {
  AZAMessageType,
  AZAMessageTypeSchema,
  ConsentRequestPayloadSchema,
  ConsentResponsePayloadSchema,
  PaymentRequestPayloadSchema,
  PaymentConfirmPayloadSchema,
  StatusUpdatePayloadSchema,
  HeartbeatPayloadSchema,
  NegotiationTermsSchema,
  NegotiationProposePayloadSchema,
  NegotiationCounterPayloadSchema,
  NegotiationAcceptPayloadSchema,
  NegotiationRejectPayloadSchema,
  BroadcastPayloadSchema,
  DiscoveryQueryPayloadSchema,
  DiscoveryResultSchema,
  DiscoveryResponsePayloadSchema,
  CapabilitySchema,
  CapabilityAdvertisePayloadSchema,
  ArtifactPushPayloadSchema,
  ArtifactPullPayloadSchema,
  ErrorPayloadSchema,
  TypedMessageSchema,
  EnvelopeMetadataSchema,
  AZAEnvelopeSchema,
  PROTOCOL_TO_PRISMA_MESSAGE_TYPE,
} from "./messages";

export type {
  ConsentRequestPayload,
  ConsentResponsePayload,
  PaymentRequestPayload,
  PaymentConfirmPayload,
  StatusUpdatePayload,
  HeartbeatPayload,
  NegotiationTerms,
  NegotiationProposePayload,
  NegotiationCounterPayload,
  NegotiationAcceptPayload,
  NegotiationRejectPayload,
  BroadcastPayload,
  DiscoveryQueryPayload,
  DiscoveryResult,
  DiscoveryResponsePayload,
  Capability,
  CapabilityAdvertisePayload,
  ArtifactPushPayload,
  ArtifactPullPayload,
  ErrorPayload,
  TypedMessage,
  EnvelopeMetadata,
  AZAEnvelope,
} from "./messages";
