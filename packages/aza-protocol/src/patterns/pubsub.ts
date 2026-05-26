import { randomUUID } from "node:crypto";
import { db } from "@aizona/db";
import type Redis from "ioredis";
import { RedisStreamTransport } from "../transport/redis-streams";
import type { ChannelType, SubscriptionFilter } from "../types/channel";
import { AZAError, AZAErrorCode } from "../types/errors";
import type { AZAEnvelope } from "../types/messages";
import { AZAEnvelopeSchema, AZAMessageType } from "../types/messages";

// ──────────────────────────────────────────────────────
// Pub/Sub Manager
// ──────────────────────────────────────────────────────
// Manages community communication channels backed by
// both Prisma (durable metadata) and Redis Streams
// (real-time message delivery).
//
// Channels:
//   - Durable metadata (name, type, community) lives in Prisma
//   - Real-time messages flow through Redis Streams
//   - Subscriptions are tracked in both Prisma and Redis consumer groups
//
// Message delivery:
//   - Publishing writes to the channel's Redis stream
//   - Each subscriber is in a consumer group and receives messages independently
// ──────────────────────────────────────────────────────

/** Consumer group name prefix for channel subscriptions. */
const CHANNEL_GROUP_PREFIX = "aza:channel:group:";

/** The Prisma AZAChannel record type. */
export type ChannelRecord = Awaited<ReturnType<typeof db.aZAChannel.findUniqueOrThrow>>;

/** The Prisma AZAChannelSubscription record type. */
export type SubscriptionRecord = Awaited<
  ReturnType<typeof db.aZAChannelSubscription.findUniqueOrThrow>
>;

export class PubSubManager {
  constructor(
    private transport: RedisStreamTransport,
    private redis: Redis,
  ) {}

  // ────────────────────────────────────────────────────
  // Channel Management
  // ────────────────────────────────────────────────────

  /**
   * Create a new communication channel.
   */
  async createChannel(params: {
    name: string;
    channelType: ChannelType;
    communityId?: string;
    description?: string;
  }): Promise<ChannelRecord> {
    const channelId = randomUUID();
    const now = new Date();

    const channel = await db.aZAChannel.create({
      data: {
        id: channelId,
        name: params.name,
        channelType: params.channelType as never,
        communityId: params.communityId ?? null,
        description: params.description ?? null,
        archived: false,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Create the Redis consumer group for this channel
    const streamKey = RedisStreamTransport.channelStream(channelId);
    const groupName = `${CHANNEL_GROUP_PREFIX}${channelId}`;
    await this.transport.createConsumerGroup(streamKey, groupName);

    return channel;
  }

  /**
   * Archive a channel. Archived channels cannot receive new messages
   * or subscriptions.
   */
  async archiveChannel(channelId: string): Promise<void> {
    const channel = await db.aZAChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new AZAError(AZAErrorCode.CHANNEL_NOT_FOUND, `Channel ${channelId} not found`, {
        details: { channelId },
      });
    }

    await db.aZAChannel.update({
      where: { id: channelId },
      data: {
        archived: true,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get a single channel by ID.
   */
  async getChannel(channelId: string): Promise<ChannelRecord | null> {
    return db.aZAChannel.findUnique({ where: { id: channelId } });
  }

  /**
   * List channels, optionally filtered by community.
   */
  async listChannels(communityId?: string): Promise<ChannelRecord[]> {
    const where: Record<string, unknown> = {};
    if (communityId) {
      where.communityId = communityId;
    }

    return db.aZAChannel.findMany({
      where: where as any,
      orderBy: { createdAt: "asc" },
    });
  }

  // ────────────────────────────────────────────────────
  // Subscriptions
  // ────────────────────────────────────────────────────

  /**
   * Subscribe an agent to a channel.
   * Creates a Prisma subscription record and ensures the agent
   * is part of the Redis consumer group for the channel stream.
   */
  async subscribe(
    channelId: string,
    agentDid: string,
    filters?: SubscriptionFilter,
  ): Promise<void> {
    // Verify the channel exists and is not archived
    const channel = await db.aZAChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new AZAError(AZAErrorCode.CHANNEL_NOT_FOUND, `Channel ${channelId} not found`, {
        details: { channelId },
      });
    }

    if (channel.archived) {
      throw new AZAError(
        AZAErrorCode.CHANNEL_ARCHIVED,
        `Channel ${channelId} is archived and cannot accept new subscriptions`,
        { details: { channelId } },
      );
    }

    // Check for existing active subscription
    const existing = await db.aZAChannelSubscription.findFirst({
      where: {
        channelId,
        agentDid,
        active: true,
      },
    });

    if (existing) {
      throw new AZAError(
        AZAErrorCode.CHANNEL_ALREADY_SUBSCRIBED,
        `Agent ${agentDid} is already subscribed to channel ${channelId}`,
        { details: { channelId, agentDid } },
      );
    }

    // Create the subscription record
    await db.aZAChannelSubscription.create({
      data: {
        id: randomUUID(),
        channelId,
        agentDid,
        filters: filters ? (filters as any) : null,
        active: true,
        subscribedAt: new Date(),
      },
    });

    // Ensure the consumer group exists (idempotent)
    const streamKey = RedisStreamTransport.channelStream(channelId);
    const groupName = `${CHANNEL_GROUP_PREFIX}${channelId}`;
    await this.transport.createConsumerGroup(streamKey, groupName);
  }

  /**
   * Unsubscribe an agent from a channel.
   */
  async unsubscribe(channelId: string, agentDid: string): Promise<void> {
    const subscription = await db.aZAChannelSubscription.findFirst({
      where: {
        channelId,
        agentDid,
        active: true,
      },
    });

    if (!subscription) {
      throw new AZAError(
        AZAErrorCode.CHANNEL_NOT_SUBSCRIBED,
        `Agent ${agentDid} is not subscribed to channel ${channelId}`,
        { details: { channelId, agentDid } },
      );
    }

    await db.aZAChannelSubscription.update({
      where: { id: subscription.id },
      data: {
        active: false,
        unsubscribedAt: new Date(),
      },
    });
  }

  /**
   * Get all active subscriptions for an agent.
   */
  async getSubscriptions(agentDid: string): Promise<SubscriptionRecord[]> {
    return db.aZAChannelSubscription.findMany({
      where: {
        agentDid,
        active: true,
      },
      orderBy: { subscribedAt: "asc" },
    });
  }

  /**
   * Get all active subscriber DIDs for a channel.
   */
  async getSubscribers(channelId: string): Promise<string[]> {
    const subscriptions = await db.aZAChannelSubscription.findMany({
      where: {
        channelId,
        active: true,
      },
      select: { agentDid: true },
    });

    return subscriptions.map((s: { agentDid: string }) => s.agentDid);
  }

  // ────────────────────────────────────────────────────
  // Publishing
  // ────────────────────────────────────────────────────

  /**
   * Publish a message to a channel.
   * The message is written to the channel's Redis stream where
   * all subscribed consumers will receive it.
   */
  async publish(
    channelId: string,
    fromDid: string,
    content: unknown,
    tags?: string[],
  ): Promise<void> {
    // Verify the channel exists and is not archived
    const channel = await db.aZAChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new AZAError(AZAErrorCode.CHANNEL_NOT_FOUND, `Channel ${channelId} not found`, {
        details: { channelId },
      });
    }

    if (channel.archived) {
      throw new AZAError(
        AZAErrorCode.CHANNEL_ARCHIVED,
        `Channel ${channelId} is archived and cannot accept new messages`,
        { details: { channelId } },
      );
    }

    // Build the envelope
    const envelope: AZAEnvelope = {
      id: randomUUID(),
      from: fromDid,
      to: null,
      correlationId: randomUUID(),
      type: AZAMessageType.CHANNEL_PUBLISH,
      payload: {
        channelId,
        content,
        tags,
      },
      timestamp: Date.now(),
      priority: "NORMAL",
      metadata: {
        channel: channelId,
        community: channel.communityId ?? undefined,
        protocolVersion: "2.0.0",
      },
    } as AZAEnvelope;

    // Publish to the channel stream
    const streamKey = RedisStreamTransport.channelStream(channelId);
    try {
      await this.transport.publish(streamKey, envelope);
    } catch (error) {
      throw new AZAError(
        AZAErrorCode.CHANNEL_PUBLISH_FAILED,
        `Failed to publish to channel ${channelId}`,
        {
          details: { channelId, fromDid },
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
  }

  // ────────────────────────────────────────────────────
  // Message History
  // ────────────────────────────────────────────────────

  /**
   * Retrieve historical messages from a channel stream.
   * Uses Redis XRANGE for cursor-based pagination.
   *
   * @param channelId - The channel to read from.
   * @param params    - Pagination parameters.
   */
  async getMessages(
    channelId: string,
    params: { cursor?: string; limit?: number },
  ): Promise<{ messages: AZAEnvelope[]; nextCursor: string | null }> {
    const channel = await db.aZAChannel.findUnique({ where: { id: channelId } });
    if (!channel) {
      throw new AZAError(AZAErrorCode.CHANNEL_NOT_FOUND, `Channel ${channelId} not found`, {
        details: { channelId },
      });
    }

    const streamKey = RedisStreamTransport.channelStream(channelId);
    const limit = params.limit ?? 50;
    const startId = params.cursor ?? "-";

    // XRANGE returns messages in chronological order
    const rawEntries = await this.redis.xrange(
      streamKey,
      startId === "-" ? "-" : `(${startId}`,
      "+",
      "COUNT",
      limit + 1,
    );

    const messages: AZAEnvelope[] = [];
    let nextCursor: string | null = null;

    if (!rawEntries || rawEntries.length === 0) {
      return { messages: [], nextCursor: null };
    }

    // If we got more than `limit` entries, there are more pages
    const hasMore = rawEntries.length > limit;
    const entriesToProcess = hasMore ? rawEntries.slice(0, limit) : rawEntries;

    for (const [messageId, fields] of entriesToProcess) {
      const dataIndex = fields.indexOf("data");
      if (dataIndex === -1 || dataIndex + 1 >= fields.length) continue;

      const rawData = fields[dataIndex + 1];
      if (!rawData) continue;

      try {
        const parsed: unknown = JSON.parse(rawData);
        const envelope = AZAEnvelopeSchema.parse(parsed);
        messages.push(envelope);
      } catch {
        // Skip malformed entries
      }
    }

    if (hasMore && entriesToProcess.length > 0) {
      const lastEntry = entriesToProcess[entriesToProcess.length - 1];
      if (lastEntry) {
        nextCursor = lastEntry[0];
      }
    }

    return { messages, nextCursor };
  }
}
