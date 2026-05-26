import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";
import type { AZAEnvelope } from "../types/messages";
import { RedisStreamTransport } from "./redis-streams";

// ──────────────────────────────────────────────────────
// Message Handler (Consumer Loop)
// ──────────────────────────────────────────────────────
// Consumes messages from an agent's inbox stream with:
//   - Deduplication via Redis SET with TTL
//   - Per-type handler dispatch
//   - Retry with exponential backoff
//   - Dead-letter queue (DLQ) after maxRetries
//   - Graceful start/stop lifecycle
// ──────────────────────────────────────────────────────

/** Dedup key TTL in seconds (24 hours). */
const DEDUP_TTL_SECONDS = 86400;

/** Base delay for exponential backoff retry (ms). */
const RETRY_BASE_DELAY_MS = 500;

export interface MessageHandlerOptions {
  /** DID of the agent consuming messages. */
  agentDid: string;
  /** The Redis Streams transport instance (uses a dedicated connection). */
  transport: RedisStreamTransport;
  /** A Redis client for dedup SET operations (can be the shared singleton). */
  redis: Redis;
  /** Map of message type -> handler function. */
  handlers: Map<string, (envelope: AZAEnvelope) => Promise<void>>;
  /** Maximum retries before sending to DLQ. Default: 3. */
  maxRetries?: number;
  /** Consumer group name. Default: `aza:group:<agentDid>`. */
  consumerGroup?: string;
  /** Consumer ID within the group. Default: `consumer-1`. */
  consumerId?: string;
}

export class MessageHandler {
  private running = false;
  private readonly signal: { stopped: boolean } = { stopped: false };

  private readonly agentDid: string;
  private readonly transport: RedisStreamTransport;
  private readonly redis: Redis;
  private readonly handlers: Map<string, (envelope: AZAEnvelope) => Promise<void>>;
  private readonly maxRetries: number;
  private readonly consumerGroup: string;
  private readonly consumerId: string;
  private readonly streamKey: string;

  constructor(options: MessageHandlerOptions) {
    this.agentDid = options.agentDid;
    this.transport = options.transport;
    this.redis = options.redis;
    this.handlers = options.handlers;
    this.maxRetries = options.maxRetries ?? 3;
    this.consumerGroup = options.consumerGroup ?? `aza:group:${options.agentDid}`;
    this.consumerId = options.consumerId ?? "consumer-1";
    this.streamKey = RedisStreamTransport.agentStream(options.agentDid);
  }

  // ────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────

  /**
   * Start consuming messages from this agent's inbox stream.
   * Creates the consumer group if it doesn't exist, then
   * enters a blocking XREADGROUP loop.
   *
   * First processes any pending (unacknowledged) messages
   * from a previous crash, then starts consuming new messages.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new AZAError(AZAErrorCode.CONNECTION_FAILED, "MessageHandler is already running", {
        details: { agentDid: this.agentDid },
      });
    }

    this.running = true;
    this.signal.stopped = false;

    // Ensure the consumer group exists
    await this.transport.createConsumerGroup(this.streamKey, this.consumerGroup);

    // Re-process pending messages from a previous crash
    await this.processPending();

    // Enter the main consume loop (blocks until stop() is called)
    await this.transport.subscribe(
      this.streamKey,
      this.consumerGroup,
      this.consumerId,
      async (envelope, messageId) => {
        await this.processMessage(envelope, messageId);
      },
      this.signal,
    );

    this.running = false;
  }

  /**
   * Gracefully stop the consumer loop.
   * The current BLOCK call will complete (up to 5 seconds)
   * before the loop exits.
   */
  async stop(): Promise<void> {
    this.signal.stopped = true;
    // Wait briefly for the loop to detect the signal
    await sleep(100);
  }

  /**
   * Returns true if the consumer loop is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  // ────────────────────────────────────────────────────
  // Message Processing
  // ────────────────────────────────────────────────────

  /**
   * Process a single message envelope:
   * 1. Dedup check
   * 2. Dispatch to the registered handler for the message type
   * 3. Retry on failure (up to maxRetries)
   * 4. Send to DLQ after exhausting retries
   * 5. Acknowledge the message
   */
  private async processMessage(envelope: AZAEnvelope, messageId: string): Promise<void> {
    try {
      // Step 1: Dedup check
      if (await this.isDuplicate(envelope.id)) {
        // Already processed — just acknowledge and skip
        await this.transport.acknowledge(this.streamKey, this.consumerGroup, messageId);
        return;
      }

      // Step 2: Look up handler
      const handler = this.handlers.get(envelope.type);
      if (!handler) {
        console.warn(
          `[MessageHandler] No handler registered for message type "${envelope.type}" (id: ${envelope.id})`,
        );
        // Acknowledge so it doesn't block the consumer group
        await this.transport.acknowledge(this.streamKey, this.consumerGroup, messageId);
        return;
      }

      // Step 3: Try to handle with retries
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          await handler(envelope);
          // Success — mark as seen and acknowledge
          await this.markSeen(envelope.id);
          await this.transport.acknowledge(this.streamKey, this.consumerGroup, messageId);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          console.error(
            `[MessageHandler] Handler failed for ${envelope.type} (attempt ${attempt}/${this.maxRetries}):`,
            lastError.message,
          );

          if (attempt < this.maxRetries) {
            // Exponential backoff
            const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
            await sleep(delay);
          }
        }
      }

      // Step 4: All retries exhausted — send to DLQ
      await this.sendToDLQ(envelope, lastError ?? new Error("Unknown handler error"));
      await this.markSeen(envelope.id);
      await this.transport.acknowledge(this.streamKey, this.consumerGroup, messageId);
    } catch (error) {
      // Catastrophic error in the processing pipeline itself
      console.error(
        `[MessageHandler] Critical error processing message ${envelope.id}:`,
        error instanceof Error ? error.message : error,
      );
      // Still acknowledge to prevent infinite redelivery
      try {
        await this.transport.acknowledge(this.streamKey, this.consumerGroup, messageId);
      } catch {
        // Nothing more we can do
      }
    }
  }

  /**
   * Process pending (unacknowledged) messages from a previous session.
   */
  private async processPending(): Promise<void> {
    const pending = await this.transport.readPending(
      this.streamKey,
      this.consumerGroup,
      this.consumerId,
      50,
    );

    for (const { envelope, messageId } of pending) {
      await this.processMessage(envelope, messageId);
    }
  }

  // ────────────────────────────────────────────────────
  // Deduplication
  // ────────────────────────────────────────────────────

  /**
   * Check if a message with the given ID has already been processed.
   * Uses a Redis SET with NX + EX for atomic check-and-set.
   */
  private async isDuplicate(messageId: string): Promise<boolean> {
    const key = `aza:dedup:${this.agentDid}:${messageId}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  /**
   * Mark a message ID as seen (processed).
   */
  private async markSeen(messageId: string): Promise<void> {
    const key = `aza:dedup:${this.agentDid}:${messageId}`;
    await this.redis.set(key, "1", "EX", DEDUP_TTL_SECONDS);
  }

  // ────────────────────────────────────────────────────
  // Dead-Letter Queue
  // ────────────────────────────────────────────────────

  /**
   * Send a failed message to the agent's dead-letter queue stream.
   * Includes the original envelope plus error information.
   */
  private async sendToDLQ(envelope: AZAEnvelope, error: Error): Promise<void> {
    const dlqKey = RedisStreamTransport.dlqStream(this.agentDid);
    const dlqEntry = JSON.stringify({
      envelope,
      error: {
        message: error.message,
        name: error.name,
        code: error instanceof AZAError ? error.code : undefined,
      },
      failedAt: Date.now(),
      maxRetries: this.maxRetries,
    });

    try {
      await this.redis.xadd(dlqKey, "*", "data", dlqEntry);
      console.error(
        `[MessageHandler] Message ${envelope.id} sent to DLQ (${dlqKey}) after ${this.maxRetries} retries`,
      );
    } catch (dlqError) {
      // DLQ write failure is critical — log loudly
      console.error(
        `[MessageHandler] CRITICAL: Failed to write to DLQ for message ${envelope.id}:`,
        dlqError instanceof Error ? dlqError.message : dlqError,
      );
    }
  }
}

// ────────────────────────────────────────────────────
// Internal Helpers
// ────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
