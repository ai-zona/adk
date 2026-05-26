import { randomUUID } from "node:crypto";
import { db } from "../db";
import type Redis from "ioredis";
import { RedisStreamTransport } from "../transport/redis-streams";
import { AZAError, AZAErrorCode } from "../types/errors";
import type { AZAEnvelope } from "../types/messages";
import { AZAMessageType } from "../types/messages";
import {
  ConsensusType,
  TeamMemberRole,
  TeamMemberStatus,
  TeamStatus,
  isValidTeamTransition,
} from "../types/team";
import type { TeamDissolvePayload, TeamInvitePayload, TeamKickPayload } from "../types/team";

// ──────────────────────────────────────────────────────
// Team Manager
// ──────────────────────────────────────────────────────
// High-level team lifecycle operations backed by Prisma
// for durable storage and Redis Streams for real-time
// message distribution.
//
// Invariants:
//   - Only COORDINATOR can invite, kick, dissolve, and
//     transition team status
//   - Every lifecycle event is published to the team stream
//   - Status transitions follow TEAM_TRANSITIONS rules
//   - Terminal state (DISSOLVED) is immutable
// ──────────────────────────────────────────────────────

/** The Prisma AZATeam record type. */
export type TeamRecord = Awaited<ReturnType<typeof db.aZATeam.findUniqueOrThrow>>;

/** The Prisma AZATeamMember record type. */
export type MemberRecord = Awaited<ReturnType<typeof db.aZATeamMember.findUniqueOrThrow>>;

/** Parameters for listing teams with cursor-based pagination. */
export interface TeamListParams {
  coordinatorDid?: string;
  status?: TeamStatus;
  cursor?: string;
  limit?: number;
}

export class TeamManager {
  private transport: RedisStreamTransport;

  constructor(private redis: Redis) {
    this.transport = new RedisStreamTransport(redis);
  }

  // ────────────────────────────────────────────────────
  // Team Creation
  // ────────────────────────────────────────────────────

  /**
   * Create a new team and add the coordinator as the first member.
   * The team starts in FORMING status.
   */
  async createTeam(params: {
    name: string;
    mission?: string;
    coordinatorDid: string;
    consensusType?: ConsensusType;
    maxMembers?: number;
    autoDissolve?: boolean;
  }): Promise<TeamRecord> {
    const teamId = randomUUID();
    const now = new Date();

    const team = await db.aZATeam.create({
      data: {
        id: teamId,
        name: params.name,
        mission: params.mission ?? null,
        coordinatorDid: params.coordinatorDid,
        consensusType: (params.consensusType ?? ConsensusType.COORDINATOR_DECIDES) as never,
        budget: null as any,
        status: TeamStatus.FORMING as never,
        maxMembers: params.maxMembers ?? null,
        autoDissolve: params.autoDissolve ?? true,
        metadata: {} as any,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Add the coordinator as the first team member
    await db.aZATeamMember.create({
      data: {
        id: randomUUID(),
        teamId,
        agentDid: params.coordinatorDid,
        role: TeamMemberRole.COORDINATOR as never,
        skills: [],
        status: TeamMemberStatus.ACTIVE,
        joinedAt: now,
      },
    });

    return team;
  }

  // ────────────────────────────────────────────────────
  // Invitations
  // ────────────────────────────────────────────────────

  /**
   * Invite an agent to join the team. Only the COORDINATOR can invite.
   * Publishes a team.invite message to the team stream.
   */
  async invite(
    teamId: string,
    agentDid: string,
    role?: TeamMemberRole,
    inviterDid?: string,
  ): Promise<void> {
    const team = await this.getTeamOrThrow(teamId);

    // Only allow invites while FORMING or ACTIVE
    if (team.status !== TeamStatus.FORMING && team.status !== TeamStatus.ACTIVE) {
      throw new AZAError(
        AZAErrorCode.TEAM_DISSOLVED,
        `Cannot invite to team ${teamId}: team status is ${team.status}`,
        { details: { teamId, status: team.status } },
      );
    }

    // Verify inviter is the coordinator
    if (inviterDid) {
      await this.assertCoordinator(teamId, inviterDid);
    }

    // Check agent is not already a member
    const existing = await db.aZATeamMember.findFirst({
      where: {
        teamId,
        agentDid,
        status: TeamMemberStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new AZAError(
        AZAErrorCode.TEAM_ALREADY_MEMBER,
        `Agent ${agentDid} is already a member of team ${teamId}`,
        { details: { teamId, agentDid } },
      );
    }

    // Check maxMembers limit
    if (team.maxMembers) {
      const memberCount = await db.aZATeamMember.count({
        where: { teamId, status: TeamMemberStatus.ACTIVE },
      });
      if (memberCount >= team.maxMembers) {
        throw new AZAError(
          AZAErrorCode.TEAM_FULL,
          `Team ${teamId} has reached its maximum of ${team.maxMembers} members`,
          { details: { teamId, maxMembers: team.maxMembers, currentCount: memberCount } },
        );
      }
    }

    // Publish team.invite message via Redis
    const payload: TeamInvitePayload = {
      teamId,
      teamName: team.name,
      mission: team.mission ?? undefined,
      role: (role ?? TeamMemberRole.WORKER) as TeamInvitePayload["role"],
    };

    const envelope = this.buildEnvelope(
      inviterDid ?? team.coordinatorDid,
      agentDid,
      AZAMessageType.TEAM_INVITE,
      payload,
      teamId,
    );

    await this.transport.publish(RedisStreamTransport.teamStream(teamId), envelope);
  }

  /**
   * Accept a team invitation: creates the member record and
   * optionally transitions from FORMING to ACTIVE.
   */
  async acceptInvite(teamId: string, agentDid: string, skills?: string[]): Promise<void> {
    const team = await this.getTeamOrThrow(teamId);

    // Check not already a member
    const existing = await db.aZATeamMember.findFirst({
      where: {
        teamId,
        agentDid,
        status: TeamMemberStatus.ACTIVE,
      },
    });
    if (existing) {
      throw new AZAError(
        AZAErrorCode.TEAM_ALREADY_MEMBER,
        `Agent ${agentDid} is already a member of team ${teamId}`,
        { details: { teamId, agentDid } },
      );
    }

    // Check maxMembers
    if (team.maxMembers) {
      const memberCount = await db.aZATeamMember.count({
        where: { teamId, status: TeamMemberStatus.ACTIVE },
      });
      if (memberCount >= team.maxMembers) {
        throw new AZAError(
          AZAErrorCode.TEAM_FULL,
          `Team ${teamId} has reached its maximum of ${team.maxMembers} members`,
          { details: { teamId, maxMembers: team.maxMembers } },
        );
      }
    }

    // Create the member record
    await db.aZATeamMember.create({
      data: {
        id: randomUUID(),
        teamId,
        agentDid,
        role: TeamMemberRole.WORKER as never,
        skills: skills ?? [],
        status: TeamMemberStatus.ACTIVE,
        joinedAt: new Date(),
      },
    });

    // Publish team.accept message
    const envelope = this.buildEnvelope(
      agentDid,
      team.coordinatorDid,
      AZAMessageType.TEAM_ACCEPT,
      { teamId, skills: skills ?? [] },
      teamId,
    );
    await this.transport.publish(RedisStreamTransport.teamStream(teamId), envelope);

    // If FORMING and maxMembers is reached, auto-transition to ACTIVE
    if (team.status === TeamStatus.FORMING && team.maxMembers) {
      const currentCount = await db.aZATeamMember.count({
        where: { teamId, status: TeamMemberStatus.ACTIVE },
      });
      if (currentCount >= team.maxMembers) {
        await this.transitionStatusInternal(teamId, TeamStatus.ACTIVE);
      }
    }
  }

  /**
   * Decline a team invitation.
   * Publishes a team.decline message to the team stream.
   */
  async declineInvite(teamId: string, agentDid: string): Promise<void> {
    const team = await this.getTeamOrThrow(teamId);

    const envelope = this.buildEnvelope(
      agentDid,
      team.coordinatorDid,
      AZAMessageType.TEAM_DECLINE,
      { teamId },
      teamId,
    );
    await this.transport.publish(RedisStreamTransport.teamStream(teamId), envelope);
  }

  // ────────────────────────────────────────────────────
  // Member Removal
  // ────────────────────────────────────────────────────

  /**
   * Kick a member from the team. Only the COORDINATOR can kick.
   * Updates the member status to "removed".
   */
  async kickMember(teamId: string, agentDid: string, kickerDid: string): Promise<void> {
    await this.assertCoordinator(teamId, kickerDid);

    // Cannot kick yourself (the coordinator)
    if (agentDid === kickerDid) {
      throw new AZAError(
        AZAErrorCode.TEAM_PERMISSION_DENIED,
        "Coordinator cannot kick themselves; use dissolveTeam instead",
        { details: { teamId, agentDid } },
      );
    }

    const member = await db.aZATeamMember.findFirst({
      where: { teamId, agentDid, status: TeamMemberStatus.ACTIVE },
    });
    if (!member) {
      throw new AZAError(
        AZAErrorCode.TEAM_NOT_MEMBER,
        `Agent ${agentDid} is not an active member of team ${teamId}`,
        { details: { teamId, agentDid } },
      );
    }

    await db.aZATeamMember.update({
      where: { id: member.id },
      data: {
        status: TeamMemberStatus.REMOVED,
        leftAt: new Date(),
      },
    });

    // Publish team.kick message
    const payload: TeamKickPayload = {
      teamId,
      agentDid,
    };

    const envelope = this.buildEnvelope(
      kickerDid,
      agentDid,
      AZAMessageType.TEAM_KICK,
      payload,
      teamId,
    );
    await this.transport.publish(RedisStreamTransport.teamStream(teamId), envelope);
  }

  /**
   * Leave a team voluntarily.
   * Coordinators cannot leave; they must dissolve the team.
   */
  async leaveTeam(teamId: string, agentDid: string): Promise<void> {
    const member = await db.aZATeamMember.findFirst({
      where: { teamId, agentDid, status: TeamMemberStatus.ACTIVE },
    });
    if (!member) {
      throw new AZAError(
        AZAErrorCode.TEAM_NOT_MEMBER,
        `Agent ${agentDid} is not an active member of team ${teamId}`,
        { details: { teamId, agentDid } },
      );
    }

    if (member.role === TeamMemberRole.COORDINATOR) {
      throw new AZAError(
        AZAErrorCode.TEAM_COORDINATOR_REQUIRED,
        "Coordinator cannot leave the team; use dissolveTeam instead",
        { details: { teamId, agentDid } },
      );
    }

    await db.aZATeamMember.update({
      where: { id: member.id },
      data: {
        status: TeamMemberStatus.INACTIVE,
        leftAt: new Date(),
      },
    });

    // Publish a decline message to signal the departure
    const team = await this.getTeamOrThrow(teamId);
    const envelope = this.buildEnvelope(
      agentDid,
      team.coordinatorDid,
      AZAMessageType.TEAM_DECLINE,
      { teamId, reason: "Agent left voluntarily" },
      teamId,
    );
    await this.transport.publish(RedisStreamTransport.teamStream(teamId), envelope);

    // If autoDissolve and no active workers remain, dissolve the team
    if (team.autoDissolve) {
      const activeCount = await db.aZATeamMember.count({
        where: {
          teamId,
          status: TeamMemberStatus.ACTIVE,
          role: { not: TeamMemberRole.COORDINATOR as never },
        },
      });
      if (activeCount === 0 && team.status !== TeamStatus.DISSOLVED) {
        await this.dissolveTeam(teamId, team.coordinatorDid);
      }
    }
  }

  // ────────────────────────────────────────────────────
  // Team Dissolution
  // ────────────────────────────────────────────────────

  /**
   * Dissolve the team. Only the COORDINATOR can dissolve.
   * Transitions to DISSOLVED and sets dissolvedAt.
   */
  async dissolveTeam(teamId: string, coordinatorDid: string): Promise<void> {
    const team = await this.getTeamOrThrow(teamId);
    await this.assertCoordinator(teamId, coordinatorDid);

    if (team.status === TeamStatus.DISSOLVED) {
      throw new AZAError(AZAErrorCode.TEAM_DISSOLVED, `Team ${teamId} is already dissolved`, {
        details: { teamId },
      });
    }

    await db.aZATeam.update({
      where: { id: teamId },
      data: {
        status: TeamStatus.DISSOLVED as never,
        dissolvedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Mark all active members as inactive
    await db.aZATeamMember.updateMany({
      where: { teamId, status: TeamMemberStatus.ACTIVE },
      data: {
        status: TeamMemberStatus.INACTIVE,
        leftAt: new Date(),
      },
    });

    // Publish team.dissolve message
    const payload: TeamDissolvePayload = {
      teamId,
    };

    const envelope = this.buildEnvelope(
      coordinatorDid,
      null,
      AZAMessageType.TEAM_DISSOLVE,
      payload,
      teamId,
    );
    await this.transport.publish(RedisStreamTransport.teamStream(teamId), envelope);
  }

  // ────────────────────────────────────────────────────
  // Status Transitions
  // ────────────────────────────────────────────────────

  /**
   * Transition the team to a new status. Only the COORDINATOR can
   * trigger status transitions. The transition must be valid per
   * TEAM_TRANSITIONS rules.
   */
  async transitionStatus(
    teamId: string,
    targetStatus: TeamStatus,
    actorDid: string,
  ): Promise<TeamRecord> {
    await this.assertCoordinator(teamId, actorDid);
    return this.transitionStatusInternal(teamId, targetStatus);
  }

  // ────────────────────────────────────────────────────
  // Queries
  // ────────────────────────────────────────────────────

  /**
   * Get a single team by ID.
   */
  async getTeam(teamId: string): Promise<TeamRecord | null> {
    return db.aZATeam.findUnique({ where: { id: teamId } });
  }

  /**
   * Get a team with its active members.
   */
  async getTeamWithMembers(
    teamId: string,
  ): Promise<(TeamRecord & { members: MemberRecord[] }) | null> {
    const team = await db.aZATeam.findUnique({
      where: { id: teamId },
      include: { members: { where: { status: TeamMemberStatus.ACTIVE } } },
    });
    return team as (TeamRecord & { members: MemberRecord[] }) | null;
  }

  /**
   * List teams with optional filtering and cursor-based pagination.
   */
  async listTeams(
    params?: TeamListParams,
  ): Promise<{ teams: TeamRecord[]; nextCursor: string | null }> {
    const limit = params?.limit ?? 20;

    const where: Record<string, unknown> = {};
    if (params?.coordinatorDid) where.coordinatorDid = params.coordinatorDid;
    if (params?.status) where.status = params.status;

    const teams = await db.aZATeam.findMany({
      where: {
        ...where,
        ...(params?.cursor ? { id: { gt: params.cursor } } : {}),
      } as any,
      orderBy: { createdAt: "asc" },
      take: limit + 1,
    });

    let nextCursor: string | null = null;
    if (teams.length > limit) {
      teams.pop();
      const lastTeam = teams[teams.length - 1];
      nextCursor = lastTeam ? lastTeam.id : null;
    }

    return { teams, nextCursor };
  }

  /**
   * Get all teams that an agent is an active member of.
   */
  async getTeamsForAgent(agentDid: string): Promise<TeamRecord[]> {
    const memberships = await db.aZATeamMember.findMany({
      where: { agentDid, status: TeamMemberStatus.ACTIVE },
      select: { teamId: true },
    });

    if (memberships.length === 0) return [];

    const teamIds = memberships.map((m: { teamId: string }) => m.teamId);
    return db.aZATeam.findMany({
      where: { id: { in: teamIds } },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Get all active members of a team.
   */
  async getMembers(teamId: string): Promise<MemberRecord[]> {
    return db.aZATeamMember.findMany({
      where: { teamId, status: TeamMemberStatus.ACTIVE },
    });
  }

  // ────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────

  /**
   * Internal status transition without actor validation.
   * Used for auto-transitions (e.g., FORMING -> ACTIVE when full).
   */
  private async transitionStatusInternal(
    teamId: string,
    targetStatus: TeamStatus,
  ): Promise<TeamRecord> {
    const team = await this.getTeamOrThrow(teamId);
    const currentStatus = team.status as TeamStatus;

    if (!isValidTeamTransition(currentStatus, targetStatus)) {
      throw new AZAError(
        AZAErrorCode.TEAM_PERMISSION_DENIED,
        `Invalid team status transition from ${currentStatus} to ${targetStatus}`,
        { details: { teamId, currentStatus, targetStatus } },
      );
    }

    const updateData: Record<string, unknown> = {
      status: targetStatus as never,
      updatedAt: new Date(),
    };

    if (targetStatus === TeamStatus.DISSOLVED) {
      updateData.dissolvedAt = new Date();
    }

    return db.aZATeam.update({
      where: { id: teamId },
      data: updateData as any,
    });
  }

  /**
   * Fetch a team or throw TEAM_NOT_FOUND.
   */
  private async getTeamOrThrow(teamId: string): Promise<TeamRecord> {
    const team = await db.aZATeam.findUnique({ where: { id: teamId } });
    if (!team) {
      throw new AZAError(AZAErrorCode.TEAM_NOT_FOUND, `Team ${teamId} not found`, {
        details: { teamId },
      });
    }
    return team;
  }

  /**
   * Assert that an actor is the COORDINATOR of a team.
   */
  private async assertCoordinator(teamId: string, actorDid: string): Promise<void> {
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
        `Agent ${actorDid} is not the coordinator of team ${teamId}`,
        { details: { teamId, actorDid } },
      );
    }
  }

  /**
   * Build a protocol envelope for a given message type and payload.
   */
  private buildEnvelope(
    from: string,
    to: string | null,
    type: (typeof AZAMessageType)[keyof typeof AZAMessageType],
    payload: unknown,
    teamId: string,
  ): AZAEnvelope {
    return {
      id: randomUUID(),
      from,
      to: to ?? null,
      correlationId: teamId,
      type,
      payload,
      timestamp: Date.now(),
      priority: "NORMAL",
      metadata: {
        protocolVersion: "2.0.0",
        team: teamId,
      },
    } as AZAEnvelope;
  }
}
