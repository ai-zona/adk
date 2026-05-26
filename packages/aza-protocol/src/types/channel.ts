import { z } from "zod";

// ──────────────────────────────────────────────────────
// Channel Type (aligned with Prisma AZAChannelType)
// ──────────────────────────────────────────────────────

export const ChannelType = {
  ANNOUNCEMENTS: "ANNOUNCEMENTS",
  MISSIONS: "MISSIONS",
  MARKETPLACE: "MARKETPLACE",
  GENERAL: "GENERAL",
  CUSTOM: "CUSTOM",
} as const;

export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];

export const ChannelTypeSchema = z.enum([
  ChannelType.ANNOUNCEMENTS,
  ChannelType.MISSIONS,
  ChannelType.MARKETPLACE,
  ChannelType.GENERAL,
  ChannelType.CUSTOM,
]);

// ──────────────────────────────────────────────────────
// Subscription Filter
// ──────────────────────────────────────────────────────

/**
 * Filters that a subscriber can apply to only receive certain messages.
 */
export const SubscriptionFilterSchema = z.object({
  /** Only receive messages of these types. Empty/undefined = all types. */
  messageTypes: z.array(z.string()).optional(),
  /** Minimum priority level to receive. */
  minPriority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  /** Only receive messages from these DIDs. */
  fromDids: z.array(z.string()).optional(),
  /** Only receive messages matching these tags. */
  tags: z.array(z.string()).optional(),
  /** Only receive messages matching these capabilities. */
  capabilities: z.array(z.string()).optional(),
  /** Custom key-value filters (extensible). */
  custom: z.record(z.unknown()).optional(),
});

export type SubscriptionFilter = z.infer<typeof SubscriptionFilterSchema>;

// ──────────────────────────────────────────────────────
// Channel Configuration
// ──────────────────────────────────────────────────────

export const ChannelConfigSchema = z.object({
  id: z.string().uuid(),
  communityId: z.string().optional(),
  name: z.string().min(1).max(200),
  channelType: ChannelTypeSchema.default("GENERAL"),
  description: z.string().max(2000).optional(),
  archived: z.boolean().default(false),
  createdAt: z.number(), // Unix timestamp ms
  updatedAt: z.number(),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

// ──────────────────────────────────────────────────────
// Subscription
// ──────────────────────────────────────────────────────

export const SubscriptionSchema = z.object({
  id: z.string(),
  channelId: z.string().uuid(),
  agentDid: z.string(),
  filters: SubscriptionFilterSchema.default({}),
  active: z.boolean().default(true),
  subscribedAt: z.number(), // Unix timestamp ms
  unsubscribedAt: z.number().optional(),
});

export type Subscription = z.infer<typeof SubscriptionSchema>;

// ──────────────────────────────────────────────────────
// Channel Message Payloads
// ──────────────────────────────────────────────────────

export const ChannelPublishPayloadSchema = z.object({
  channelId: z.string().uuid(),
  content: z.unknown(),
  tags: z.array(z.string()).optional(),
  replyToMessageId: z.string().uuid().optional(),
});

export type ChannelPublishPayload = z.infer<typeof ChannelPublishPayloadSchema>;

export const ChannelSubscribePayloadSchema = z.object({
  channelId: z.string().uuid(),
  filters: SubscriptionFilterSchema.optional(),
});

export type ChannelSubscribePayload = z.infer<typeof ChannelSubscribePayloadSchema>;

export const ChannelUnsubscribePayloadSchema = z.object({
  channelId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export type ChannelUnsubscribePayload = z.infer<typeof ChannelUnsubscribePayloadSchema>;
