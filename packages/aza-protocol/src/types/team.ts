import { z } from "zod";

// ──────────────────────────────────────────────────────
// Team Member Role (aligned with Prisma AZATeamMemberRole)
// ──────────────────────────────────────────────────────

export const TeamMemberRole = {
  COORDINATOR: "COORDINATOR",
  WORKER: "WORKER",
  OBSERVER: "OBSERVER",
  AUDITOR: "AUDITOR",
} as const;

export type TeamMemberRole = (typeof TeamMemberRole)[keyof typeof TeamMemberRole];

export const TeamMemberRoleSchema = z.enum([
  TeamMemberRole.COORDINATOR,
  TeamMemberRole.WORKER,
  TeamMemberRole.OBSERVER,
  TeamMemberRole.AUDITOR,
]);

// ──────────────────────────────────────────────────────
// Team Status (aligned with Prisma AZATeamStatus)
// ──────────────────────────────────────────────────────

export const TeamStatus = {
  FORMING: "FORMING",
  ACTIVE: "ACTIVE",
  COMPLETING: "COMPLETING",
  DISSOLVED: "DISSOLVED",
  SUSPENDED: "SUSPENDED",
} as const;

export type TeamStatus = (typeof TeamStatus)[keyof typeof TeamStatus];

export const TeamStatusSchema = z.enum([
  TeamStatus.FORMING,
  TeamStatus.ACTIVE,
  TeamStatus.COMPLETING,
  TeamStatus.DISSOLVED,
  TeamStatus.SUSPENDED,
]);

// ──────────────────────────────────────────────────────
// Consensus Type (aligned with Prisma AZAConsensusType)
// ──────────────────────────────────────────────────────

export const ConsensusType = {
  COORDINATOR_DECIDES: "COORDINATOR_DECIDES",
  MAJORITY_VOTE: "MAJORITY_VOTE",
  UNANIMOUS: "UNANIMOUS",
  WEIGHTED_VOTE: "WEIGHTED_VOTE",
} as const;

export type ConsensusType = (typeof ConsensusType)[keyof typeof ConsensusType];

export const ConsensusTypeSchema = z.enum([
  ConsensusType.COORDINATOR_DECIDES,
  ConsensusType.MAJORITY_VOTE,
  ConsensusType.UNANIMOUS,
  ConsensusType.WEIGHTED_VOTE,
]);

// ──────────────────────────────────────────────────────
// Team Member Status
// ──────────────────────────────────────────────────────

export const TeamMemberStatus = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  REMOVED: "removed",
} as const;

export type TeamMemberStatus = (typeof TeamMemberStatus)[keyof typeof TeamMemberStatus];

export const TeamMemberStatusSchema = z.enum([
  TeamMemberStatus.ACTIVE,
  TeamMemberStatus.INACTIVE,
  TeamMemberStatus.REMOVED,
]);

// ──────────────────────────────────────────────────────
// Valid Team Status Transitions
// ──────────────────────────────────────────────────────

export const TEAM_TRANSITIONS: Record<TeamStatus, readonly TeamStatus[]> = {
  [TeamStatus.FORMING]: [TeamStatus.ACTIVE, TeamStatus.DISSOLVED],
  [TeamStatus.ACTIVE]: [TeamStatus.COMPLETING, TeamStatus.SUSPENDED, TeamStatus.DISSOLVED],
  [TeamStatus.COMPLETING]: [TeamStatus.DISSOLVED],
  [TeamStatus.DISSOLVED]: [],
  [TeamStatus.SUSPENDED]: [TeamStatus.ACTIVE, TeamStatus.DISSOLVED],
} as const;

export function isValidTeamTransition(from: TeamStatus, to: TeamStatus): boolean {
  return TEAM_TRANSITIONS[from].includes(to);
}

// ──────────────────────────────────────────────────────
// Budget
// ──────────────────────────────────────────────────────

export const TeamBudgetSchema = z.object({
  total: z.string(), // String to avoid floating-point issues
  spent: z.string(),
  currency: z.string(), // "SOL", "USDC", "AZA"
});

export type TeamBudget = z.infer<typeof TeamBudgetSchema>;

// ──────────────────────────────────────────────────────
// Team Member
// ──────────────────────────────────────────────────────

export const TeamMemberSchema = z.object({
  id: z.string(),
  teamId: z.string().uuid(),
  agentDid: z.string(),
  role: TeamMemberRoleSchema,
  skills: z.array(z.string()),
  status: TeamMemberStatusSchema.default("active"),
  joinedAt: z.number(), // Unix timestamp ms
  leftAt: z.number().optional(),
});

export type TeamMember = z.infer<typeof TeamMemberSchema>;

// ──────────────────────────────────────────────────────
// Team Configuration
// ──────────────────────────────────────────────────────

export const TeamConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  mission: z.string().max(5000).optional(),
  coordinatorDid: z.string(),
  consensusType: ConsensusTypeSchema.default("COORDINATOR_DECIDES"),
  budget: TeamBudgetSchema.optional(),
  status: TeamStatusSchema.default("FORMING"),
  maxMembers: z.number().int().positive().optional(),
  autoDissolve: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.number(), // Unix timestamp ms
  updatedAt: z.number(),
  dissolvedAt: z.number().optional(),
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

// ──────────────────────────────────────────────────────
// Shared Context (team-level mutable state)
// ──────────────────────────────────────────────────────

export const SharedContextSchema = z.object({
  id: z.string(),
  teamId: z.string().uuid(),
  key: z.string().min(1).max(200),
  value: z.unknown(),
  updatedByDid: z.string(),
  updatedAt: z.number(), // Unix timestamp ms
  createdAt: z.number(),
});

export type SharedContext = z.infer<typeof SharedContextSchema>;

// ──────────────────────────────────────────────────────
// Team Message Payloads
// ──────────────────────────────────────────────────────

export const TeamInvitePayloadSchema = z.object({
  teamId: z.string().uuid(),
  teamName: z.string(),
  mission: z.string().optional(),
  role: TeamMemberRoleSchema,
  requiredSkills: z.array(z.string()).optional(),
  budget: TeamBudgetSchema.optional(),
  message: z.string().max(2000).optional(),
});

export type TeamInvitePayload = z.infer<typeof TeamInvitePayloadSchema>;

export const TeamAcceptPayloadSchema = z.object({
  teamId: z.string().uuid(),
  skills: z.array(z.string()),
  message: z.string().max(2000).optional(),
});

export type TeamAcceptPayload = z.infer<typeof TeamAcceptPayloadSchema>;

export const TeamDeclinePayloadSchema = z.object({
  teamId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

export type TeamDeclinePayload = z.infer<typeof TeamDeclinePayloadSchema>;

export const TeamKickPayloadSchema = z.object({
  teamId: z.string().uuid(),
  agentDid: z.string(),
  reason: z.string().max(2000).optional(),
});

export type TeamKickPayload = z.infer<typeof TeamKickPayloadSchema>;

export const TeamDissolvePayloadSchema = z.object({
  teamId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
  finalReport: z.record(z.unknown()).optional(),
});

export type TeamDissolvePayload = z.infer<typeof TeamDissolvePayloadSchema>;
