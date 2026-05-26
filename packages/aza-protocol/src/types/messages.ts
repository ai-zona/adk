import { z } from "zod";
import {
  ChannelPublishPayloadSchema,
  ChannelSubscribePayloadSchema,
  ChannelUnsubscribePayloadSchema,
} from "./channel";
import { AZAErrorDetailsSchema } from "./errors";
import {
  MessagePrioritySchema,
  TaskAcceptPayloadSchema,
  TaskCancelPayloadSchema,
  TaskCompletePayloadSchema,
  TaskFailPayloadSchema,
  TaskProgressPayloadSchema,
  TaskRejectPayloadSchema,
  TaskRequestPayloadSchema,
  TaskResponsePayloadSchema,
} from "./task";
import {
  TeamAcceptPayloadSchema,
  TeamDeclinePayloadSchema,
  TeamDissolvePayloadSchema,
  TeamInvitePayloadSchema,
  TeamKickPayloadSchema,
} from "./team";

// ──────────────────────────────────────────────────────
// AZA Message Type Enum
// ──────────────────────────────────────────────────────
// Note: This is more granular than the Prisma AZAMessageType enum.
// The Prisma enum groups related types (e.g., TASK_REQUEST covers
// task.request, task.accept, task.reject, task.cancel, etc.).
// The protocol-level types below are the full set of 33 message types.
// ──────────────────────────────────────────────────────

export const AZAMessageType = {
  // Task messages
  TASK_REQUEST: "task.request",
  TASK_RESPONSE: "task.response",
  TASK_ACCEPT: "task.accept",
  TASK_REJECT: "task.reject",
  TASK_CANCEL: "task.cancel",
  TASK_PROGRESS: "task.progress",
  TASK_COMPLETE: "task.complete",
  TASK_FAIL: "task.fail",

  // Consent messages
  CONSENT_REQUEST: "consent.request",
  CONSENT_RESPONSE: "consent.response",

  // Payment messages
  PAYMENT_REQUEST: "payment.request",
  PAYMENT_CONFIRM: "payment.confirm",

  // Status messages
  STATUS_UPDATE: "status.update",
  SYSTEM_HEARTBEAT: "system.heartbeat",

  // Team messages
  TEAM_INVITE: "team.invite",
  TEAM_ACCEPT: "team.accept",
  TEAM_DECLINE: "team.decline",
  TEAM_KICK: "team.kick",
  TEAM_DISSOLVE: "team.dissolve",

  // Channel messages
  CHANNEL_PUBLISH: "channel.publish",
  CHANNEL_SUBSCRIBE: "channel.subscribe",
  CHANNEL_UNSUBSCRIBE: "channel.unsubscribe",

  // Negotiation messages
  NEGOTIATION_PROPOSE: "negotiation.propose",
  NEGOTIATION_COUNTER: "negotiation.counter",
  NEGOTIATION_ACCEPT: "negotiation.accept",
  NEGOTIATION_REJECT: "negotiation.reject",

  // Error
  ERROR: "error",

  // Broadcast
  BROADCAST: "broadcast",

  // Discovery messages
  DISCOVERY_QUERY: "discovery.query",
  DISCOVERY_RESPONSE: "discovery.response",

  // Capability messages
  CAPABILITY_ADVERTISE: "capability.advertise",

  // Artifact messages
  ARTIFACT_PUSH: "artifact.push",
  ARTIFACT_PULL: "artifact.pull",
} as const;

export type AZAMessageType = (typeof AZAMessageType)[keyof typeof AZAMessageType];

export const AZAMessageTypeSchema = z.enum([
  AZAMessageType.TASK_REQUEST,
  AZAMessageType.TASK_RESPONSE,
  AZAMessageType.TASK_ACCEPT,
  AZAMessageType.TASK_REJECT,
  AZAMessageType.TASK_CANCEL,
  AZAMessageType.TASK_PROGRESS,
  AZAMessageType.TASK_COMPLETE,
  AZAMessageType.TASK_FAIL,
  AZAMessageType.CONSENT_REQUEST,
  AZAMessageType.CONSENT_RESPONSE,
  AZAMessageType.PAYMENT_REQUEST,
  AZAMessageType.PAYMENT_CONFIRM,
  AZAMessageType.STATUS_UPDATE,
  AZAMessageType.SYSTEM_HEARTBEAT,
  AZAMessageType.TEAM_INVITE,
  AZAMessageType.TEAM_ACCEPT,
  AZAMessageType.TEAM_DECLINE,
  AZAMessageType.TEAM_KICK,
  AZAMessageType.TEAM_DISSOLVE,
  AZAMessageType.CHANNEL_PUBLISH,
  AZAMessageType.CHANNEL_SUBSCRIBE,
  AZAMessageType.CHANNEL_UNSUBSCRIBE,
  AZAMessageType.NEGOTIATION_PROPOSE,
  AZAMessageType.NEGOTIATION_COUNTER,
  AZAMessageType.NEGOTIATION_ACCEPT,
  AZAMessageType.NEGOTIATION_REJECT,
  AZAMessageType.ERROR,
  AZAMessageType.BROADCAST,
  AZAMessageType.DISCOVERY_QUERY,
  AZAMessageType.DISCOVERY_RESPONSE,
  AZAMessageType.CAPABILITY_ADVERTISE,
  AZAMessageType.ARTIFACT_PUSH,
  AZAMessageType.ARTIFACT_PULL,
]);

// ──────────────────────────────────────────────────────
// Consent Payloads
// ──────────────────────────────────────────────────────

export const ConsentRequestPayloadSchema = z.object({
  taskId: z.string().uuid(),
  action: z.string(), // Human-readable description of what is being requested
  scope: z.string(), // "task", "payment", "data_access", "external_api"
  resources: z.array(z.string()).optional(), // Resources that will be accessed
  estimatedCost: z.string().optional(), // Cost estimate if applicable
  expiresAt: z.number().optional(), // Unix timestamp ms - when consent expires
  requesterDid: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type ConsentRequestPayload = z.infer<typeof ConsentRequestPayloadSchema>;

export const ConsentResponsePayloadSchema = z.object({
  taskId: z.string().uuid(),
  approved: z.boolean(),
  conditions: z.array(z.string()).optional(), // Conditions placed on approval
  reason: z.string().max(2000).optional(),
  expiresAt: z.number().optional(), // When the consent expires
  approvedBy: z.string(), // DID of the approving entity
});

export type ConsentResponsePayload = z.infer<typeof ConsentResponsePayloadSchema>;

// ──────────────────────────────────────────────────────
// Payment Payloads
// ──────────────────────────────────────────────────────

export const PaymentRequestPayloadSchema = z.object({
  taskId: z.string().uuid(),
  amount: z.string(),
  currency: z.string(),
  recipientDid: z.string(),
  recipientAddress: z.string().optional(), // On-chain address
  escrowRequired: z.boolean().default(true),
  memo: z.string().max(500).optional(),
  deadline: z.number().optional(), // Unix timestamp ms
});

export type PaymentRequestPayload = z.infer<typeof PaymentRequestPayloadSchema>;

export const PaymentConfirmPayloadSchema = z.object({
  taskId: z.string().uuid(),
  transactionId: z.string(), // On-chain transaction hash
  amount: z.string(),
  currency: z.string(),
  escrowId: z.string().optional(),
  escrowAddress: z.string().optional(),
  confirmedAt: z.number(), // Unix timestamp ms
  status: z.enum(["escrowed", "released", "refunded"]),
});

export type PaymentConfirmPayload = z.infer<typeof PaymentConfirmPayloadSchema>;

// ──────────────────────────────────────────────────────
// Status / Heartbeat Payloads
// ──────────────────────────────────────────────────────

export const StatusUpdatePayloadSchema = z.object({
  agentDid: z.string(),
  status: z.enum(["online", "offline", "busy", "idle", "maintenance"]),
  capabilities: z.array(z.string()).optional(),
  load: z.number().min(0).max(1).optional(), // 0.0 - 1.0 load factor
  message: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type StatusUpdatePayload = z.infer<typeof StatusUpdatePayloadSchema>;

export const HeartbeatPayloadSchema = z.object({
  agentDid: z.string(),
  uptime: z.number().int().nonnegative(), // Seconds
  version: z.string(),
  capabilities: z.array(z.string()).optional(),
  load: z.number().min(0).max(1).optional(),
  activeTaskCount: z.number().int().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type HeartbeatPayload = z.infer<typeof HeartbeatPayloadSchema>;

// ──────────────────────────────────────────────────────
// Negotiation Payloads
// ──────────────────────────────────────────────────────

export const NegotiationTermsSchema = z.object({
  price: z.string().optional(),
  currency: z.string().optional(),
  deadline: z.number().optional(), // Unix timestamp ms
  quality: z.string().optional(), // e.g., "standard", "premium"
  scope: z.string().optional(),
  custom: z.record(z.unknown()).optional(),
});

export type NegotiationTerms = z.infer<typeof NegotiationTermsSchema>;

export const NegotiationProposePayloadSchema = z.object({
  negotiationId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  skill: z.string(),
  terms: NegotiationTermsSchema,
  maxRounds: z.number().int().positive().default(5),
  expiresAt: z.number(), // Unix timestamp ms
});

export type NegotiationProposePayload = z.infer<typeof NegotiationProposePayloadSchema>;

export const NegotiationCounterPayloadSchema = z.object({
  negotiationId: z.string().uuid(),
  counterTerms: NegotiationTermsSchema,
  round: z.number().int().positive(),
  message: z.string().max(2000).optional(),
});

export type NegotiationCounterPayload = z.infer<typeof NegotiationCounterPayloadSchema>;

export const NegotiationAcceptPayloadSchema = z.object({
  negotiationId: z.string().uuid(),
  agreedTerms: NegotiationTermsSchema,
  message: z.string().max(2000).optional(),
});

export type NegotiationAcceptPayload = z.infer<typeof NegotiationAcceptPayloadSchema>;

export const NegotiationRejectPayloadSchema = z.object({
  negotiationId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

export type NegotiationRejectPayload = z.infer<typeof NegotiationRejectPayloadSchema>;

// ──────────────────────────────────────────────────────
// Broadcast Payload
// ──────────────────────────────────────────────────────

export const BroadcastPayloadSchema = z.object({
  topic: z.string(),
  content: z.unknown(),
  scope: z.enum(["community", "global", "team"]).default("community"),
  communityId: z.string().optional(),
  teamId: z.string().uuid().optional(),
  tags: z.array(z.string()).optional(),
});

export type BroadcastPayload = z.infer<typeof BroadcastPayloadSchema>;

// ──────────────────────────────────────────────────────
// Discovery Payloads
// ──────────────────────────────────────────────────────

export const DiscoveryQueryPayloadSchema = z.object({
  skill: z.string().optional(),
  tags: z.array(z.string()).optional(),
  minTrustScore: z.number().min(0).max(1).optional(),
  maxPrice: z.string().optional(),
  currency: z.string().optional(),
  maxResults: z.number().int().positive().default(10),
  metadata: z.record(z.unknown()).optional(),
});

export type DiscoveryQueryPayload = z.infer<typeof DiscoveryQueryPayloadSchema>;

export const DiscoveryResultSchema = z.object({
  agentDid: z.string(),
  name: z.string(),
  capabilities: z.array(z.string()),
  trustScore: z.number().min(0).max(1).optional(),
  pricing: z
    .object({
      amount: z.string(),
      currency: z.string(),
      per: z.string().optional(), // "task", "hour", "token"
    })
    .optional(),
  availability: z.enum(["available", "busy", "offline"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;

export const DiscoveryResponsePayloadSchema = z.object({
  queryId: z.string(), // Correlation to original query
  results: z.array(DiscoveryResultSchema),
  totalCount: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type DiscoveryResponsePayload = z.infer<typeof DiscoveryResponsePayloadSchema>;

// ──────────────────────────────────────────────────────
// Capability Advertise Payload
// ──────────────────────────────────────────────────────

export const CapabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().max(2000).optional(),
  inputSchema: z.record(z.unknown()).optional(), // JSON Schema
  outputSchema: z.record(z.unknown()).optional(), // JSON Schema
  pricing: z
    .object({
      amount: z.string(),
      currency: z.string(),
      per: z.string().optional(),
    })
    .optional(),
  tags: z.array(z.string()).optional(),
  version: z.string().optional(),
});

export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilityAdvertisePayloadSchema = z.object({
  agentDid: z.string(),
  capabilities: z.array(CapabilitySchema).min(1),
  endpoints: z
    .array(
      z.object({
        url: z.string().url(),
        transport: z.enum(["http", "ws", "grpc"]),
        authentication: z.enum(["none", "did-auth", "api-key", "oauth"]).optional(),
      }),
    )
    .optional(),
  ttl: z.number().int().positive().optional(), // How long this advertisement is valid (seconds)
});

export type CapabilityAdvertisePayload = z.infer<typeof CapabilityAdvertisePayloadSchema>;

// ──────────────────────────────────────────────────────
// Artifact Payloads
// ──────────────────────────────────────────────────────

export const ArtifactPushPayloadSchema = z.object({
  taskId: z.string().uuid(),
  artifactId: z.string(),
  artifactType: z.enum(["result", "log", "report", "media", "data"]),
  mimeType: z.string(),
  data: z.unknown(),
  size: z.number().int().nonnegative().optional(),
  checksum: z.string().optional(), // SHA-256
  metadata: z.record(z.unknown()).optional(),
});

export type ArtifactPushPayload = z.infer<typeof ArtifactPushPayloadSchema>;

export const ArtifactPullPayloadSchema = z.object({
  taskId: z.string().uuid(),
  artifactId: z.string().optional(), // Specific artifact or all
  artifactType: z.enum(["result", "log", "report", "media", "data"]).optional(),
});

export type ArtifactPullPayload = z.infer<typeof ArtifactPullPayloadSchema>;

// ──────────────────────────────────────────────────────
// Error Payload (wrapping AZAErrorDetails)
// ──────────────────────────────────────────────────────

export const ErrorPayloadSchema = AZAErrorDetailsSchema;

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

// ──────────────────────────────────────────────────────
// Typed Message (discriminated union)
// ──────────────────────────────────────────────────────

const TypedTaskRequest = z.object({
  type: z.literal(AZAMessageType.TASK_REQUEST),
  payload: TaskRequestPayloadSchema,
});
const TypedTaskResponse = z.object({
  type: z.literal(AZAMessageType.TASK_RESPONSE),
  payload: TaskResponsePayloadSchema,
});
const TypedTaskAccept = z.object({
  type: z.literal(AZAMessageType.TASK_ACCEPT),
  payload: TaskAcceptPayloadSchema,
});
const TypedTaskReject = z.object({
  type: z.literal(AZAMessageType.TASK_REJECT),
  payload: TaskRejectPayloadSchema,
});
const TypedTaskCancel = z.object({
  type: z.literal(AZAMessageType.TASK_CANCEL),
  payload: TaskCancelPayloadSchema,
});
const TypedTaskProgress = z.object({
  type: z.literal(AZAMessageType.TASK_PROGRESS),
  payload: TaskProgressPayloadSchema,
});
const TypedTaskComplete = z.object({
  type: z.literal(AZAMessageType.TASK_COMPLETE),
  payload: TaskCompletePayloadSchema,
});
const TypedTaskFail = z.object({
  type: z.literal(AZAMessageType.TASK_FAIL),
  payload: TaskFailPayloadSchema,
});
const TypedConsentRequest = z.object({
  type: z.literal(AZAMessageType.CONSENT_REQUEST),
  payload: ConsentRequestPayloadSchema,
});
const TypedConsentResponse = z.object({
  type: z.literal(AZAMessageType.CONSENT_RESPONSE),
  payload: ConsentResponsePayloadSchema,
});
const TypedPaymentRequest = z.object({
  type: z.literal(AZAMessageType.PAYMENT_REQUEST),
  payload: PaymentRequestPayloadSchema,
});
const TypedPaymentConfirm = z.object({
  type: z.literal(AZAMessageType.PAYMENT_CONFIRM),
  payload: PaymentConfirmPayloadSchema,
});
const TypedStatusUpdate = z.object({
  type: z.literal(AZAMessageType.STATUS_UPDATE),
  payload: StatusUpdatePayloadSchema,
});
const TypedHeartbeat = z.object({
  type: z.literal(AZAMessageType.SYSTEM_HEARTBEAT),
  payload: HeartbeatPayloadSchema,
});
const TypedTeamInvite = z.object({
  type: z.literal(AZAMessageType.TEAM_INVITE),
  payload: TeamInvitePayloadSchema,
});
const TypedTeamAccept = z.object({
  type: z.literal(AZAMessageType.TEAM_ACCEPT),
  payload: TeamAcceptPayloadSchema,
});
const TypedTeamDecline = z.object({
  type: z.literal(AZAMessageType.TEAM_DECLINE),
  payload: TeamDeclinePayloadSchema,
});
const TypedTeamKick = z.object({
  type: z.literal(AZAMessageType.TEAM_KICK),
  payload: TeamKickPayloadSchema,
});
const TypedTeamDissolve = z.object({
  type: z.literal(AZAMessageType.TEAM_DISSOLVE),
  payload: TeamDissolvePayloadSchema,
});
const TypedChannelPublish = z.object({
  type: z.literal(AZAMessageType.CHANNEL_PUBLISH),
  payload: ChannelPublishPayloadSchema,
});
const TypedChannelSubscribe = z.object({
  type: z.literal(AZAMessageType.CHANNEL_SUBSCRIBE),
  payload: ChannelSubscribePayloadSchema,
});
const TypedChannelUnsubscribe = z.object({
  type: z.literal(AZAMessageType.CHANNEL_UNSUBSCRIBE),
  payload: ChannelUnsubscribePayloadSchema,
});
const TypedNegotiationPropose = z.object({
  type: z.literal(AZAMessageType.NEGOTIATION_PROPOSE),
  payload: NegotiationProposePayloadSchema,
});
const TypedNegotiationCounter = z.object({
  type: z.literal(AZAMessageType.NEGOTIATION_COUNTER),
  payload: NegotiationCounterPayloadSchema,
});
const TypedNegotiationAccept = z.object({
  type: z.literal(AZAMessageType.NEGOTIATION_ACCEPT),
  payload: NegotiationAcceptPayloadSchema,
});
const TypedNegotiationReject = z.object({
  type: z.literal(AZAMessageType.NEGOTIATION_REJECT),
  payload: NegotiationRejectPayloadSchema,
});
const TypedError = z.object({ type: z.literal(AZAMessageType.ERROR), payload: ErrorPayloadSchema });
const TypedBroadcast = z.object({
  type: z.literal(AZAMessageType.BROADCAST),
  payload: BroadcastPayloadSchema,
});
const TypedDiscoveryQuery = z.object({
  type: z.literal(AZAMessageType.DISCOVERY_QUERY),
  payload: DiscoveryQueryPayloadSchema,
});
const TypedDiscoveryResponse = z.object({
  type: z.literal(AZAMessageType.DISCOVERY_RESPONSE),
  payload: DiscoveryResponsePayloadSchema,
});
const TypedCapabilityAdvertise = z.object({
  type: z.literal(AZAMessageType.CAPABILITY_ADVERTISE),
  payload: CapabilityAdvertisePayloadSchema,
});
const TypedArtifactPush = z.object({
  type: z.literal(AZAMessageType.ARTIFACT_PUSH),
  payload: ArtifactPushPayloadSchema,
});
const TypedArtifactPull = z.object({
  type: z.literal(AZAMessageType.ARTIFACT_PULL),
  payload: ArtifactPullPayloadSchema,
});

/**
 * Discriminated union of all typed message bodies (type + payload).
 * Used as part of the envelope to ensure the payload matches the message type.
 */
export const TypedMessageSchema = z.discriminatedUnion("type", [
  TypedTaskRequest,
  TypedTaskResponse,
  TypedTaskAccept,
  TypedTaskReject,
  TypedTaskCancel,
  TypedTaskProgress,
  TypedTaskComplete,
  TypedTaskFail,
  TypedConsentRequest,
  TypedConsentResponse,
  TypedPaymentRequest,
  TypedPaymentConfirm,
  TypedStatusUpdate,
  TypedHeartbeat,
  TypedTeamInvite,
  TypedTeamAccept,
  TypedTeamDecline,
  TypedTeamKick,
  TypedTeamDissolve,
  TypedChannelPublish,
  TypedChannelSubscribe,
  TypedChannelUnsubscribe,
  TypedNegotiationPropose,
  TypedNegotiationCounter,
  TypedNegotiationAccept,
  TypedNegotiationReject,
  TypedError,
  TypedBroadcast,
  TypedDiscoveryQuery,
  TypedDiscoveryResponse,
  TypedCapabilityAdvertise,
  TypedArtifactPush,
  TypedArtifactPull,
]);

export type TypedMessage = z.infer<typeof TypedMessageSchema>;

// ──────────────────────────────────────────────────────
// Envelope Metadata
// ──────────────────────────────────────────────────────

export const EnvelopeMetadataSchema = z.object({
  /** Community context (community slug) for routing. */
  community: z.string().optional(),
  /** Team context (team ID) for routing. */
  team: z.string().optional(),
  /** Channel context (channel ID) for routing. */
  channel: z.string().optional(),
  /** Protocol version for forward compatibility. */
  protocolVersion: z.string().default("2.0.0"),
  /** Trace ID for distributed tracing. */
  traceId: z.string().optional(),
  /** Additional extensible metadata. */
  custom: z.record(z.unknown()).optional(),
});

export type EnvelopeMetadata = z.infer<typeof EnvelopeMetadataSchema>;

// ──────────────────────────────────────────────────────
// AZA Envelope (the outermost message wrapper)
// ──────────────────────────────────────────────────────

/**
 * The AZA Envelope is the standard message format for all protocol communication.
 * Every message exchanged between agents is wrapped in an envelope that provides
 * routing, security, and correlation information.
 */
export const AZAEnvelopeSchema = z
  .object({
    /** Unique message identifier (UUID v4). */
    id: z.string().uuid(),

    /** Sender DID (did:aza:network:identifier). */
    from: z.string(),

    /** Recipient DID (null for broadcasts). */
    to: z.string().nullable(),

    /** Correlation ID to group related messages in a conversation. */
    correlationId: z.string().uuid(),

    /** Ed25519 signature over the canonical payload (JWS format). */
    signature: z.string().optional(),

    /** Unix timestamp in milliseconds when the message was created. */
    timestamp: z.number().int().positive(),

    /** Message priority for routing and processing. */
    priority: MessagePrioritySchema.default("NORMAL"),

    /** Optional expiration time (Unix timestamp ms). */
    expiresAt: z.number().int().positive().optional(),

    /** Envelope metadata for routing and tracing. */
    metadata: EnvelopeMetadataSchema.optional(),
  })
  .and(TypedMessageSchema);

export type AZAEnvelope = z.infer<typeof AZAEnvelopeSchema>;

// ──────────────────────────────────────────────────────
// Mapping: Protocol message types -> Prisma AZAMessageType
// ──────────────────────────────────────────────────────
// The Prisma enum is coarser; this map helps when persisting messages.

export const PROTOCOL_TO_PRISMA_MESSAGE_TYPE: Record<AZAMessageType, string> = {
  [AZAMessageType.TASK_REQUEST]: "TASK_REQUEST",
  [AZAMessageType.TASK_RESPONSE]: "TASK_RESPONSE",
  [AZAMessageType.TASK_ACCEPT]: "TASK_REQUEST",
  [AZAMessageType.TASK_REJECT]: "TASK_REQUEST",
  [AZAMessageType.TASK_CANCEL]: "TASK_REQUEST",
  [AZAMessageType.TASK_PROGRESS]: "STATUS_UPDATE",
  [AZAMessageType.TASK_COMPLETE]: "TASK_RESPONSE",
  [AZAMessageType.TASK_FAIL]: "TASK_RESPONSE",
  [AZAMessageType.CONSENT_REQUEST]: "CONSENT_REQUEST",
  [AZAMessageType.CONSENT_RESPONSE]: "CONSENT_RESPONSE",
  [AZAMessageType.PAYMENT_REQUEST]: "PAYMENT_REQUEST",
  [AZAMessageType.PAYMENT_CONFIRM]: "PAYMENT_CONFIRMATION",
  [AZAMessageType.STATUS_UPDATE]: "STATUS_UPDATE",
  [AZAMessageType.SYSTEM_HEARTBEAT]: "HEARTBEAT",
  [AZAMessageType.TEAM_INVITE]: "TEAM_INVITE",
  [AZAMessageType.TEAM_ACCEPT]: "TEAM_ACCEPT",
  [AZAMessageType.TEAM_DECLINE]: "TEAM_DECLINE",
  [AZAMessageType.TEAM_KICK]: "TEAM_INVITE",
  [AZAMessageType.TEAM_DISSOLVE]: "TEAM_DECLINE",
  [AZAMessageType.CHANNEL_PUBLISH]: "BROADCAST",
  [AZAMessageType.CHANNEL_SUBSCRIBE]: "STATUS_UPDATE",
  [AZAMessageType.CHANNEL_UNSUBSCRIBE]: "STATUS_UPDATE",
  [AZAMessageType.NEGOTIATION_PROPOSE]: "NEGOTIATION",
  [AZAMessageType.NEGOTIATION_COUNTER]: "NEGOTIATION",
  [AZAMessageType.NEGOTIATION_ACCEPT]: "NEGOTIATION",
  [AZAMessageType.NEGOTIATION_REJECT]: "NEGOTIATION",
  [AZAMessageType.ERROR]: "ERROR",
  [AZAMessageType.BROADCAST]: "BROADCAST",
  [AZAMessageType.DISCOVERY_QUERY]: "STATUS_UPDATE",
  [AZAMessageType.DISCOVERY_RESPONSE]: "STATUS_UPDATE",
  [AZAMessageType.CAPABILITY_ADVERTISE]: "STATUS_UPDATE",
  [AZAMessageType.ARTIFACT_PUSH]: "TASK_RESPONSE",
  [AZAMessageType.ARTIFACT_PULL]: "TASK_REQUEST",
};
