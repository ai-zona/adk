/**
 * tRPC procedure signatures for the workspace-architect router.
 *
 * This file declares input + output Zod schemas only; the implementation
 * lives in packages/api/src/routers/workspace-architect.ts (Stream D).
 * Stream D imports these schemas verbatim.
 *
 * Streams that consume the architect API (G — UI client) import the same
 * inferred types via z.infer.
 */

import { z } from "zod";
import { ENTITLEMENT_SOURCES, ENTITLEMENT_TYPES } from "../capabilities/identifiers.js";
import { workspaceManifestSchema } from "../manifest/zod.js";
import { pricingSchema } from "../marketplace/promote.js";
import { testFixtureSchema } from "../test-runner/types.js";

const cuid = z.string().min(20).max(40);

export const chatInputSchema = z.object({
  workspaceId: cuid,
  message: z.string().min(1).max(8000),
  /** Continues an existing architect chat session if provided */
  sessionId: z.string().optional(),
});

/**
 * Phase 5b — chat suggestion shape.
 *
 * Mirrors the runtime `TurnResult.suggestions[]` shape (handler.ts → drained
 * from `_manifest-patch.ManifestPatch.suggestion`). The chat UI renders
 * each entry as a `<ManifestLogEntry variant="suggestion">` card with
 * Apply / Dismiss controls.
 *
 * Suggestions are NON-APPLYING — the architect tool that surfaced them
 * (`evolve_skill` / `compact_memory`) does not mutate state. The UI's
 * Apply button dispatches a follow-up procedure based on `kind`:
 *   - SKILL_EVOLUTION → `architect.activateSkillVariant` (EDITOR+)
 *   - MEMORY_COMPACTION → `architect.compactMemoryFromSuggestion` (ADMIN-only)
 */
export const suggestionSchema = z.object({
  kind: z.enum(["SKILL_EVOLUTION", "MEMORY_COMPACTION"]),
  title: z.string(),
  detail: z.string(),
  applyAction: z.record(z.unknown()).optional(),
});
export type ChatSuggestion = z.infer<typeof suggestionSchema>;

export const chatOutputSchema = z.object({
  sessionId: z.string(),
  /** Streaming partials are out of scope for v1; full reply returned. */
  reply: z.string(),
  /** When the LLM emitted a draft manifest, returned here for the preview pane. */
  draftManifest: workspaceManifestSchema.optional(),
  /**
   * Tool invocations executed by the architect during this turn. UI consumers
   * render these as structured ToolCallCards (preventing XML-in-text leaks).
   * Each entry mirrors the runtime TurnResult.toolCalls shape; `input` /
   * `result` are passthrough JSON for inspection / replay.
   */
  toolCalls: z
    .array(
      z.object({
        tool: z.string(),
        input: z.unknown().optional(),
        result: z.unknown().optional(),
      }),
    )
    .optional(),
  /** Pending unlock cards the architect wants to surface to the user. */
  pendingUnlocks: z.array(
    z.object({
      ref: z.object({ type: z.enum(ENTITLEMENT_TYPES), refId: z.string() }),
      reason: z.string(),
      unlockOptions: z.array(
        z.object({
          source: z.enum(ENTITLEMENT_SOURCES),
          cost: z.object({ amount: z.number(), currency: z.enum(["AIZ", "USD"]) }).optional(),
          description: z.string(),
          requiresTier: z.enum(["FREE", "PRO", "TEAM", "ENTERPRISE"]).optional(),
        }),
      ),
    }),
  ),
  /**
   * Phase 5b — non-applying suggestions surfaced by `evolve_skill` /
   * `compact_memory` tools during this turn. UI renders each as an
   * Apply / Dismiss card. Optional because most turns have no suggestions.
   */
  suggestions: z.array(suggestionSchema).optional(),
  /**
   * Image-gen v1 (Commit 3) — UI artifacts emitted during this turn, e.g.
   * `kind: "image"` payloads from the `generate_image` tool. The UI mounts
   * each via `<ArtifactCard>`. Optional + passthrough because the artifact
   * shape is a discriminated union owned by `apps/web/lib/components/chat`.
   */
  artifacts: z
    .array(
      z
        .object({
          artifactId: z.string(),
          version: z.number(),
          title: z.string(),
          kind: z.enum(["html", "react", "svg", "markdown", "code", "image"]),
        })
        .passthrough(),
    )
    .optional(),
});

export const draftManifestInputSchema = z.object({
  workspaceId: cuid,
  goalStatement: z.string().min(1).max(4000),
  /** Optionally hydrate from a recipe template before refining */
  recipeRef: z.string().optional(),
});

/**
 * Wave 7 / B7 — typed shape stored inside `WorkspaceManifest.document` (Json).
 *
 * Lives here (not as a Prisma column) so the discriminator `kind` can evolve
 * without schema migrations. Read-side uses `document.kind ?? "legacy"` to
 * keep older rows readable. Forward-only — existing rows are not backfilled.
 *
 * `.passthrough()` because some `kind`s (e.g. `"architect-output"`) carry
 * additional payload (`architectManifest`, `goalStatement`) that we don't
 * want to strip on read.
 */
export const appliedRecipeDocumentSchema = z
  .object({
    kind: z.enum(["drafted", "applied-recipe", "architect-output"]),
    recipeSlug: z.string().optional(),
    appliedAt: z.string().optional(),
  })
  .passthrough();
export type AppliedRecipeDocument = z.infer<typeof appliedRecipeDocumentSchema>;

/**
 * Wave 7 / B7 — Prisma-row-shaped schema returned by `draftManifest` /
 * `applyRecipe`. This is the persisted `WorkspaceManifest` row, NOT the
 * structured WorkspaceManifest document (`workspaceManifestSchema`). The
 * row's `document` Json field carries the structured payload via the
 * `AppliedRecipeDocument` discriminator above.
 *
 * Why row-shaped (not document-shaped): the UI needs the row id to commit /
 * apply / version-track; the architect-produced structured manifest is only
 * present when the underlying turn applied tool patches (most goal-statement
 * turns produce no patches). Returning the row keeps the contract honest
 * regardless of what the LLM did.
 */
export const persistedWorkspaceManifestSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  version: z.number().int(),
  status: z.enum(["DRAFT", "COMMITTED", "SUPERSEDED"]),
  document: appliedRecipeDocumentSchema,
  authoredBy: z.string(),
  authoredAt: z.union([z.string(), z.date()]),
  parentId: z.string().nullable(),
  recipeId: z.string().nullable(),
});
export type PersistedWorkspaceManifest = z.infer<typeof persistedWorkspaceManifestSchema>;

export const draftManifestOutputSchema = z.object({
  /**
   * Wave 7 / B7 — required: both `draftManifest` and `applyRecipe` now
   * persist a real `WorkspaceManifest` row and return it. Removed the
   * `.optional()` placeholder + the `manifest: undefined` failure mode that
   * lied about there being a row to fetch (Honest Claims theme — Gap Report
   * action #6, grill 2026-05-13-b7). Shape is the persisted row, not the
   * structured WorkspaceManifest document — see
   * `persistedWorkspaceManifestSchema` above.
   */
  manifest: persistedWorkspaceManifestSchema,
  /** Manifest row ID; used to commit later. Invariant: `manifest.id === manifestId`. */
  manifestId: z.string(),
});

export const commitManifestInputSchema = z.object({
  workspaceId: cuid,
  manifestId: z.string(),
});

export const commitManifestOutputSchema = z.object({
  jobId: z.string(),
  status: z.enum(["PENDING", "RUNNING"]),
});

export const listRecipesInputSchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const listRecipesOutputSchema = z.object({
  recipes: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      description: z.string(),
      category: z.string(),
      tierMin: z.enum(["FREE", "PRO", "TEAM", "ENTERPRISE"]),
      aizUnlockCost: z.number().int().nonnegative(),
      installs: z.number().int().nonnegative(),
      rating: z.number().nullable(),
      verified: z.boolean(),
    }),
  ),
  nextCursor: z.string().optional(),
});

export const applyRecipeInputSchema = z.object({
  workspaceId: cuid,
  recipeSlug: z.string(),
  /** Override-able fields the recipe explicitly marks customizable */
  overrides: z.record(z.unknown()).optional(),
});

export const applyRecipeOutputSchema = draftManifestOutputSchema;

export const unlockEntitlementInputSchema = z.object({
  workspaceId: cuid,
  ref: z.object({ type: z.enum(ENTITLEMENT_TYPES), refId: z.string() }),
  /** AIZ uses TokenTransaction; USD uses Stripe via WorkspaceSubscription */
  sourceCurrency: z.enum(["AIZ", "USD"]),
});

export const unlockEntitlementOutputSchema = z.object({
  ok: z.boolean(),
  entitlementId: z.string().optional(),
  txHash: z.string().optional(),
  errorMessage: z.string().optional(),
});

// ─── Wave 2 schemas (v0.2.0) ────────────────────────────────────────────────

export const revertToSnapshotInputSchema = z.object({ workspaceId: cuid, snapshotId: z.string() });
export const revertToSnapshotOutputSchema = z.object({
  ok: z.boolean(),
  newSnapshotId: z.string().optional(),
  error: z.string().optional(),
});

export const listSnapshotsInputSchema = z.object({
  workspaceId: cuid,
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export const listSnapshotsOutputSchema = z.object({
  snapshots: z.array(
    z.object({
      id: z.string(),
      snapshotIdx: z.number().int(),
      narration: z.string().nullable(),
      triggerType: z.enum(["RECIPE_APPLY", "INCREMENTAL", "REVERT", "IMPORT", "DUPLICATE"]),
      createdAt: z.string(),
      triggeredBy: z.string(),
    }),
  ),
  nextCursor: z.string().optional(),
});

export const getSnapshotDiffInputSchema = z.object({
  workspaceId: cuid,
  fromSnapshotId: z.string(),
  toSnapshotId: z.string(),
});
export const getSnapshotDiffOutputSchema = z.object({
  entries: z.array(
    z.object({
      kind: z.enum(["added", "removed", "modified"]),
      path: z.string(),
      summary: z.string(),
    }),
  ),
});

const importPayload = z.object({
  format: z.enum(["JSON", "MARKDOWN", "TEXT", "AUTO"]),
  content: z.string().min(1).max(2_000_000),
});
export const importAgentInputSchema = z.object({ workspaceId: cuid, payload: importPayload });
export const importAgentOutputSchema = z.object({
  ok: z.boolean(),
  draftAgentSlug: z.string().optional(),
  errors: z.array(z.string()).optional(),
});
export const importWorkspaceInputSchema = z.object({ workspaceId: cuid, payload: importPayload });
export const importWorkspaceOutputSchema = z.object({
  ok: z.boolean(),
  draftManifestId: z.string().optional(),
  errors: z.array(z.string()).optional(),
});

export const exportAgentInputSchema = z.object({
  workspaceId: cuid,
  agentSlug: z.string(),
  format: z.enum(["JSON", "MARKDOWN"]),
});
export const exportAgentOutputSchema = z.object({
  format: z.enum(["JSON", "MARKDOWN"]),
  content: z.string(),
});
export const exportWorkspaceInputSchema = z.object({
  workspaceId: cuid,
  format: z.enum(["JSON", "MARKDOWN"]),
});
export const exportWorkspaceOutputSchema = exportAgentOutputSchema;

export const duplicateAgentInputSchema = z.object({
  workspaceId: cuid,
  sourceAgentSlug: z.string(),
  newSlug: z.string().min(2).max(60),
});
export const duplicateAgentOutputSchema = z.object({ ok: z.boolean(), agentSlug: z.string() });
export const duplicateWorkspaceInputSchema = z.object({
  sourceWorkspaceId: cuid,
  newName: z.string().min(2).max(120),
});
export const duplicateWorkspaceOutputSchema = z.object({
  ok: z.boolean(),
  workspaceId: z.string(),
});

export const testAgentInputSchema = z.object({
  workspaceId: cuid,
  agentSlug: z.string(),
  mode: z.enum(["SMOKE", "BEHAVIORAL", "SNAPSHOT"]).default("SMOKE"),
  fixtures: z.array(testFixtureSchema).max(50),
});
export const testAgentOutputSchema = z.object({
  result: z.enum(["PASS", "FAIL", "ERROR"]),
  perFixture: z.array(
    z.object({
      idx: z.number(),
      result: z.enum(["PASS", "FAIL", "ERROR"]),
      output: z.unknown(),
      reason: z.string().optional(),
    }),
  ),
});
export const testWorkspaceInputSchema = z.object({
  workspaceId: cuid,
  mode: z.enum(["SMOKE", "BEHAVIORAL", "SNAPSHOT"]).default("SMOKE"),
});
export const testWorkspaceOutputSchema = testAgentOutputSchema;
export const testToolInputSchema = z.object({
  toolSlug: z.string(),
  fixtures: z.array(testFixtureSchema).max(50),
});
export const testToolOutputSchema = testAgentOutputSchema;

export const createToolInputSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(80),
  description: z.string().min(10).max(2000),
  source: z.string().min(20).max(50_000),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  capabilityTier: z.enum([
    "PLATFORM_FULL",
    "PLATFORM_READONLY",
    "MARKETPLACE_SANDBOXED",
    "EXTERNAL_UNTRUSTED",
    "PLATFORM_ADMIN",
  ]),
});
export const createToolOutputSchema = z.object({
  ok: z.boolean(),
  toolId: z.string().optional(),
  errors: z.array(z.string()).optional(),
});

// Drift 4 — discriminated pricing schema
export const promoteAgentInputSchema = z.object({
  workspaceId: cuid,
  agentSlug: z.string(),
  pricing: pricingSchema,
  description: z.string().min(20).max(4000),
});
export const promoteAgentOutputSchema = z.object({
  ok: z.boolean(),
  marketplaceAgentId: z.string().optional(),
  reviewNotes: z.array(z.string()).optional(),
});

export const listVoiceProvidersInputSchema = z.object({ workspaceId: cuid.optional() });
export const listVoiceProvidersOutputSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["BROWSER_NATIVE", "WHISPER", "ELEVENLABS", "OPENAI_TTS", "GOOGLE_CLOUD"]),
      direction: z.enum(["INPUT", "OUTPUT", "BOTH"]),
      isPrimary: z.boolean(),
      available: z.boolean(),
    }),
  ),
});
export const getVoiceConfigInputSchema = z.object({ workspaceId: cuid });
export const getVoiceConfigOutputSchema = z.object({
  inputProvider: z.string(),
  outputProvider: z.string(),
  config: z.record(z.unknown()),
});
export const setVoiceConfigInputSchema = z.object({
  workspaceId: cuid,
  kind: z.enum(["BROWSER_NATIVE", "WHISPER", "ELEVENLABS", "OPENAI_TTS", "GOOGLE_CLOUD"]),
  direction: z.enum(["INPUT", "OUTPUT", "BOTH"]),
  config: z.record(z.unknown()),
  isPrimary: z.boolean().default(true),
});
export const setVoiceConfigOutputSchema = z.object({ ok: z.boolean(), providerId: z.string() });

// ── getJobStatus (Phase 4.5 — backs use-hydrator-progress hook) ────────────
export const getJobStatusInputSchema = z.object({
  jobId: z.string().min(1),
});
export const getJobStatusOutputSchema = z.object({
  ok: z.boolean(),
  jobId: z.string(),
  /** PENDING | RUNNING | SUCCESS | FAILED — `null` when ok:false (job not found). */
  status: z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED"]).nullable(),
  /** Snapshot of the current step graph + cursor; the UI maps these to LoadingStep. */
  steps: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      narration: z.string().optional(),
      fraction: z.number(),
    }),
  ),
  currentStepIdx: z.number().int().nonnegative(),
  failureReason: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

/** Aggregate procedure shape — the router-builder consumes this in Stream D. */
export const workspaceArchitectProcedures = {
  chat: { input: chatInputSchema, output: chatOutputSchema },
  draftManifest: { input: draftManifestInputSchema, output: draftManifestOutputSchema },
  commitManifest: { input: commitManifestInputSchema, output: commitManifestOutputSchema },
  listRecipes: { input: listRecipesInputSchema, output: listRecipesOutputSchema },
  applyRecipe: { input: applyRecipeInputSchema, output: applyRecipeOutputSchema },
  unlockEntitlement: { input: unlockEntitlementInputSchema, output: unlockEntitlementOutputSchema },
  revertToSnapshot: { input: revertToSnapshotInputSchema, output: revertToSnapshotOutputSchema },
  listSnapshots: { input: listSnapshotsInputSchema, output: listSnapshotsOutputSchema },
  getSnapshotDiff: { input: getSnapshotDiffInputSchema, output: getSnapshotDiffOutputSchema },
  importAgent: { input: importAgentInputSchema, output: importAgentOutputSchema },
  importWorkspace: { input: importWorkspaceInputSchema, output: importWorkspaceOutputSchema },
  exportAgent: { input: exportAgentInputSchema, output: exportAgentOutputSchema },
  exportWorkspace: { input: exportWorkspaceInputSchema, output: exportWorkspaceOutputSchema },
  duplicateAgent: { input: duplicateAgentInputSchema, output: duplicateAgentOutputSchema },
  duplicateWorkspace: {
    input: duplicateWorkspaceInputSchema,
    output: duplicateWorkspaceOutputSchema,
  },
  testAgent: { input: testAgentInputSchema, output: testAgentOutputSchema },
  testWorkspace: { input: testWorkspaceInputSchema, output: testWorkspaceOutputSchema },
  testTool: { input: testToolInputSchema, output: testToolOutputSchema },
  createTool: { input: createToolInputSchema, output: createToolOutputSchema },
  promoteAgent: { input: promoteAgentInputSchema, output: promoteAgentOutputSchema },
  listVoiceProviders: {
    input: listVoiceProvidersInputSchema,
    output: listVoiceProvidersOutputSchema,
  },
  getVoiceConfig: { input: getVoiceConfigInputSchema, output: getVoiceConfigOutputSchema },
  setVoiceConfig: { input: setVoiceConfigInputSchema, output: setVoiceConfigOutputSchema },
  getJobStatus: { input: getJobStatusInputSchema, output: getJobStatusOutputSchema },
} as const;
