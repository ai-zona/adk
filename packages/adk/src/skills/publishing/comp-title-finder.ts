// ──────────────────────────────────────────────────────
// Skill 11 — comp-title-finder
// Find top 5 comparable titles with sales data + critical
// reception via PublishersGlobal DataApi.
// executionMode: INLINE  (DataApi call, AIZ-200 unlock)
// Same AIZ-200 unlock as publisher-database-search (skill 4).
// Bundle: publisher-research-toolkit-v1 satisfies both.
// ──────────────────────────────────────────────────────

import { defineSkill } from "../define-skill";

// ─── Types ───────────────────────────────────────────

export interface CompTitleFinderInput {
  title: string;
  genre: string;
  themes: string[];
  wordCount: number;
}

export interface CompTitle {
  title: string;
  author: string;
  salesUnits: number;
  criticalScore: number;
}

export interface CompTitleFinderOutput {
  titles: CompTitle[];
  bundleSatisfied?: string;
}

export interface CompTitleFinderContext {
  dataApiCall: (args: {
    slug: string;
    op: string;
    params: Record<string, unknown>;
  }) => Promise<{ titles: CompTitle[] }>;
  checkEntitlement: (ref: {
    type: "DATA_API" | "BUNDLE";
    refId: string;
  }) => Promise<{ unlocked: boolean; bundleId?: string }>;
  workspaceId: string;
}

// ─── Manifest ────────────────────────────────────────

export const compTitleFinderManifest = defineSkill({
  name: "comp-title-finder",
  version: "1.0.0",
  description:
    "Find top 5 comparable titles with sales data + critical reception via PublishersGlobal. " +
    "AIZ-unlock required (200 AIZ); publisher-research-toolkit-v1 bundle satisfies both this skill " +
    "and publisher-database-search (skill 4).",
  category: "publishing",
  tags: ["research", "comp-titles", "publishers-global"],
  tools: [
    {
      name: "find",
      description: "Query PublishersGlobal for comparable titles.",
      inputSchema: {
        type: "object",
        required: ["title", "genre", "themes", "wordCount"],
        properties: {
          title: { type: "string" },
          genre: { type: "string" },
          themes: { type: "array", items: { type: "string" } },
          wordCount: { type: "integer", minimum: 5_000 },
        },
      },
      outputSchema: {
        type: "object",
        required: ["titles"],
        properties: {
          titles: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                author: { type: "string" },
                salesUnits: { type: "integer" },
                criticalScore: { type: "number" },
              },
            },
          },
          bundleSatisfied: { type: "string" },
        },
      },
    },
  ],
  metadata: {
    executionMode: "INLINE",
    dataApi: "publishers-global-v1",
    entitlement: {
      kind: "DATA_API",
      id: "publishers-global-v1",
      aizUnlockCost: 200,
      perCallMeter: 4,
      bundle: "publisher-research-toolkit-v1",
    },
  },
});

// ─── Skill Object ────────────────────────────────────

export const compTitleFinder = {
  manifest: compTitleFinderManifest,

  async execute(
    input: CompTitleFinderInput,
    ctx: CompTitleFinderContext,
  ): Promise<CompTitleFinderOutput> {
    // AIZ-200 unlock check — same gate as publisher-database-search.
    // publisher-research-toolkit-v1 BUNDLE satisfies both skills.
    const ent = await ctx.checkEntitlement({
      type: "DATA_API",
      refId: "publishers-global-v1",
    });

    if (!ent.unlocked) {
      throw new Error("ENTITLEMENT_DENIED: publishers-global-v1 not unlocked");
    }

    const { titles } = await ctx.dataApiCall({
      slug: "publishers-global-v1",
      op: "comp-titles.search",
      params: {
        genre: input.genre,
        themes: input.themes,
        wordCountRange: [Math.floor(input.wordCount * 0.7), Math.ceil(input.wordCount * 1.3)],
        limit: 5,
      },
    });

    // Rank by combined signal: criticalScore × salesUnits (popularity × quality).
    // Take top 5 (DataApi may return more if caller raised limit).
    const top5 = [...titles]
      .sort((a, b) => b.criticalScore * b.salesUnits - a.criticalScore * a.salesUnits)
      .slice(0, 5);

    return {
      titles: top5,
      bundleSatisfied: ent.bundleId,
    };
  },
};
