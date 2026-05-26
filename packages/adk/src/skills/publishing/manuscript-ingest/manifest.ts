// ──────────────────────────────────────────────────────
// Skill Manifest — manuscript-ingest
// Category: publishing
// ──────────────────────────────────────────────────────

import { defineSkill } from "../../define-skill";

export const manuscriptIngestManifest = defineSkill({
  name: "manuscript-ingest",
  version: "1.0.0",
  description:
    "Parse a manuscript file (epub/docx/pdf/txt) into chapters with word counts and KB-ready blocks.",
  category: "publishing",
  tags: ["publishing", "manuscript", "parsing", "ingest"],
  tools: [
    {
      name: "manuscript-ingest",
      description: "Parse an uploaded manuscript into chapters + KB blocks.",
      inputSchema: {
        properties: {
          manuscriptId: { type: "string" },
          fileType: { type: "string", enum: ["epub", "docx", "pdf", "txt"] },
          source: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: { base64: { type: "string" } },
                required: ["base64"],
              },
            ],
          },
          targetKbId: { type: "string" },
        },
        required: ["manuscriptId", "fileType", "source", "targetKbId"],
      },
      outputSchema: {
        properties: {
          manuscriptId: { type: "string" },
          chapters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                index: { type: "integer" },
                title: { type: "string" },
                wordCount: { type: "integer" },
                blocks: { type: "array", items: { type: "string" } },
              },
            },
          },
          totalWordCount: { type: "integer" },
        },
      },
    },
  ],
  metadata: {
    executionMode: "INLINE",
    runtimeDependencies: ["epub", "mammoth", "pdf-parse"],
  },
});
