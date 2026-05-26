// ──────────────────────────────────────────────────────
// Skill Manifest — manuscript-summarize
// Category: publishing
// ──────────────────────────────────────────────────────

import { defineSkill } from "../../define-skill";

export const manuscriptSummarizeManifest = defineSkill({
  name: "manuscript-summarize",
  version: "1.0.0",
  description: "Produce 5-line, 1-page, and 3-page summaries + thematic tags + comp titles.",
  category: "publishing",
  tags: ["publishing", "manuscript", "summarize"],
  tools: [
    {
      name: "manuscript-summarize",
      description: "Multi-length summary + tags + comp-title leads.",
      inputSchema: {
        properties: {
          manuscriptId: { type: "string" },
          sourceKbId: { type: "string" },
        },
        required: ["manuscriptId", "sourceKbId"],
      },
      outputSchema: {
        properties: {
          manuscriptId: { type: "string" },
          fiveLine: { type: "string" },
          onePage: { type: "string" },
          threePage: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          compTitles: { type: "array", items: { type: "string" } },
        },
      },
    },
  ],
  metadata: { executionMode: "INLINE" },
});
