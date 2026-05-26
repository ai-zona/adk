import { db } from "@aizona/db";
import { OutputSanitizer } from "../safety/output-sanitizer";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

/** Status values matching the Prisma MCPInvocationStatus enum. */
export type InvocationStatus =
  | "SUCCESS"
  | "FAILED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PERMISSION_DENIED";

export interface InvocationLogEntry {
  agentId: string;
  toolId: string;
  input: Record<string, unknown>;
  output: unknown;
  status: InvocationStatus;
  latencyMs: number;
  costAiz?: number;
  errorMessage?: string;
  correlationId?: string;
}

/**
 * Represents a persisted invocation log record as returned by queries.
 */
export type MCPInvocationLogRecord = Awaited<
  ReturnType<typeof db.mCPInvocationLog.findUniqueOrThrow>
>;

export interface QueryLogsParams {
  agentId?: string;
  toolId?: string;
  status?: string;
  correlationId?: string;
  startDate?: Date;
  endDate?: Date;
  cursor?: string;
  limit?: number;
}

export interface QueryLogsResult {
  logs: MCPInvocationLogRecord[];
  nextCursor: string | null;
}

// ──────────────────────────────────────────────────────
// MCPAuditLogger
// ──────────────────────────────────────────────────────

/**
 * Logs MCP tool invocations to the database for auditing and analytics.
 *
 * Before persisting, inputs and outputs are sanitized using
 * {@link OutputSanitizer} so that PII and credentials are never stored
 * in plain text.
 */
export class MCPAuditLogger {
  private sanitizer: OutputSanitizer;

  constructor() {
    this.sanitizer = new OutputSanitizer();
  }

  // ── Public API ────────────────────────────────────

  /**
   * Logs a single MCP invocation.
   *
   * @param entry - The invocation details to record
   * @returns The ID of the newly created log entry
   */
  async logInvocation(entry: InvocationLogEntry): Promise<string> {
    // 1. Sanitize input and output before storing
    const inputResult = this.sanitizer.sanitize(entry.input);
    const outputResult = this.sanitizer.sanitize(entry.output);

    // 2. Write to Prisma MCPInvocationLog table
    const record = await db.mCPInvocationLog.create({
      data: {
        agentId: entry.agentId,
        toolId: entry.toolId,
        inputRedacted: inputResult.sanitized as any,
        outputRedacted: outputResult.sanitized as any,
        status: entry.status,
        latencyMs: entry.latencyMs,
        costAiz: entry.costAiz ?? null,
        errorMessage: entry.errorMessage ?? null,
        correlationId: entry.correlationId ?? null,
      },
    });

    // 3. Return the log entry ID
    return record.id;
  }

  /**
   * Queries invocation logs with filtering and cursor-based pagination.
   *
   * @param params - Filter and pagination parameters
   * @returns A page of log records and an optional cursor for the next page
   */
  async queryLogs(params: QueryLogsParams): Promise<QueryLogsResult> {
    const limit = params.limit ?? 50;

    // Build where clause
    const where: Record<string, unknown> = {};

    if (params.agentId) {
      where.agentId = params.agentId;
    }
    if (params.toolId) {
      where.toolId = params.toolId;
    }
    if (params.status) {
      where.status = params.status;
    }
    if (params.correlationId) {
      where.correlationId = params.correlationId;
    }
    if (params.startDate || params.endDate) {
      const invokedAt: Record<string, Date> = {};
      if (params.startDate) {
        invokedAt.gte = params.startDate;
      }
      if (params.endDate) {
        invokedAt.lte = params.endDate;
      }
      where.invokedAt = invokedAt;
    }

    // Cursor-based pagination
    const findArgs: Record<string, unknown> = {
      where,
      take: limit + 1, // fetch one extra to determine if there's a next page
      orderBy: { invokedAt: "desc" },
    };

    if (params.cursor) {
      findArgs.cursor = { id: params.cursor };
      findArgs.skip = 1; // skip the cursor record itself
    }

    const logs = (await db.mCPInvocationLog.findMany(findArgs as any)) as MCPInvocationLogRecord[];

    let nextCursor: string | null = null;

    if (logs.length > limit) {
      const lastItem = logs.pop();
      nextCursor = lastItem?.id ?? null;
    }

    return { logs, nextCursor };
  }

  /**
   * Retrieves a single invocation log by its ID.
   *
   * @param id - The log entry ID
   * @returns The log record, or null if not found
   */
  async getLogById(id: string): Promise<MCPInvocationLogRecord | null> {
    return db.mCPInvocationLog.findUnique({ where: { id } });
  }
}
