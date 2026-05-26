// ──────────────────────────────────────────────────────
// Skill Manifest — query-letter-generate
// Category: publishing
// executionMode: INLINE — single LLM call producing a one-page query letter.
// No AIZ unlock required — tier-included.
// ──────────────────────────────────────────────────────

import { defineSkill } from "../../define-skill";

export const queryLetterGenerateManifest = defineSkill({
  name: "query-letter-generate",
  version: "1.0.0",
  description:
    "Draft an industry-standard query letter for a target publisher from manuscript metadata.",
  category: "publishing",
  tags: ["publishing", "query-letter", "writing"],
  tools: [
    {
      name: "query-letter-generate",
      description: "One-page query letter (hook + pitch + bio + housekeeping).",
      inputSchema: {
        properties: {
          manuscript: {
            type: "object",
            properties: {
              title: { type: "string" },
              genre: { type: "string" },
              wordCount: { type: "integer" },
              summary: { type: "string" },
              compTitles: { type: "array", items: { type: "string" } },
              authorBio: { type: "string" },
            },
            required: ["title", "genre", "wordCount", "summary"],
          },
          publisher: {
            type: "object",
            properties: {
              name: { type: "string" },
              acquiringEditor: { type: "string" },
              submissionGuidelines: { type: "string" },
              allowsSimultaneous: { type: "boolean" },
            },
            required: ["name"],
          },
        },
        required: ["manuscript", "publisher"],
      },
      outputSchema: {
        properties: {
          letter: { type: "string" },
          attachmentInstructions: { type: "string" },
        },
      },
    },
  ],
  metadata: {
    executionMode: "INLINE",
  },
});
