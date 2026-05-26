import { db } from "../db";
import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";
import type { AZAEnvelope } from "../types/messages";
import { PROTOCOL_TO_PRISMA_MESSAGE_TYPE } from "../types/messages";
import type { AZAMessageType } from "../types/messages";

// ──────────────────────────────────────────────────────
// Audit Logger
// ──────────────────────────────────────────────────────
// Dual-write audit trail: fast-path to Redis stream,
// durable-path to Prisma AZAMessage table.
//
// Invariant: NEVER silently drop audit entries (fail-closed).
// If the Prisma write fails, the entry is queued in a Redis
// retry stream for later persistence.
// ──────────────────────────────────────────────────────

/** Redis stream for audit retry queue when Prisma writes fail. */
const AUDIT_FAILED_STREAM = "aza:audit:failed";

/** Redis stream for general audit messages (fast path). */
const AUDIT_MESSAGES_STREAM = "aza:audit:messages";

/** Redis stream for error audit entries. */
const AUDIT_ERRORS_STREAM = "aza:audit:errors";

export interface AuditMetadata {
  routedTo?: string;
  action?: string;
}

export class AuditLogger {
  constructor(private redis: Redis) {}

  // ────────────────────────────────────────────────────
  // Message Audit
  // ────────────────────────────────────────────────────

  /**
   * Log an AZA message envelope to both Redis (fast) and Prisma (durable).
   *
   * 1. Write to Redis `aza:audit:messages` stream (fire-and-forget for speed).
   * 2. Write to Prisma AZAMessage table for durable, queryable storage.
   * 3. If the Prisma write fails, push to `aza:audit:failed` for later retry.
   * 4. NEVER silently swallow failures.
   */
  async logMessage(envelope: AZAEnvelope, metadata?: AuditMetadata): Promise<void> {
    const auditEntry = {
      envelope,
      metadata: metadata ?? {},
      auditedAt: Date.now(),
    };

    // ── Fast path: Redis stream ──
    try {
      await this.redis.xadd(AUDIT_MESSAGES_STREAM, "*", "data", JSON.stringify(auditEntry));
    } catch (redisError) {
      // Redis audit failure is non-fatal but concerning — log it
      console.error(
        "[AuditLogger] Failed to write to Redis audit stream:",
        redisError instanceof Error ? redisError.message : redisError,
      );
    }

    // ── Durable path: Prisma ──
    try {
      const prismaType = PROTOCOL_TO_PRISMA_MESSAGE_TYPE[envelope.type as AZAMessageType];
      if (!prismaType) {
        throw new Error(`No Prisma mapping for message type: ${envelope.type}`);
      }

      await db.aZAMessage.create({
        data: {
          id: envelope.id,
          type: prismaType as never, // Prisma enum type
          fromDid: envelope.from,
          toDid: envelope.to ?? null,
          correlationId: envelope.correlationId ?? null,
          payload: envelope.payload as never, // Prisma Json type
          signature: envelope.signature ?? null,
          community: envelope.metadata?.community ?? null,
          team: envelope.metadata?.team ?? null,
          channel: envelope.metadata?.channel ?? null,
          priority: envelope.priority as never, // Prisma AZAMessagePriority enum
          expiresAt: envelope.expiresAt ? new Date(envelope.expiresAt) : null,
          acknowledged: false,
        },
      });
    } catch (prismaError) {
      // Prisma failure: push to retry stream so the entry is not lost
      console.error(
        "[AuditLogger] Prisma write failed, queuing for retry:",
        prismaError instanceof Error ? prismaError.message : prismaError,
      );

      try {
        await this.redis.xadd(
          AUDIT_FAILED_STREAM,
          "*",
          "data",
          JSON.stringify({
            envelope,
            metadata: metadata ?? {},
            error: prismaError instanceof Error ? prismaError.message : String(prismaError),
            failedAt: Date.now(),
          }),
        );
      } catch (retryQueueError) {
        // Both Prisma and retry queue failed — this is critical.
        // Log as loudly as possible. We NEVER silently drop.
        console.error("[AuditLogger] CRITICAL: Failed to write to both Prisma and retry queue!", {
          envelopeId: envelope.id,
          prismaError: prismaError instanceof Error ? prismaError.message : prismaError,
          retryError: retryQueueError instanceof Error ? retryQueueError.message : retryQueueError,
        });
        // Throw so the caller knows auditing failed entirely
        throw new AZAError(
          AZAErrorCode.DELIVERY_FAILED,
          "Audit logging failed: both Prisma and retry queue are unavailable",
          {
            details: { envelopeId: envelope.id },
            cause: prismaError instanceof Error ? prismaError : undefined,
          },
        );
      }
    }
  }

  // ────────────────────────────────────────────────────
  // Error Audit
  // ────────────────────────────────────────────────────

  /**
   * Log an error event to the audit trail.
   * Errors are written to a dedicated Redis stream for monitoring.
   */
  async logError(error: AZAError | Error, context?: Record<string, unknown>): Promise<void> {
    const entry = {
      error: {
        name: error.name,
        message: error.message,
        code: error instanceof AZAError ? error.code : undefined,
        retryable: error instanceof AZAError ? error.retryable : undefined,
        details: error instanceof AZAError ? error.details : undefined,
      },
      context: context ?? {},
      timestamp: Date.now(),
    };

    try {
      await this.redis.xadd(AUDIT_ERRORS_STREAM, "*", "data", JSON.stringify(entry));
    } catch (redisError) {
      // Cannot even log the error audit — print to stderr as last resort
      console.error("[AuditLogger] CRITICAL: Failed to write error audit entry:", {
        originalError: error.message,
        redisError: redisError instanceof Error ? redisError.message : redisError,
        context,
      });
    }
  }
}
