import type { EntitlementRef, SkillKind } from "../capabilities/identifiers.js";

/**
 * WorkspaceManifest — the durable JSON document the architect emits and
 * the hydrator consumes to provision a workspace.
 *
 * Versioning rule: COMMITTED manifests are immutable. Edits create a new
 * version with parentId set to the prior version (handled at the DB
 * layer, not here).
 */
export interface WorkspaceManifest {
  apiVersion: "aizona.dev/v1";
  kind: "WorkspaceManifest";
  metadata: ManifestMetadata;
  spec: ManifestSpec;
  entitlements: ManifestEntitlements;
  loadingSequence: ManifestLoadingSequence;
  /** Wave 2: Voice channel configuration for this workspace */
  voice?: { inputProvider: string; outputProvider: string };
  /** Wave 2: Import provenance when manifest was created by importing from an external source */
  importProvenance?: { source: string; importedAt: string };
  /** Wave 2: ID of the workspace this was duplicated from */
  duplicatedFrom?: string;
}

export interface ManifestMetadata {
  workspaceId: string;
  title: string;
  summary: string;
  /** e.g. "aizona/author-publishing-v1" if hydrated from a recipe */
  recipeRef?: string;
  /** User-supplied goal in their own words; preserved verbatim. */
  goalStatement: string;
}

export interface ManifestSpec {
  agents: ManifestAgent[];
  teams: ManifestTeam[];
  skills: ManifestSkill[];
  tools: ManifestTool[];
  dataApis: ManifestDataApi[];
  knowledge: ManifestKnowledge[];
  sops: ManifestSop[];
  channels: ManifestChannel[];
  secrets: ManifestSecret[];
  sandbox: ManifestSandbox;
}

export interface ManifestAgent {
  /** Stable slug — e.g. "companion-author" or "manuscript-reviewer" */
  slug: string;
  /** Source of truth for the agent definition */
  source: "PLATFORM" | "MARKETPLACE" | "CUSTOM_ADK";
  /** Marketplace agent ID when source = MARKETPLACE */
  marketplaceAgentId?: string;
  /** Per-workspace display name override */
  displayName?: string;
  /** Per-workspace prompt extension appended to the system prompt */
  customInstructions?: string;
  /** Free-form per-workspace tuning; stored on WorkspaceAgent.customConfig */
  customConfig?: Record<string, unknown>;
  /** Optional canvas position */
  position?: { x: number; y: number };
  /** Wave 2: LLM inference tuning overrides for this agent */
  config?: { temperature?: number; maxTokens?: number; model?: string; [k: string]: unknown };
  /** Wave 2: Sample input/expected-output pairs for testing this agent */
  testFixtures?: Array<{ input: unknown; expected?: unknown }>;
  /** Wave 2: Provenance metadata when this agent was imported from an external source */
  importedFrom?: { source: string; importedAt: string; checksum?: string };
}

export interface ManifestTeam {
  /** Unique within the manifest */
  name: string;
  /** Slug of the agent acting as coordinator */
  coordinator: string;
  /** Slugs of member agents */
  members: string[];
  /** Coordinator | pipeline | parallel */
  executionMode?: "coordinator" | "pipeline" | "parallel";
}

export interface ManifestSkill {
  /** CommunitySkill slug */
  skillRef: string;
  /** Provenance hint — hydrator validates against the actual row */
  provenance:
    | "PLATFORM_CURATED"
    | "COMMUNITY_VERIFIED"
    | "COMMUNITY_UNVERIFIED"
    | "MCP_WRAPPED"
    | "LLM_GENERATED";
  /** Agents allowed to invoke this skill */
  allowedAgents?: string[];
  /** Override execution mode if the skill row says INLINE but the manifest forces SANDBOX */
  forceSandbox?: boolean;
  /** Wave 2: Discriminator for skill implementation type */
  kind?: SkillKind;
  /** Wave 2: Approval cooling-off period after auto-generated skill evolution */
  coolingOff?: { state: "PENDING" | "APPROVED" | "REJECTED"; until: string };
  /** Wave 2: Sample input/expected-output pairs for testing this skill */
  testFixtures?: Array<{ input: unknown; expected?: unknown }>;
}

export interface ManifestTool {
  /** Host-function ID from CAPABILITY_IDS.HOST_FN */
  hostFn: string;
  /** Allowed-list of arguments for the host fn (e.g. allowed http.fetch domains) */
  argAllowlist?: Record<string, unknown>;
}

export interface ManifestDataApi {
  /** DataApiConnector.slug */
  slug: string;
  /** false = surface unlock card the moment user asks; not needed for v1 spawn */
  required: boolean;
  /** Conversation event slug at which the architect should surface the unlock card */
  surfaceUnlockAt?: string;
}

export interface ManifestKnowledge {
  slug: string;
  description: string;
  mode: "user-uploaded" | "system-managed" | "platform-curated";
  /** Prebuilt KB ID when mode = platform-curated */
  prebuiltKbId?: string;
}

export interface ManifestSop {
  /** Stable slug within manifest */
  slug: string;
  title: string;
  description: string;
  /** Ordered list of step descriptors stored on WorkspaceSOPStep */
  steps: ManifestSopStep[];
  /** Trigger conditions; matches WorkspaceSOP.trigger schema */
  trigger?:
    | { type: "manual" }
    | { type: "cron"; expression: string }
    | { type: "event"; eventName: string };
}

export interface ManifestSopStep {
  kind: "INSTRUCTION" | "AGENT_TASK" | "APPROVAL_GATE" | "CONDITION" | "PARALLEL";
  /** Free-form per kind; the SOP step writer interprets */
  config: Record<string, unknown>;
}

export interface ManifestChannel {
  name: string;
  kind: "GENERAL" | "RECIPE" | "DM" | "SYSTEM";
  /** Slugs of agents invited to this channel */
  agentParticipants?: string[];
}

export interface ManifestSecret {
  key: string;
  scope: "WORKSPACE" | "TEAM" | "AGENT";
  /** TeamId or agentId when scope ≠ WORKSPACE; resolved by the hydrator */
  scopeRef?: string;
  description?: string;
  /** Set true when the secret value will be supplied at unlock time, not at manifest authoring */
  defer: boolean;
}

export interface ManifestSandbox {
  memoryLimitMb: number;
  cpuLimitMs: number;
  /** Subset of CAPABILITY_IDS.HOST_FN values */
  hostFnAllowlist: string[];
  /** When defined, the runner accepts http.fetch only to these hosts */
  httpAllowedHosts?: string[];
}

export interface ManifestEntitlements {
  /** Must be unlocked before commit; commit blocks if any are missing */
  required: EntitlementRef[];
  /** Optional unlocks improve the recipe but don't gate commit */
  optional: EntitlementRef[];
}

export interface ManifestLoadingSequence {
  steps: ManifestLoadingStep[];
}

export interface ManifestLoadingStep {
  /** Stable identifier — used in WS event payloads */
  id: string;
  /** 1-line label shown to user */
  label: string;
  /** lucide-react icon name (validated against actual icon registry by UI) */
  icon: string;
  /** Estimated duration; UI emits rotating narration if exceeded */
  estimatedMs: number;
  /** Optional longer caption shown on hover/expand */
  detail?: string;
  /** Optional rotating narration lines for slow steps */
  narration?: string[];
}
