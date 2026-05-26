import { db } from "@aizona/db";
import Redis from "ioredis";
import { z } from "zod";
import type { AgentCard } from "./agent-card";
import { AZADIDSchema, validateDID } from "./did";

// ──────────────────────────────────────────────────────
// DID Document
// ──────────────────────────────────────────────────────

export const DIDDocumentSchema = z.object({
  /** The DID this document describes (did:aza:network:identifier). */
  did: AZADIDSchema,
  /** The agent's Ed25519 public key in hex format. */
  publicKey: z.string().regex(/^[0-9a-f]{64}$/i),
  /** The agent's full Agent Card (optional, may be resolved separately). */
  agentCard: z.unknown().optional(), // AgentCard type but kept loose to avoid circular dep
  /** ISO 8601 timestamp when the document was created. */
  created: z.string().datetime(),
  /** ISO 8601 timestamp when the document was last updated. */
  updated: z.string().datetime(),
});

export type DIDDocument = z.infer<typeof DIDDocumentSchema>;

// ──────────────────────────────────────────────────────
// Resolver Configuration
// ──────────────────────────────────────────────────────

export interface DIDResolverConfig {
  /** Redis connection URL or ioredis options. Null to disable caching. */
  redis?: Redis | string | null;
  /** Cache TTL in seconds (default: 300 = 5 minutes). */
  cacheTtlSeconds?: number;
  /** Key prefix for Redis cache entries. */
  cacheKeyPrefix?: string;
}

const DEFAULT_CACHE_TTL = 300; // 5 minutes
const DEFAULT_CACHE_PREFIX = "aza:did:";

// ──────────────────────────────────────────────────────
// DID Resolver
// ──────────────────────────────────────────────────────

/**
 * Resolves AZA DIDs to DID Documents.
 *
 * Resolution strategy:
 * 1. Check Redis cache (if enabled)
 * 2. Query database
 * 3. Cache result in Redis
 * 4. Return DID Document
 *
 * The resolver manages its own Redis connection lifecycle and provides
 * methods for registration, resolution, and cache invalidation.
 */
export class DIDResolver {
  private redis: Redis | null = null;
  private readonly cacheTtlSeconds: number;
  private readonly cacheKeyPrefix: string;

  constructor(config: DIDResolverConfig = {}) {
    this.cacheTtlSeconds = config.cacheTtlSeconds ?? DEFAULT_CACHE_TTL;
    this.cacheKeyPrefix = config.cacheKeyPrefix ?? DEFAULT_CACHE_PREFIX;

    if (config.redis instanceof Redis) {
      this.redis = config.redis;
    } else if (typeof config.redis === "string") {
      this.redis = new Redis(config.redis);
    }
    // If redis is null or undefined, caching is disabled
  }

  /**
   * Resolve a DID to its DID Document.
   *
   * Checks the Redis cache first, then falls back to a database lookup.
   * Results are cached in Redis for the configured TTL.
   *
   * @param did - The DID to resolve.
   * @returns The DID Document, or null if not found.
   * @throws Error if the DID format is invalid.
   */
  async resolve(did: string): Promise<DIDDocument | null> {
    if (!validateDID(did)) {
      throw new Error(`Invalid DID format: "${did}"`);
    }

    // 1. Check Redis cache
    const cached = await this.getFromCache(did);
    if (cached) {
      return cached;
    }

    // 2. Query database
    const document = await this.resolveFromDB(did);
    if (!document) {
      return null;
    }

    // 3. Cache result
    await this.setInCache(did, document);

    return document;
  }

  /**
   * Register a new DID Document.
   *
   * Writes the document to the database and invalidates any cached version.
   *
   * @param did - The DID to register.
   * @param document - The DID Document to store.
   * @throws Error if the DID format is invalid or registration fails.
   */
  async register(did: string, document: DIDDocument): Promise<void> {
    if (!validateDID(did)) {
      throw new Error(`Invalid DID format: "${did}"`);
    }

    // Validate the document
    const validated = DIDDocumentSchema.parse(document);

    if (validated.did !== did) {
      throw new Error(`DID mismatch: document DID "${validated.did}" does not match "${did}"`);
    }

    // Write to database using raw SQL via Prisma
    // We store in a generic key-value approach on the aza schema
    // The actual table structure depends on migration, so we use $executeRaw
    await db.$executeRawUnsafe(
      `INSERT INTO aza.aza_did_documents (did, public_key, agent_card, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (did) DO UPDATE SET
         public_key = EXCLUDED.public_key,
         agent_card = EXCLUDED.agent_card,
         updated_at = EXCLUDED.updated_at`,
      validated.did,
      validated.publicKey,
      JSON.stringify(validated.agentCard ?? null),
      validated.created,
      validated.updated,
    );

    // Invalidate cache to ensure consistency
    await this.invalidate(did);
  }

  /**
   * Invalidate (remove) a cached DID Document.
   *
   * @param did - The DID whose cache entry should be removed.
   */
  async invalidate(did: string): Promise<void> {
    if (!this.redis) return;

    const key = this.cacheKey(did);
    await this.redis.del(key);
  }

  /**
   * Close the Redis connection (for graceful shutdown).
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  // ──────────────────────────────────────────────────────
  // Private Methods
  // ──────────────────────────────────────────────────────

  private cacheKey(did: string): string {
    return `${this.cacheKeyPrefix}${did}`;
  }

  private async getFromCache(did: string): Promise<DIDDocument | null> {
    if (!this.redis) return null;

    try {
      const key = this.cacheKey(did);
      const cached = await this.redis.get(key);
      if (!cached) return null;

      const parsed = JSON.parse(cached) as unknown;
      return DIDDocumentSchema.parse(parsed);
    } catch {
      // Cache miss or parse error - fall through to DB
      return null;
    }
  }

  private async setInCache(did: string, document: DIDDocument): Promise<void> {
    if (!this.redis) return;

    try {
      const key = this.cacheKey(did);
      const serialized = JSON.stringify(document);
      await this.redis.setex(key, this.cacheTtlSeconds, serialized);
    } catch {
      // Cache write failure is non-fatal - log in production
    }
  }

  private async resolveFromDB(did: string): Promise<DIDDocument | null> {
    try {
      const rows = await db.$queryRawUnsafe<
        Array<{
          did: string;
          public_key: string;
          agent_card: string | null;
          created_at: string;
          updated_at: string;
        }>
      >(
        `SELECT did, public_key, agent_card, created_at, updated_at
         FROM aza.aza_did_documents
         WHERE did = $1
         LIMIT 1`,
        did,
      );

      const row = rows[0];
      if (!row) return null;

      let agentCard: unknown = undefined;
      if (row.agent_card) {
        try {
          agentCard = JSON.parse(row.agent_card) as unknown;
        } catch {
          // Invalid agent card JSON - ignore
        }
      }

      return DIDDocumentSchema.parse({
        did: row.did,
        publicKey: row.public_key,
        agentCard,
        created: row.created_at,
        updated: row.updated_at,
      });
    } catch {
      // DB query failure
      return null;
    }
  }
}
