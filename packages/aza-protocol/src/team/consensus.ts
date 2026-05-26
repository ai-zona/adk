import type Redis from "ioredis";
import { AZAError, AZAErrorCode } from "../types/errors";
import { ConsensusType } from "../types/team";

// ──────────────────────────────────────────────────────
// Consensus Engine
// ──────────────────────────────────────────────────────
// Implements four consensus mechanisms for team decision-making:
//   - COORDINATOR_DECIDES: single vote from coordinator
//   - MAJORITY_VOTE: > 50% of eligible votes approve
//   - UNANIMOUS: 100% of eligible votes approve
//   - WEIGHTED_VOTE: weighted sum > 50% of total weight
//
// Proposals and votes are stored in Redis for low-latency
// access. Proposals auto-expire after their deadline.
//
// Redis key conventions:
//   aza:consensus:<proposalId>          — proposal metadata
//   aza:consensus:<proposalId>:votes    — vote hash
//   aza:consensus:<proposalId>:members  — eligible member set
// ──────────────────────────────────────────────────────

/** Default proposal deadline: 24 hours. */
const DEFAULT_DEADLINE_MS = 24 * 60 * 60 * 1000;

/** Redis key TTL for proposal data: 7 days. */
const PROPOSAL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Redis key prefix for consensus proposals. */
const CONSENSUS_PREFIX = "aza:consensus";

/** A single vote cast by a team member. */
export interface Vote {
  voterDid: string;
  value: boolean;
  weight?: number;
  timestamp: number;
}

/** The result of a consensus process once decided. */
export interface ConsensusResult {
  approved: boolean;
  votes: Vote[];
  totalVotes: number;
  requiredVotes: number;
  consensusType: ConsensusType;
  decidedAt: number;
}

/** Input parameters for starting a consensus process. */
export interface ConsensusRequest {
  proposalId: string;
  teamId: string;
  proposerDid: string;
  description: string;
  options?: string[];
  deadline?: number;
}

/** Member info for consensus participation. */
export interface ConsensusMember {
  did: string;
  role: string;
  weight?: number;
}

/** Current voting status for a proposal. */
export interface VotingStatus {
  votes: Vote[];
  total: number;
  pending: string[];
}

/** Stored proposal metadata (serialized in Redis). */
interface ProposalData {
  proposalId: string;
  teamId: string;
  proposerDid: string;
  description: string;
  options?: string[];
  consensusType: ConsensusType;
  deadline: number;
  createdAt: number;
  canceled: boolean;
  memberDids: string[];
  memberWeights: Record<string, number>;
  coordinatorDid: string | null;
}

export class ConsensusEngine {
  constructor(private redis: Redis) {}

  // ────────────────────────────────────────────────────
  // Start Consensus
  // ────────────────────────────────────────────────────

  /**
   * Start a new consensus process.
   * Stores the proposal metadata and eligible members in Redis.
   *
   * @returns The proposal ID.
   */
  async startConsensus(
    request: ConsensusRequest,
    consensusType: ConsensusType,
    members: ConsensusMember[],
  ): Promise<string> {
    const { proposalId, teamId, proposerDid, description, options } = request;
    const deadline = request.deadline ?? Date.now() + DEFAULT_DEADLINE_MS;

    // Build member weight map
    const memberWeights: Record<string, number> = {};
    const memberDids: string[] = [];
    let coordinatorDid: string | null = null;

    for (const member of members) {
      memberDids.push(member.did);
      memberWeights[member.did] = member.weight ?? 1;
      if (member.role === "COORDINATOR") {
        coordinatorDid = member.did;
      }
    }

    const proposalData: ProposalData = {
      proposalId,
      teamId,
      proposerDid,
      description,
      options,
      consensusType,
      deadline,
      createdAt: Date.now(),
      canceled: false,
      memberDids,
      memberWeights,
      coordinatorDid,
    };

    // Store proposal metadata
    const proposalKey = this.proposalKey(proposalId);
    await this.redis.set(proposalKey, JSON.stringify(proposalData), "EX", PROPOSAL_TTL_SECONDS);

    return proposalId;
  }

  // ────────────────────────────────────────────────────
  // Voting
  // ────────────────────────────────────────────────────

  /**
   * Cast a vote on a proposal.
   * Validates that the voter is an eligible member and
   * has not already voted.
   */
  async vote(
    proposalId: string,
    voterDid: string,
    approve: boolean,
    weight?: number,
  ): Promise<void> {
    const proposal = await this.getProposalOrThrow(proposalId);

    if (proposal.canceled) {
      throw new AZAError(
        AZAErrorCode.TEAM_CONSENSUS_FAILED,
        `Proposal ${proposalId} has been canceled`,
        { details: { proposalId } },
      );
    }

    // Check deadline
    if (Date.now() > proposal.deadline) {
      throw new AZAError(AZAErrorCode.TEAM_CONSENSUS_FAILED, `Proposal ${proposalId} has expired`, {
        details: { proposalId, deadline: proposal.deadline },
      });
    }

    // Validate voter is an eligible member
    if (!proposal.memberDids.includes(voterDid)) {
      throw new AZAError(
        AZAErrorCode.TEAM_NOT_MEMBER,
        `Agent ${voterDid} is not eligible to vote on proposal ${proposalId}`,
        { details: { proposalId, voterDid } },
      );
    }

    // Check if already voted
    const votesKey = this.votesKey(proposalId);
    const existingVote = await this.redis.hget(votesKey, voterDid);
    if (existingVote !== null) {
      throw new AZAError(
        AZAErrorCode.TEAM_CONSENSUS_FAILED,
        `Agent ${voterDid} has already voted on proposal ${proposalId}`,
        { details: { proposalId, voterDid } },
      );
    }

    // Store the vote
    const voteData: Vote = {
      voterDid,
      value: approve,
      weight: weight ?? proposal.memberWeights[voterDid] ?? 1,
      timestamp: Date.now(),
    };

    await this.redis.hset(votesKey, voterDid, JSON.stringify(voteData));
    // Set TTL to match proposal
    await this.redis.expire(votesKey, PROPOSAL_TTL_SECONDS);
  }

  // ────────────────────────────────────────────────────
  // Consensus Check
  // ────────────────────────────────────────────────────

  /**
   * Check if consensus has been reached for a proposal.
   * Returns the result if consensus is reached, or null
   * if more votes are needed.
   */
  async checkConsensus(proposalId: string): Promise<ConsensusResult | null> {
    const proposal = await this.getProposalOrThrow(proposalId);
    const votes = await this.getVotes(proposalId);

    if (proposal.canceled) return null;

    switch (proposal.consensusType) {
      case ConsensusType.COORDINATOR_DECIDES:
        return this.checkCoordinatorDecides(proposal, votes);

      case ConsensusType.MAJORITY_VOTE:
        return this.checkMajorityVote(proposal, votes);

      case ConsensusType.UNANIMOUS:
        return this.checkUnanimous(proposal, votes);

      case ConsensusType.WEIGHTED_VOTE:
        return this.checkWeightedVote(proposal, votes);

      default:
        return null;
    }
  }

  // ────────────────────────────────────────────────────
  // Status
  // ────────────────────────────────────────────────────

  /**
   * Get the current voting status for a proposal.
   */
  async getStatus(proposalId: string): Promise<VotingStatus> {
    const proposal = await this.getProposalOrThrow(proposalId);
    const votes = await this.getVotes(proposalId);
    const votedDids = new Set(votes.map((v) => v.voterDid));
    const pending = proposal.memberDids.filter((did) => !votedDids.has(did));

    return {
      votes,
      total: proposal.memberDids.length,
      pending,
    };
  }

  // ────────────────────────────────────────────────────
  // Cancellation & Cleanup
  // ────────────────────────────────────────────────────

  /**
   * Cancel a proposal. This prevents further voting.
   */
  async cancel(proposalId: string): Promise<void> {
    const proposal = await this.getProposalOrThrow(proposalId);
    proposal.canceled = true;

    const proposalKey = this.proposalKey(proposalId);
    const ttl = await this.redis.ttl(proposalKey);
    await this.redis.set(
      proposalKey,
      JSON.stringify(proposal),
      "EX",
      ttl > 0 ? ttl : PROPOSAL_TTL_SECONDS,
    );
  }

  /**
   * Clean up expired proposals by checking all tracked proposals.
   * Returns the number of proposals cleaned up.
   *
   * Note: In practice, Redis TTL handles expiration automatically.
   * This method provides explicit cleanup of proposals past their
   * deadline that may still have TTL remaining.
   */
  async cleanupExpired(): Promise<number> {
    // Scan for consensus keys
    let cursor = "0";
    let cleaned = 0;
    const now = Date.now();

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        `${CONSENSUS_PREFIX}:*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        // Skip vote hash keys
        if (key.endsWith(":votes") || key.endsWith(":members")) continue;

        const raw = await this.redis.get(key);
        if (!raw) continue;

        try {
          const proposal = JSON.parse(raw) as ProposalData;
          if (proposal.deadline < now) {
            // Delete proposal and its votes
            const votesKey = `${key}:votes`;
            await this.redis.del(key, votesKey);
            cleaned++;
          }
        } catch {
          // Skip malformed entries
        }
      }
    } while (cursor !== "0");

    return cleaned;
  }

  // ────────────────────────────────────────────────────
  // Consensus Algorithms
  // ────────────────────────────────────────────────────

  /**
   * COORDINATOR_DECIDES: consensus is reached when the coordinator
   * casts a single vote.
   */
  private checkCoordinatorDecides(proposal: ProposalData, votes: Vote[]): ConsensusResult | null {
    const coordinatorVote = votes.find((v) => v.voterDid === proposal.coordinatorDid);
    if (!coordinatorVote) return null;

    return {
      approved: coordinatorVote.value,
      votes,
      totalVotes: votes.length,
      requiredVotes: 1,
      consensusType: ConsensusType.COORDINATOR_DECIDES,
      decidedAt: coordinatorVote.timestamp,
    };
  }

  /**
   * MAJORITY_VOTE: consensus is reached when > 50% of eligible
   * members have voted and the majority approves.
   * We check if enough votes are in to determine the result
   * definitively, or wait for the deadline.
   */
  private checkMajorityVote(proposal: ProposalData, votes: Vote[]): ConsensusResult | null {
    const totalMembers = proposal.memberDids.length;
    const majority = Math.floor(totalMembers / 2) + 1;

    const approvals = votes.filter((v) => v.value).length;
    const rejections = votes.filter((v) => !v.value).length;

    // Approved: majority approvals reached
    if (approvals >= majority) {
      return {
        approved: true,
        votes,
        totalVotes: votes.length,
        requiredVotes: majority,
        consensusType: ConsensusType.MAJORITY_VOTE,
        decidedAt: Date.now(),
      };
    }

    // Rejected: impossible for approvals to reach majority
    if (rejections >= majority) {
      return {
        approved: false,
        votes,
        totalVotes: votes.length,
        requiredVotes: majority,
        consensusType: ConsensusType.MAJORITY_VOTE,
        decidedAt: Date.now(),
      };
    }

    // Deadline passed: decide based on current votes
    if (Date.now() > proposal.deadline && votes.length > 0) {
      return {
        approved: approvals > rejections,
        votes,
        totalVotes: votes.length,
        requiredVotes: majority,
        consensusType: ConsensusType.MAJORITY_VOTE,
        decidedAt: Date.now(),
      };
    }

    return null;
  }

  /**
   * UNANIMOUS: consensus is reached when all eligible members
   * have voted and every vote is an approval.
   */
  private checkUnanimous(proposal: ProposalData, votes: Vote[]): ConsensusResult | null {
    const totalMembers = proposal.memberDids.length;

    // Any rejection means unanimous approval is impossible
    const hasRejection = votes.some((v) => !v.value);
    if (hasRejection) {
      return {
        approved: false,
        votes,
        totalVotes: votes.length,
        requiredVotes: totalMembers,
        consensusType: ConsensusType.UNANIMOUS,
        decidedAt: Date.now(),
      };
    }

    // All members must have voted
    if (votes.length >= totalMembers) {
      return {
        approved: true,
        votes,
        totalVotes: votes.length,
        requiredVotes: totalMembers,
        consensusType: ConsensusType.UNANIMOUS,
        decidedAt: Date.now(),
      };
    }

    // Deadline passed without all votes
    if (Date.now() > proposal.deadline) {
      return {
        approved: false,
        votes,
        totalVotes: votes.length,
        requiredVotes: totalMembers,
        consensusType: ConsensusType.UNANIMOUS,
        decidedAt: Date.now(),
      };
    }

    return null;
  }

  /**
   * WEIGHTED_VOTE: consensus is reached when the weighted sum
   * of approvals exceeds 50% of the total possible weight.
   */
  private checkWeightedVote(proposal: ProposalData, votes: Vote[]): ConsensusResult | null {
    // Calculate total possible weight
    let totalWeight = 0;
    for (const did of proposal.memberDids) {
      totalWeight += proposal.memberWeights[did] ?? 1;
    }

    const threshold = totalWeight / 2;

    // Calculate current approval and rejection weights
    let approvalWeight = 0;
    let rejectionWeight = 0;
    for (const vote of votes) {
      const weight = vote.weight ?? proposal.memberWeights[vote.voterDid] ?? 1;
      if (vote.value) {
        approvalWeight += weight;
      } else {
        rejectionWeight += weight;
      }
    }

    // Required votes is expressed as a count for the interface;
    // use the number of members whose votes would be needed
    const requiredVotes = Math.ceil(proposal.memberDids.length / 2) + 1;

    // Approved: approval weight exceeds threshold
    if (approvalWeight > threshold) {
      return {
        approved: true,
        votes,
        totalVotes: votes.length,
        requiredVotes,
        consensusType: ConsensusType.WEIGHTED_VOTE,
        decidedAt: Date.now(),
      };
    }

    // Rejected: rejection weight makes approval impossible
    if (rejectionWeight >= threshold) {
      return {
        approved: false,
        votes,
        totalVotes: votes.length,
        requiredVotes,
        consensusType: ConsensusType.WEIGHTED_VOTE,
        decidedAt: Date.now(),
      };
    }

    // Deadline passed: decide based on current weights
    if (Date.now() > proposal.deadline && votes.length > 0) {
      return {
        approved: approvalWeight > rejectionWeight,
        votes,
        totalVotes: votes.length,
        requiredVotes,
        consensusType: ConsensusType.WEIGHTED_VOTE,
        decidedAt: Date.now(),
      };
    }

    return null;
  }

  // ────────────────────────────────────────────────────
  // Internal Helpers
  // ────────────────────────────────────────────────────

  /**
   * Redis key for proposal metadata.
   */
  private proposalKey(proposalId: string): string {
    return `${CONSENSUS_PREFIX}:${proposalId}`;
  }

  /**
   * Redis key for the votes hash.
   */
  private votesKey(proposalId: string): string {
    return `${CONSENSUS_PREFIX}:${proposalId}:votes`;
  }

  /**
   * Retrieve and parse proposal data or throw.
   */
  private async getProposalOrThrow(proposalId: string): Promise<ProposalData> {
    const proposalKey = this.proposalKey(proposalId);
    const raw = await this.redis.get(proposalKey);

    if (!raw) {
      throw new AZAError(
        AZAErrorCode.TEAM_NOT_FOUND,
        `Consensus proposal ${proposalId} not found`,
        { details: { proposalId } },
      );
    }

    return JSON.parse(raw) as ProposalData;
  }

  /**
   * Retrieve all votes for a proposal.
   */
  private async getVotes(proposalId: string): Promise<Vote[]> {
    const votesKey = this.votesKey(proposalId);
    const rawVotes = await this.redis.hgetall(votesKey);

    const votes: Vote[] = [];
    for (const [, rawVote] of Object.entries(rawVotes)) {
      try {
        votes.push(JSON.parse(rawVote) as Vote);
      } catch {
        // Skip malformed vote entries
      }
    }

    return votes;
  }
}
