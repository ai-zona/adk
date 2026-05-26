// ──────────────────────────────────────────────────────
// Skill Manifest — book-edit-suggest
// Category: publishing
// executionMode: SANDBOX — manuscript text is large/untrusted input;
// the platform sandbox runtime (Stream B-2) reads metadata.executionMode
// at dispatch and runs the body in isolated-vm + gVisor.
// ──────────────────────────────────────────────────────

import { defineSkill } from "../../define-skill";

export const bookEditSuggestManifest = defineSkill({
  name: "book-edit-suggest",
  version: "1.0.0",
  description:
    "Generate line-level edits and structural notes for a chapter range. Runs in SANDBOX — manuscript text is large untrusted input.",
  category: "publishing",
  tags: ["publishing", "manuscript", "editing", "sandbox"],
  tools: [
    {
      name: "book-edit-suggest",
      description: "Line edits + structural notes for a chapter range.",
      inputSchema: {
        properties: {
          manuscriptId: { type: "string" },
          sourceKbId: { type: "string" },
          suggestionsKbId: { type: "string" },
          chapterStart: { type: "integer", minimum: 0 },
          chapterEnd: { type: "integer", minimum: 0 },
        },
        required: ["manuscriptId", "sourceKbId", "suggestionsKbId", "chapterStart", "chapterEnd"],
      },
      outputSchema: {
        properties: {
          suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                chapterIndex: { type: "integer" },
                kind: { type: "string", enum: ["line", "structural"] },
                location: { type: "string" },
                note: { type: "string" },
                suggestedText: { type: "string" },
              },
            },
          },
        },
      },
    },
  ],
  // executionMode: "SANDBOX" tells the platform sandbox runtime (Stream B-2) to
  // execute this body in isolated-vm + gVisor. Stream B-2 reads metadata.executionMode at dispatch.
  metadata: { executionMode: "SANDBOX" },
});
