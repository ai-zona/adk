import { db } from "../db";

// ──────────────────────────────────────────────────────
// Audit Query Service
// ──────────────────────────────────────────────────────
// Provides cursor-based pagination over the Prisma
// AZAMessage audit trail. All queries are read-only.
// ──────────────────────────────────────────────────────

/**
 * Represents a persisted AZA message record from the database.
 * Derived from the Prisma model for type safety.
 */
export type AZAMessageRecord = NonNullable<Awaited<ReturnType<typeof db.aZAMessage.findFirst>>>;

export interface AuditQueryParams {
  /** Filter by sender DID. */
  fromDid?: string;
  /** Filter by recipient DID. */
  toDid?: string;
  /** Filter by Prisma AZAMessageType (e.g., "TASK_REQUEST"). */
  type?: string;
  /** Filter by correlation ID to find related messages. */
  correlationId?: string;
  /** Filter messages created at or after this date. */
  startDate?: Date;
  /** Filter messages created at or before this date. */
  endDate?: Date;
  /** Cursor for pagination (message ID). */
  cursor?: string;
  /** Maximum number of records to return (default: 50, max: 200). */
  limit?: number;
}

export interface AuditQueryResult {
  messages: AZAMessageRecord[];
  nextCursor: string | null;
}

export class AuditQuery {
  // ────────────────────────────────────────────────────
  // Paginated Query
  // ────────────────────────────────────────────────────

  /**
   * Query the audit trail with optional filters and cursor-based pagination.
   *
   * Results are ordered by createdAt descending (newest first).
   * The `nextCursor` in the result can be passed as `cursor` in the
   * next call to fetch the following page.
   */
  async queryMessages(params: AuditQueryParams): Promise<AuditQueryResult> {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

    // Build where clause dynamically
    const where: Record<string, unknown> = {};

    if (params.fromDid) {
      where.fromDid = params.fromDid;
    }

    if (params.toDid) {
      where.toDid = params.toDid;
    }

    if (params.type) {
      where.type = params.type;
    }

    if (params.correlationId) {
      where.correlationId = params.correlationId;
    }

    if (params.startDate || params.endDate) {
      const createdAt: Record<string, Date> = {};
      if (params.startDate) {
        createdAt.gte = params.startDate;
      }
      if (params.endDate) {
        createdAt.lte = params.endDate;
      }
      where.createdAt = createdAt;
    }

    // Cursor-based pagination
    const findArgs: {
      where: Record<string, unknown>;
      orderBy: { createdAt: "desc" };
      take: number;
      cursor?: { id: string };
      skip?: number;
    } = {
      where,
      orderBy: { createdAt: "desc" as const },
      take: limit + 1, // Fetch one extra to determine if there's a next page
    };

    if (params.cursor) {
      findArgs.cursor = { id: params.cursor };
      findArgs.skip = 1; // Skip the cursor record itself
    }

    const messages = await db.aZAMessage.findMany(findArgs);

    // Determine if there are more results
    let nextCursor: string | null = null;
    if (messages.length > limit) {
      const lastMessage = messages[limit - 1];
      nextCursor = lastMessage ? lastMessage.id : null;
      messages.splice(limit); // Remove the extra record
    }

    return { messages, nextCursor };
  }

  // ────────────────────────────────────────────────────
  // Single Record Lookups
  // ────────────────────────────────────────────────────

  /**
   * Retrieve a single message by its ID.
   */
  async getMessageById(id: string): Promise<AZAMessageRecord | null> {
    return db.aZAMessage.findUnique({
      where: { id },
    });
  }

  /**
   * Retrieve all messages in a conversation (by correlationId).
   * Results are ordered by createdAt ascending (chronological).
   */
  async getConversation(correlationId: string): Promise<AZAMessageRecord[]> {
    return db.aZAMessage.findMany({
      where: { correlationId },
      orderBy: { createdAt: "asc" },
    });
  }
}
