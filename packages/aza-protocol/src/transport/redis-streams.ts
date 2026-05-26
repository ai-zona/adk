import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";
import { AZAEnvelopeSchema } from "../types/messages";
import type { AZAEnvelope } from "../types/messages";

// ──────────────────────────────────────────────────────
// Redis Streams Transport
// ──────────────────────────────────────────────────────
// Provides publish/subscribe over Redis Streams with
// consumer groups for reliable, at-least-once delivery.
//
// Stream key conventions:
//   aza:messages:<did>      — per-agent message inbox
//   aza:tasks:<taskId>      — per-task event stream
//   aza:teams:<teamId>      — per-team message stream
//   aza:channels:<channelId> — pub/sub channel stream
//   aza:dlq:<did>           — dead-letter queue per agent
//   aza:audit:messages      — audit trail stream
// ──────────────────────────────────────────────────────

/** Default block time for XREADGROUP (5 seconds). */
const DEFAULT_BLOCK_MS = 5000;

/** Default count of messages to read per XREADGROUP call. */
const DEFAULT_READ_COUNT = 10;

/**
 * ioredis XREADGROUP returns data shaped like:
 *   [ [streamName, [[messageId, [field, value, ...]], ...]], ... ]
 *
 * Since ioredis types this as `unknown[]`, we define a structural
 * type and cast after the top-level null check.
 */
type StreamReadResult = [string, [string, string[]][]][];

export class RedisStreamTransport {
  constructor(private redis: Redis) {}

  // ────────────────────────────────────────────────────
  // Stream Key Helpers
  // ────────────────────────────────────────────────────

  static agentStream(did: string): string {
    return `aza:messages:${did}`;
  }

  static taskStream(taskId: string): string {
    return `aza:tasks:${taskId}`;
  }

  static teamStream(teamId: string): string {
    return `aza:teams:${teamId}`;
  }

  static channelStream(channelId: string): string {
    return `aza:channels:${channelId}`;
  }

  static dlqStream(did: string): string {
    return `aza:dlq:${did}`;
  }

  static auditStream(): string {
    return "aza:audit:messages";
  }

  // ────────────────────────────────────────────────────
  // Publishing
  // ────────────────────────────────────────────────────

  /**
   * Publish an AZAEnvelope to a Redis stream.
   * The envelope is serialized as JSON into a single "data" field.
   *
   * @returns The Redis-assigned message ID (e.g., "1234567890-0").
   */
  async publish(streamKey: string, envelope: AZAEnvelope): Promise<string> {
    try {
      const data = JSON.stringify(envelope);
      const messageId = await this.redis.xadd(streamKey, "*", "data", data);
      if (!messageId) {
        throw new AZAError(AZAErrorCode.DELIVERY_FAILED, "XADD returned null message ID", {
          details: { streamKey },
        });
      }
      return messageId;
    } catch (error) {
      if (error instanceof AZAError) throw error;
      throw new AZAError(AZAErrorCode.DELIVERY_FAILED, `Failed to publish to stream ${streamKey}`, {
        details: { streamKey },
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  // ────────────────────────────────────────────────────
  // Consumer Groups
  // ────────────────────────────────────────────────────

  /**
   * Create a consumer group for a stream.
   * Uses MKSTREAM so the stream is created if it does not exist.
   * Silently succeeds if the group already exists (BUSYGROUP).
   */
  async createConsumerGroup(streamKey: string, groupName: string): Promise<void> {
    try {
      await this.redis.xgroup("CREATE", streamKey, groupName, "0", "MKSTREAM");
    } catch (error) {
      // BUSYGROUP means the group already exists — that is fine
      if (error instanceof Error && error.message.includes("BUSYGROUP")) {
        return;
      }
      throw new AZAError(
        AZAErrorCode.CONNECTION_FAILED,
        `Failed to create consumer group ${groupName} on ${streamKey}`,
        {
          details: { streamKey, groupName },
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
  }

  /**
   * Subscribe to a stream using XREADGROUP in a blocking loop.
   *
   * This method runs indefinitely until the returned AbortController-style
   * stop mechanism is invoked (see MessageHandler for lifecycle management).
   * For each message received, the `handler` callback is invoked.
   *
   * NOTE: XREADGROUP with BLOCK requires a dedicated Redis connection
   * (not the shared singleton). The caller is responsible for providing
   * an appropriate connection.
   *
   * @param streamKey  - The stream to consume from.
   * @param groupName  - The consumer group name.
   * @param consumerId - A unique consumer ID within the group.
   * @param handler    - Async callback for each envelope. Must not throw
   *                     (errors are caught and logged).
   * @param signal     - An object with a `stopped` flag; set to true to
   *                     stop the loop after the current BLOCK completes.
   */
  async subscribe(
    streamKey: string,
    groupName: string,
    consumerId: string,
    handler: (envelope: AZAEnvelope, messageId: string) => Promise<void>,
    signal: { stopped: boolean },
  ): Promise<void> {
    while (!signal.stopped) {
      try {
        const rawResults = await this.redis.xreadgroup(
          "GROUP",
          groupName,
          consumerId,
          "COUNT",
          DEFAULT_READ_COUNT,
          "BLOCK",
          DEFAULT_BLOCK_MS,
          "STREAMS",
          streamKey,
          ">",
        );

        if (!rawResults) continue; // Timeout with no new messages

        const results = rawResults as StreamReadResult;

        for (const [, messages] of results) {
          for (const [messageId, fields] of messages) {
            const rawData = extractField(fields, "data");
            if (!rawData) continue;

            try {
              const parsed: unknown = JSON.parse(rawData);
              const envelope = AZAEnvelopeSchema.parse(parsed);
              await handler(envelope, messageId);
            } catch (parseError) {
              // Log and skip malformed messages — do not crash the consumer loop
              console.error(
                `[RedisStreamTransport] Failed to parse message ${messageId} from ${streamKey}:`,
                parseError instanceof Error ? parseError.message : parseError,
              );
            }
          }
        }
      } catch (error) {
        if (signal.stopped) break;
        // Transient errors: log and retry after a short delay
        console.error(
          `[RedisStreamTransport] Error reading from ${streamKey}:`,
          error instanceof Error ? error.message : error,
        );
        await sleep(1000);
      }
    }
  }

  /**
   * Acknowledge a message as successfully processed.
   */
  async acknowledge(streamKey: string, groupName: string, messageId: string): Promise<void> {
    await this.redis.xack(streamKey, groupName, messageId);
  }

  // ────────────────────────────────────────────────────
  // Pending Messages
  // ────────────────────────────────────────────────────

  /**
   * Read pending (unacknowledged) messages from a consumer group.
   * Useful for crash-recovery: re-process messages that were
   * delivered but not acknowledged before the consumer went down.
   */
  async readPending(
    streamKey: string,
    groupName: string,
    consumerId: string,
    count = 10,
  ): Promise<{ envelope: AZAEnvelope; messageId: string }[]> {
    const rawResults = await this.redis.xreadgroup(
      "GROUP",
      groupName,
      consumerId,
      "COUNT",
      count,
      "STREAMS",
      streamKey,
      "0", // "0" reads already-delivered but unacknowledged messages
    );

    if (!rawResults) return [];

    const results = rawResults as StreamReadResult;
    const pending: { envelope: AZAEnvelope; messageId: string }[] = [];

    for (const [, messages] of results) {
      for (const [messageId, fields] of messages) {
        const rawData = extractField(fields, "data");
        if (!rawData) continue;

        try {
          const parsed: unknown = JSON.parse(rawData);
          const envelope = AZAEnvelopeSchema.parse(parsed);
          pending.push({ envelope, messageId });
        } catch {
          // Skip malformed pending messages
        }
      }
    }

    return pending;
  }

  // ────────────────────────────────────────────────────
  // Maintenance
  // ────────────────────────────────────────────────────

  /**
   * Trim a stream to approximately `maxLength` entries (using ~).
   * This is a best-effort operation — Redis may keep slightly more.
   */
  async trimStream(streamKey: string, maxLength: number): Promise<void> {
    await this.redis.xtrim(streamKey, "MAXLEN", "~", maxLength);
  }
}

// ────────────────────────────────────────────────────
// Internal Helpers
// ────────────────────────────────────────────────────

/**
 * Extract a field value from the flat [key, value, key, value, ...]
 * array returned by Redis stream entries.
 */
function extractField(fields: string[], fieldName: string): string | undefined {
  const index = fields.indexOf(fieldName);
  if (index === -1 || index + 1 >= fields.length) return undefined;
  return fields[index + 1];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
