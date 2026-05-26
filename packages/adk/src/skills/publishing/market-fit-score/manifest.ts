// ──────────────────────────────────────────────────────
// Skill Manifest — market-fit-score
// Category: publishing
// executionMode: INLINE — DataApi call + LLM reasoning.
// DataApi: publishers-global-v1 (shared with publisher-database-search)
// AIZ unlock required (200 AIZ) + per-call meter (4 AIZ/call)
// ──────────────────────────────────────────────────────

import { defineSkill } from "../../define-skill";

export const marketFitScoreManifest = defineSkill({
  name: "market-fit-score",
  version: "1.0.0",
  description:
    "Score the 0-100 market fit between a manuscript and a specific publisher with reasoning.",
  category: "publishing",
  tags: ["publishing", "market-fit", "publisher", "data-api"],
  tools: [
    {
      name: "market-fit-score",
      description: "0-100 fit score + reasoning.",
      inputSchema: {
        properties: {
          manuscript: {
            type: "object",
            properties: {
              title: { type: "string" },
              genre: { type: "string" },
              wordCount: { type: "integer" },
              themes: { type: "array", items: { type: "string" } },
              summary: { type: "string" },
              compTitles: { type: "array", items: { type: "string" } },
            },
            required: ["genre", "wordCount", "summary"],
          },
          publisherId: { type: "string" },
        },
        required: ["manuscript", "publisherId"],
      },
      outputSchema: {
        properties: {
          score: { type: "integer", minimum: 0, maximum: 100 },
          reasoning: { type: "string" },
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
    },
  },
});
