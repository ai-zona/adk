import { z } from "zod";
import { CAPABILITY_IDS, ENTITLEMENT_TYPES } from "../capabilities/identifiers.js";

const HOST_FN_VALUES = Object.values(CAPABILITY_IDS.HOST_FN) as [string, ...string[]];

const cuid = z.string().min(20).max(40);

const slug = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)?$/, "must be a slug");

const manifestAgent = z.object({
  slug,
  source: z.enum(["PLATFORM", "MARKETPLACE", "CUSTOM_ADK"]),
  marketplaceAgentId: z.string().optional(),
  displayName: z.string().max(120).optional(),
  customInstructions: z.string().max(8000).optional(),
  customConfig: z.record(z.unknown()).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  // Wave 2 additions
  config: z
    .object({
      temperature: z.number().optional(),
      maxTokens: z.number().int().positive().optional(),
      model: z.string().optional(),
    })
    .catchall(z.unknown())
    .optional(),
  testFixtures: z
    .array(z.object({ input: z.unknown(), expected: z.unknown().optional() }))
    .optional(),
  importedFrom: z
    .object({
      source: z.string().min(1),
      importedAt: z.string().datetime(),
      checksum: z.string().optional(),
    })
    .optional(),
});

const manifestTeam = z.object({
  name: z.string().min(1).max(80),
  coordinator: slug,
  members: z.array(slug).min(1),
  executionMode: z.enum(["coordinator", "pipeline", "parallel"]).optional(),
});

const manifestSkill = z.object({
  skillRef: slug,
  provenance: z.enum([
    "PLATFORM_CURATED",
    "COMMUNITY_VERIFIED",
    "COMMUNITY_UNVERIFIED",
    "MCP_WRAPPED",
    "LLM_GENERATED",
  ]),
  allowedAgents: z.array(slug).optional(),
  forceSandbox: z.boolean().optional(),
  // Wave 2 additions
  // Mirrors SkillKind from capabilities/identifiers — keep in sync
  kind: z.enum(["JS_SOURCE", "SOP_COMPOSITION", "PROMPT_TEMPLATE"]).optional(),
  coolingOff: z
    .object({
      state: z.enum(["PENDING", "APPROVED", "REJECTED"]),
      until: z.string().datetime(),
    })
    .optional(),
  testFixtures: z
    .array(z.object({ input: z.unknown(), expected: z.unknown().optional() }))
    .optional(),
});

const manifestTool = z.object({
  hostFn: z.enum(HOST_FN_VALUES),
  argAllowlist: z.record(z.unknown()).optional(),
});

const manifestDataApi = z.object({
  slug,
  required: z.boolean(),
  surfaceUnlockAt: z.string().min(1).max(80).optional(),
});

const manifestKnowledge = z.object({
  slug,
  description: z.string().min(1).max(500),
  mode: z.enum(["user-uploaded", "system-managed", "platform-curated"]),
  prebuiltKbId: z.string().optional(),
});

const manifestSopStep = z.object({
  kind: z.enum(["INSTRUCTION", "AGENT_TASK", "APPROVAL_GATE", "CONDITION", "PARALLEL"]),
  config: z.record(z.unknown()),
});

const manifestSop = z.object({
  slug,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  steps: z.array(manifestSopStep).min(1),
  trigger: z
    .union([
      z.object({ type: z.literal("manual") }),
      z.object({ type: z.literal("cron"), expression: z.string().min(9).max(40) }),
      z.object({ type: z.literal("event"), eventName: z.string().min(1).max(80) }),
    ])
    .optional(),
});

const manifestChannel = z.object({
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, "must be a channel slug"),
  kind: z.enum(["GENERAL", "RECIPE", "DM", "SYSTEM"]),
  agentParticipants: z.array(slug).optional(),
});

const manifestSecret = z.object({
  key: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Z][A-Z0-9_]*$/, "must be SCREAMING_SNAKE"),
  scope: z.enum(["WORKSPACE", "TEAM", "AGENT"]),
  scopeRef: z.string().optional(),
  description: z.string().max(500).optional(),
  defer: z.boolean(),
});

const manifestSandbox = z.object({
  memoryLimitMb: z.number().int().min(64).max(2048),
  cpuLimitMs: z.number().int().min(1000).max(60_000),
  hostFnAllowlist: z.array(z.enum(HOST_FN_VALUES)).min(1),
  httpAllowedHosts: z.array(z.string().min(1)).optional(),
});

const entitlementRef = z.object({
  type: z.enum(ENTITLEMENT_TYPES),
  refId: z.string().min(1).max(120),
});

const manifestLoadingStep = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(200),
  icon: z.string().min(1).max(60),
  estimatedMs: z.number().int().positive().max(300_000),
  detail: z.string().max(500).optional(),
  narration: z.array(z.string().max(200)).max(20).optional(),
});

const manifestSpec = z
  .object({
    agents: z.array(manifestAgent),
    teams: z.array(manifestTeam),
    skills: z.array(manifestSkill),
    tools: z.array(manifestTool),
    dataApis: z.array(manifestDataApi),
    knowledge: z.array(manifestKnowledge),
    sops: z.array(manifestSop),
    channels: z.array(manifestChannel).min(1, "must have at least one channel"),
    secrets: z.array(manifestSecret),
    sandbox: manifestSandbox,
  })
  .superRefine((spec, ctx) => {
    // Cross-field: every team coordinator + member must reference an agent in spec.agents
    const agentSlugs = new Set(spec.agents.map((a) => a.slug));
    for (const t of spec.teams) {
      if (!agentSlugs.has(t.coordinator)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `team "${t.name}" coordinator "${t.coordinator}" not in spec.agents`,
        });
      }
      for (const m of t.members) {
        if (!agentSlugs.has(m)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `team "${t.name}" member "${m}" not in spec.agents`,
          });
        }
      }
    }
    // Cross-field: agentParticipants on channels must reference spec.agents
    for (const c of spec.channels) {
      for (const a of c.agentParticipants ?? []) {
        if (!agentSlugs.has(a)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `channel "${c.name}" agentParticipant "${a}" not in spec.agents`,
          });
        }
      }
    }
  });

export const manifestMetadataSchema = z.object({
  workspaceId: cuid,
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(1000),
  recipeRef: z.string().optional(),
  goalStatement: z.string().min(1).max(4000),
});

export const manifestSpecSchema = manifestSpec;

export const manifestEntitlementsSchema = z.object({
  required: z.array(entitlementRef),
  optional: z.array(entitlementRef),
});

export const manifestLoadingSequenceSchema = z.object({
  steps: z.array(manifestLoadingStep).min(1),
});

export const workspaceManifestSchema = z.object({
  apiVersion: z.literal("aizona.dev/v1"),
  kind: z.literal("WorkspaceManifest"),
  metadata: manifestMetadataSchema,
  spec: manifestSpecSchema,
  entitlements: manifestEntitlementsSchema,
  loadingSequence: manifestLoadingSequenceSchema,
  // Wave 2 additions
  voice: z
    .object({
      inputProvider: z.string().min(1),
      outputProvider: z.string().min(1),
    })
    .optional(),
  importProvenance: z
    .object({
      source: z.string().min(1),
      importedAt: z.string().datetime(),
    })
    .optional(),
  duplicatedFrom: z.string().min(20).max(40).optional(),
});
