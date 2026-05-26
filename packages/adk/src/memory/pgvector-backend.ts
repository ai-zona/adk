// ──────────────────────────────────────────────────────
// ADK PgVector Memory Backend — PostgreSQL + pgvector
// ──────────────────────────────────────────────────────
// Uses raw SQL for vector operations via a generic database
// client interface. The embedding column is NOT in the Prisma
// schema — it is managed entirely via raw SQL.
//
// Prerequisites:
//   CREATE EXTENSION IF NOT EXISTS vector;
//   ALTER TABLE agent_memories ADD COLUMN embedding vector(1536);
//   CREATE INDEX ON agent_memories USING ivfflat (embedding vector_cosine_ops);
// ──────────────────────────────────────────────────────

import type { EmbeddingService } from "./embedding";
import type { MemoryBackend, MemoryEntry, MemorySearchResult, MemoryType } from "./types";

/**
 * Generic database client interface — compatible with Prisma's $queryRaw
 * but does not directly import from @aizona/db or @prisma/client.
 */
export interface PgVectorDatabaseClient {
  $queryRaw(sql: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
}

/** Raw row shape returned from PostgreSQL queries */
interface MemoryRow {
  id: string;
  agentId: string;
  sessionId: string | null;
  content: string;
  memoryType: MemoryType;
  importance: number;
  accessCount: number;
  lastAccessedAt: Date | null;
  expiresAt: Date | null;
  metadata: Record<string, unknown> | string;
  createdAt: Date;
}

/** Raw row shape returned from similarity search */
interface SearchRow extends MemoryRow {
  distance: number;
}

/** Default decay multiplier (5% reduction per decay cycle) */
const DECAY_FACTOR = 0.95;

/** Default number of days since last access before decay applies */
const DECAY_STALE_DAYS = 7;

/** Default similarity distance threshold */
const DEFAULT_THRESHOLD = 0.7;

/** Default search result limit */
const DEFAULT_LIMIT = 10;

export class PgVectorMemoryBackend implements MemoryBackend {
  private readonly db: PgVectorDatabaseClient;
  private readonly embedding: EmbeddingService;
  private readonly decayFactor: number;
  private readonly decayStaleDays: number;

  constructor(
    db: PgVectorDatabaseClient,
    embeddingService: EmbeddingService,
    options?: {
      decayFactor?: number;
      decayStaleDays?: number;
    },
  ) {
    this.db = db;
    this.embedding = embeddingService;
    this.decayFactor = options?.decayFactor ?? DECAY_FACTOR;
    this.decayStaleDays = options?.decayStaleDays ?? DECAY_STALE_DAYS;
  }

  // ─── Store ───────────────────────────────────────────

  async store(
    agentId: string,
    content: string,
    type: MemoryType,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryEntry> {
    // Generate embedding for the content
    const vector = await this.embedding.embedSingle(content);
    const vectorStr = `[${vector.join(",")}]`;
    const metadataJson = JSON.stringify(metadata ?? {});

    const rows = (await this.db.$queryRaw`
      INSERT INTO "platform"."agent_memories" (
        "id", "agentId", "content", "memoryType", "importance",
        "accessCount", "metadata", "createdAt", "embedding"
      ) VALUES (
        gen_random_uuid()::text,
        ${agentId},
        ${content},
        ${type}::"platform"."MemoryType",
        0.5,
        0,
        ${metadataJson}::jsonb,
        NOW(),
        ${vectorStr}::vector
      )
      RETURNING
        "id", "agentId", "sessionId", "content", "memoryType",
        "importance", "accessCount", "lastAccessedAt", "expiresAt",
        "metadata", "createdAt"
    `) as MemoryRow[];

    return this.rowToEntry(rows[0]!);
  }

  // ─── Search ──────────────────────────────────────────

  async search(
    agentId: string,
    query: string,
    limit?: number,
    threshold?: number,
  ): Promise<MemorySearchResult[]> {
    const vector = await this.embedding.embedSingle(query);
    const vectorStr = `[${vector.join(",")}]`;
    const maxDistance = threshold ?? DEFAULT_THRESHOLD;
    const resultLimit = limit ?? DEFAULT_LIMIT;

    const rows = (await this.db.$queryRaw`
      SELECT
        "id", "agentId", "sessionId", "content", "memoryType",
        "importance", "accessCount", "lastAccessedAt", "expiresAt",
        "metadata", "createdAt",
        ("embedding" <=> ${vectorStr}::vector) AS "distance"
      FROM "platform"."agent_memories"
      WHERE "agentId" = ${agentId}
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
        AND ("embedding" <=> ${vectorStr}::vector) < ${maxDistance}
      ORDER BY "distance" ASC
      LIMIT ${resultLimit}
    `) as SearchRow[];

    return rows.map((row) => ({
      ...this.rowToEntry(row),
      score: 1 - row.distance, // Convert cosine distance to similarity score
    }));
  }

  // ─── Recall ──────────────────────────────────────────

  async recall(agentId: string, memoryId: string): Promise<MemoryEntry | null> {
    // Increment access count and update last accessed time
    const rows = (await this.db.$queryRaw`
      UPDATE "platform"."agent_memories"
      SET "accessCount" = "accessCount" + 1,
          "lastAccessedAt" = NOW()
      WHERE "id" = ${memoryId}
        AND "agentId" = ${agentId}
      RETURNING
        "id", "agentId", "sessionId", "content", "memoryType",
        "importance", "accessCount", "lastAccessedAt", "expiresAt",
        "metadata", "createdAt"
    `) as MemoryRow[];

    if (rows.length === 0) {
      return null;
    }

    return this.rowToEntry(rows[0]!);
  }

  // ─── Forget ──────────────────────────────────────────

  async forget(agentId: string, memoryId: string): Promise<void> {
    await this.db.$queryRaw`
      DELETE FROM "platform"."agent_memories"
      WHERE "id" = ${memoryId}
        AND "agentId" = ${agentId}
    `;
  }

  // ─── Get Recent ──────────────────────────────────────

  async getRecent(agentId: string, limit: number): Promise<MemoryEntry[]> {
    const rows = (await this.db.$queryRaw`
      SELECT
        "id", "agentId", "sessionId", "content", "memoryType",
        "importance", "accessCount", "lastAccessedAt", "expiresAt",
        "metadata", "createdAt"
      FROM "platform"."agent_memories"
      WHERE "agentId" = ${agentId}
        AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `) as MemoryRow[];

    return rows.map((row) => this.rowToEntry(row));
  }

  // ─── Decay ───────────────────────────────────────────

  async decay(agentId: string): Promise<number> {
    const staleDays = this.decayStaleDays;
    const factor = this.decayFactor;

    const result = (await this.db.$queryRaw`
      UPDATE "platform"."agent_memories"
      SET "importance" = "importance" * ${factor}
      WHERE "agentId" = ${agentId}
        AND (
          "lastAccessedAt" IS NULL
          OR "lastAccessedAt" < NOW() - INTERVAL '1 day' * ${staleDays}
        )
        AND "importance" > 0.01
      RETURNING "id"
    `) as Array<{ id: string }>;

    return result.length;
  }

  // ─── Helpers ─────────────────────────────────────────

  private rowToEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      agentId: row.agentId,
      sessionId: row.sessionId ?? undefined,
      content: row.content,
      memoryType: row.memoryType,
      importance: row.importance,
      accessCount: row.accessCount,
      lastAccessedAt: row.lastAccessedAt ?? undefined,
      expiresAt: row.expiresAt ?? undefined,
      metadata:
        typeof row.metadata === "string"
          ? (JSON.parse(row.metadata) as Record<string, unknown>)
          : row.metadata,
      createdAt: row.createdAt,
    };
  }
}
