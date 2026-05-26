// ──────────────────────────────────────────────────────
// Skill Manifest — publisher-database-search
// Category: publishing
// executionMode: INLINE — DataApi call with AIZ unlock + per-call metering.
// ──────────────────────────────────────────────────────

import { defineSkill } from "../../define-skill";

export const publisherDatabaseSearchManifest = defineSkill({
  name: "publisher-database-search",
  version: "1.0.0",
  description:
    "Query the PublishersGlobal database for publishers + acquiring editors that fit a manuscript's metadata. AIZ-unlock + per-call metering required.",
  category: "publishing",
  tags: ["publishing", "publisher", "search", "data-api"],
  tools: [
    {
      name: "publisher-database-search",
      description: "Ranked publisher matches with submission guidelines.",
      inputSchema: {
        properties: {
          genre: { type: "string" },
          themes: { type: "array", items: { type: "string" } },
          targetAudience: { type: "string" },
          wordCount: { type: "integer" },
          compTitles: { type: "array", items: { type: "string" } },
          limit: { type: "integer", default: 10 },
        },
        required: ["genre", "wordCount"],
      },
      outputSchema: {
        properties: {
          results: {
            type: "array",
            items: {
              type: "object",
              properties: {
                publisherId: { type: "string" },
                name: { type: "string" },
                imprint: { type: "string" },
                fitScore: { type: "number" },
                acquiringEditors: { type: "array" },
                submissionGuidelines: { type: "string" },
              },
            },
          },
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
