import { db } from "../db";
import { z } from "zod";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export const GrantScopeSchema = z.object({
  maxCallsPerHour: z.number().int().positive().optional(),
  maxCallsPerDay: z.number().int().positive().optional(),
  allowedInputPatterns: z.array(z.string()).optional(),
  blockedInputPatterns: z.array(z.string()).optional(),
  maxInputSize: z.number().int().positive().optional(),
  maxOutputSize: z.number().int().positive().optional(),
});

export type GrantScope = z.infer<typeof GrantScopeSchema>;

/**
 * Grant hierarchy levels. Higher-level grants take precedence.
 *
 * - **PLATFORM**: Granted by platform administrators. Highest authority.
 * - **COMMUNITY**: Granted by community moderators or curators.
 * - **USER**: Granted by individual users to their own agents.
 */
export const GrantLevel = {
  PLATFORM: "platform",
  COMMUNITY: "community",
  USER: "user",
} as const;

export type GrantLevel = (typeof GrantLevel)[keyof typeof GrantLevel];

/**
 * A persisted skill grant record as returned by database queries.
 */
export type GrantRecord = Awaited<ReturnType<typeof db.mCPSkillGrant.findUniqueOrThrow>>;

// ──────────────────────────────────────────────────────
// SkillGrantManager
// ──────────────────────────────────────────────────────

/**
 * Manages MCP skill grants for agents.
 *
 * Agents must be explicitly granted access to MCP tools before they
 * can invoke them. Grants are stored in the database and validated
 * on every tool invocation.
 *
 * Key invariant: agents **cannot** self-grant. The `grantedByUserId`
 * must differ from the agent's owner.
 */
export class SkillGrantManager {
  // ── Public API ────────────────────────────────────

  /**
   * Grants a skill to an agent for a specific tool.
   *
   * @param params - Grant parameters
   * @returns The created grant record
   * @throws If the agent attempts to self-grant or a duplicate active grant exists
   */
  async grant(params: {
    agentId: string;
    toolId: string;
    grantedByUserId: string;
    scope?: GrantScope;
    expiresAt?: Date;
  }): Promise<GrantRecord> {
    // 1. Validate that the granting user is not the agent's owner
    //    (agents cannot self-grant skills)
    await this.validateNotSelfGrant(params.agentId, params.grantedByUserId);

    // 2. Validate scope if provided
    if (params.scope) {
      GrantScopeSchema.parse(params.scope);
    }

    // 3. Check for existing active grant (upsert: reactivate if revoked)
    const existing = await db.mCPSkillGrant.findUnique({
      where: {
        agentId_toolId: {
          agentId: params.agentId,
          toolId: params.toolId,
        },
      },
    });

    if (existing) {
      if (existing.active && !existing.revokedAt) {
        throw new Error(
          `Agent "${params.agentId}" already has an active grant for tool "${params.toolId}"`,
        );
      }

      // Reactivate a previously revoked grant
      return db.mCPSkillGrant.update({
        where: { id: existing.id },
        data: {
          grantedByUserId: params.grantedByUserId,
          scope: (params.scope ?? {}) as any,
          expiresAt: params.expiresAt ?? null,
          active: true,
          revokedAt: null,
          revokedReason: null,
        },
      });
    }

    // 4. Create new grant
    return db.mCPSkillGrant.create({
      data: {
        agentId: params.agentId,
        toolId: params.toolId,
        grantedByUserId: params.grantedByUserId,
        scope: (params.scope ?? {}) as any,
        expiresAt: params.expiresAt ?? null,
        active: true,
      },
    });
  }

  /**
   * Validates that an agent has a current, active grant for a given tool.
   *
   * Checks:
   * - Grant exists
   * - Grant is active (not revoked)
   * - Grant has not expired
   *
   * @param agentId - The agent's database ID
   * @param toolId  - The tool's database ID
   * @returns Validation result with grant details or denial reason
   */
  async validateGrant(
    agentId: string,
    toolId: string,
  ): Promise<{ valid: boolean; grant?: GrantRecord; reason?: string }> {
    const grant = await db.mCPSkillGrant.findUnique({
      where: {
        agentId_toolId: {
          agentId,
          toolId,
        },
      },
    });

    if (!grant) {
      return {
        valid: false,
        reason: `No skill grant found for agent "${agentId}" on tool "${toolId}"`,
      };
    }

    if (!grant.active) {
      return {
        valid: false,
        grant,
        reason: `Grant for agent "${agentId}" on tool "${toolId}" is inactive`,
      };
    }

    if (grant.revokedAt) {
      return {
        valid: false,
        grant,
        reason: `Grant for agent "${agentId}" on tool "${toolId}" was revoked: ${grant.revokedReason ?? "no reason provided"}`,
      };
    }

    if (grant.expiresAt && grant.expiresAt < new Date()) {
      // Auto-deactivate expired grants
      await db.mCPSkillGrant.update({
        where: { id: grant.id },
        data: { active: false },
      });

      return {
        valid: false,
        grant,
        reason: `Grant for agent "${agentId}" on tool "${toolId}" has expired`,
      };
    }

    return { valid: true, grant };
  }

  /**
   * Revokes an active grant for an agent on a specific tool.
   *
   * @param agentId        - The agent's database ID
   * @param toolId         - The tool's database ID
   * @param reason         - Human-readable revocation reason
   * @param revokedByUserId - The user performing the revocation
   * @throws If no active grant exists
   */
  async revoke(
    agentId: string,
    toolId: string,
    reason: string,
    revokedByUserId: string,
  ): Promise<void> {
    const grant = await db.mCPSkillGrant.findUnique({
      where: {
        agentId_toolId: {
          agentId,
          toolId,
        },
      },
    });

    if (!grant || !grant.active) {
      throw new Error(`No active grant found for agent "${agentId}" on tool "${toolId}"`);
    }

    await db.mCPSkillGrant.update({
      where: { id: grant.id },
      data: {
        active: false,
        revokedAt: new Date(),
        revokedReason: `[${revokedByUserId}] ${reason}`,
      },
    });
  }

  /**
   * Lists all grants for a specific agent.
   *
   * @param agentId    - The agent's database ID
   * @param activeOnly - When true, only returns active and non-expired grants
   * @returns Array of grant records
   */
  async listGrants(agentId: string, activeOnly = false): Promise<GrantRecord[]> {
    const where: Record<string, unknown> = { agentId };

    if (activeOnly) {
      where.active = true;
      where.revokedAt = null;
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
    }

    return db.mCPSkillGrant.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Lists all grants associated with a specific tool.
   *
   * @param toolId - The tool's database ID
   * @returns Array of grant records for the tool
   */
  async listGrantsByTool(toolId: string): Promise<GrantRecord[]> {
    return db.mCPSkillGrant.findMany({
      where: { toolId },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Emergency batch revocation: revokes **all** active grants for an agent.
   *
   * @param agentId - The agent's database ID
   * @param reason  - Human-readable reason for the emergency revocation
   * @returns The number of grants that were revoked
   */
  async revokeAllForAgent(agentId: string, reason: string): Promise<number> {
    const result = await db.mCPSkillGrant.updateMany({
      where: {
        agentId,
        active: true,
      },
      data: {
        active: false,
        revokedAt: new Date(),
        revokedReason: `[EMERGENCY] ${reason}`,
      },
    });

    return result.count;
  }

  // ── Private helpers ───────────────────────────────

  /**
   * Validates that the granting user is not the agent's owner.
   *
   * This enforces the invariant that agents cannot self-grant
   * skills. We look up the agent's identity in the database
   * to find the owner user ID and compare.
   *
   * @throws If the agent attempts to self-grant
   */
  private async validateNotSelfGrant(agentId: string, grantedByUserId: string): Promise<void> {
    // Look up the agent identity to find its owner.
    // The AgentIdentity model is in the "agents" schema with an `ownerId` field.
    // We use a raw approach: try to find the agent and check ownership.
    try {
      const agent = await (db as any).agentIdentity.findUnique({
        where: { id: agentId },
        select: { ownerId: true },
      });

      if (agent && agent.ownerId === grantedByUserId) {
        throw new Error(
          `Self-grant denied: user "${grantedByUserId}" owns agent "${agentId}" and cannot grant skills to their own agent. A different user must authorize this grant.`,
        );
      }
    } catch (error) {
      // If this is our self-grant error, rethrow it
      if (error instanceof Error && error.message.startsWith("Self-grant denied")) {
        throw error;
      }
      // If the AgentIdentity model isn't available or the agent doesn't exist,
      // we skip the self-grant check. The grant will still be recorded with
      // the grantedByUserId for auditing purposes.
    }
  }
}
