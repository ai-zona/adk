import { db } from "../db";
import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";
import { TeamMemberRole, TeamMemberStatus } from "../types/team";

// ──────────────────────────────────────────────────────
// Team Context
// ──────────────────────────────────────────────────────
// Shared mutable context for a team. Each key-value pair
// is persisted in AZATeamContext and cached in Redis.
//
// Write permissions are role-based: only certain roles
// can update certain key prefixes. The COORDINATOR can
// write to any key.
//
// Redis cache key format: aza:team:context:<teamId>:<key>
// ──────────────────────────────────────────────────────

/** The Prisma AZATeamContext record type. */
export type ContextRecord = Awaited<ReturnType<typeof db.aZATeamContext.findUniqueOrThrow>>;

/** Default TTL for cached context values (1 hour). */
const CACHE_TTL_SECONDS = 3600;

/** Redis key prefix for team context caching. */
const CONTEXT_CACHE_PREFIX = "aza:team:context";

/** Redis channel prefix for context update notifications. */
const CONTEXT_NOTIFY_PREFIX = "aza:team:context:notify";

/**
 * Role-based write permissions for context key categories.
 * Keys are matched by prefix: if a key starts with one of
 * these prefixes, only the listed roles can write to it.
 * Keys that do not match any prefix default to COORDINATOR-only.
 */
const WRITE_PERMISSIONS: Record<string, readonly string[]> = {
  shared_data: [TeamMemberRole.COORDINATOR, TeamMemberRole.WORKER],
  progress: [TeamMemberRole.COORDINATOR, TeamMemberRole.WORKER],
  decisions: [TeamMemberRole.COORDINATOR],
  config: [TeamMemberRole.COORDINATOR],
};

export class TeamContext {
  constructor(private redis: Redis) {}

  // ────────────────────────────────────────────────────
  // Write Operations
  // ────────────────────────────────────────────────────

  /**
   * Set a context value for a team.
   * Validates that the actor has write permission for the key.
   * Upserts the AZATeamContext record and updates the Redis cache.
   */
  async set(params: {
    teamId: string;
    key: string;
    value: unknown;
    updatedByDid: string;
  }): Promise<ContextRecord> {
    const { teamId, key, value, updatedByDid } = params;

    // Validate write permission
    const allowed = await this.canWrite(teamId, key, updatedByDid);
    if (!allowed) {
      throw new AZAError(
        AZAErrorCode.TEAM_PERMISSION_DENIED,
        `Agent ${updatedByDid} does not have write permission for key "${key}" in team ${teamId}`,
        { details: { teamId, key, updatedByDid } },
      );
    }

    // Upsert the context record
    // Find existing record by teamId + key
    const existing = await db.aZATeamContext.findFirst({
      where: { teamId, key },
    });

    let record: ContextRecord;
    if (existing) {
      record = await db.aZATeamContext.update({
        where: { id: existing.id },
        data: {
          value: value as any,
          updatedByDid,
          updatedAt: new Date(),
        },
      });
    } else {
      record = await db.aZATeamContext.create({
        data: {
          teamId,
          key,
          value: value as any,
          updatedByDid,
        },
      });
    }

    // Cache in Redis
    const cacheKey = this.cacheKey(teamId, key);
    await this.redis.set(cacheKey, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);

    // Publish update notification
    const notifyChannel = `${CONTEXT_NOTIFY_PREFIX}:${teamId}`;
    await this.redis.publish(
      notifyChannel,
      JSON.stringify({ teamId, key, updatedByDid, timestamp: Date.now() }),
    );

    return record;
  }

  // ────────────────────────────────────────────────────
  // Read Operations
  // ────────────────────────────────────────────────────

  /**
   * Get a single context value by key.
   * Checks Redis cache first, then falls back to the database.
   */
  async get(teamId: string, key: string): Promise<unknown | null> {
    // Check Redis cache first
    const cacheKey = this.cacheKey(teamId, key);
    const cached = await this.redis.get(cacheKey);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as unknown;
      } catch {
        // Cache value is corrupt; fall through to DB
      }
    }

    // Fall back to database
    const record = await db.aZATeamContext.findFirst({
      where: { teamId, key },
    });

    if (!record) return null;

    // Re-populate cache
    await this.redis.set(cacheKey, JSON.stringify(record.value), "EX", CACHE_TTL_SECONDS);

    return record.value;
  }

  /**
   * Get all context key-value pairs for a team.
   */
  async getAll(teamId: string): Promise<Record<string, unknown>> {
    const records = await db.aZATeamContext.findMany({
      where: { teamId },
    });

    const result: Record<string, unknown> = {};
    for (const record of records) {
      result[record.key] = record.value;
    }
    return result;
  }

  // ────────────────────────────────────────────────────
  // Delete Operations
  // ────────────────────────────────────────────────────

  /**
   * Delete a context key. Only the COORDINATOR can delete context entries.
   */
  async delete(teamId: string, key: string, actorDid: string): Promise<void> {
    // Only COORDINATOR can delete context entries
    const member = await db.aZATeamMember.findFirst({
      where: {
        teamId,
        agentDid: actorDid,
        role: TeamMemberRole.COORDINATOR as never,
        status: TeamMemberStatus.ACTIVE,
      },
    });

    if (!member) {
      throw new AZAError(
        AZAErrorCode.TEAM_PERMISSION_DENIED,
        `Only the coordinator can delete context keys in team ${teamId}`,
        { details: { teamId, key, actorDid } },
      );
    }

    const existing = await db.aZATeamContext.findFirst({
      where: { teamId, key },
    });

    if (!existing) {
      throw new AZAError(
        AZAErrorCode.TEAM_CONTEXT_NOT_FOUND,
        `Context key "${key}" not found in team ${teamId}`,
        { details: { teamId, key } },
      );
    }

    await db.aZATeamContext.delete({ where: { id: existing.id } });

    // Remove from Redis cache
    const cacheKey = this.cacheKey(teamId, key);
    await this.redis.del(cacheKey);

    // Publish deletion notification
    const notifyChannel = `${CONTEXT_NOTIFY_PREFIX}:${teamId}`;
    await this.redis.publish(
      notifyChannel,
      JSON.stringify({ teamId, key, deleted: true, actorDid, timestamp: Date.now() }),
    );
  }

  // ────────────────────────────────────────────────────
  // Permission Checks
  // ────────────────────────────────────────────────────

  /**
   * Check if an actor has write permission for a given key.
   * Looks up the member's role and checks against WRITE_PERMISSIONS.
   * The COORDINATOR can always write to any key.
   */
  async canWrite(teamId: string, key: string, actorDid: string): Promise<boolean> {
    const member = await db.aZATeamMember.findFirst({
      where: {
        teamId,
        agentDid: actorDid,
        status: TeamMemberStatus.ACTIVE,
      },
    });

    if (!member) return false;

    const role = member.role as string;

    // COORDINATOR can write to anything
    if (role === TeamMemberRole.COORDINATOR) return true;

    // Check role-based permissions by key prefix
    const keyCategory = this.getKeyCategory(key);
    const allowedRoles = WRITE_PERMISSIONS[keyCategory];

    if (!allowedRoles) {
      // No explicit permission: COORDINATOR-only (already handled above)
      return false;
    }

    return allowedRoles.includes(role);
  }

  // ────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────

  /**
   * Build the Redis cache key for a team context entry.
   */
  private cacheKey(teamId: string, key: string): string {
    return `${CONTEXT_CACHE_PREFIX}:${teamId}:${key}`;
  }

  /**
   * Extract the category prefix from a key.
   * The category is the portion before the first dot or underscore
   * that matches a known category in WRITE_PERMISSIONS.
   * Falls back to the full key if no separator is found.
   */
  private getKeyCategory(key: string): string {
    // Check exact match first
    if (key in WRITE_PERMISSIONS) return key;

    // Check if the key starts with a known prefix
    for (const prefix of Object.keys(WRITE_PERMISSIONS)) {
      if (key.startsWith(`${prefix}.`) || key.startsWith(`${prefix}_`) || key === prefix) {
        return prefix;
      }
    }

    // No match: default category (COORDINATOR-only)
    return key;
  }
}
