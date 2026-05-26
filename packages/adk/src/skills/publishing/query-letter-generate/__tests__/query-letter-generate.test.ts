// ──────────────────────────────────────────────────────
// Tests — query-letter-generate
// 2 cases:
//   (1) golden-path: LLM returns a well-formed letter → ≥3 paragraphs extracted
//   (2) validation: empty publisher name → INVALID_INPUT error
// LLM call is mocked; no real network I/O.
// ──────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { mkCtx, mkHost } from "../../__tests__/test-helpers";
import { executeQueryLetterGenerate } from "../execute";

const goldenLetter = [
  "Dear Marisol Kane,",
  "When the cartographer's daughter inherits a map of places that no longer exist, she must choose between her father's secrets and the daylight world. Stake sentence.",
  "THE TESSELLATED YEAR is an 85,000-word literary novel that will appeal to readers of Normal People by Sally Rooney and The Hollow Choir. Pitch. Stake at end.",
  "This is my debut novel.",
  "Sandstone Literary publishes exactly the kind of upmarket literary fiction this novel sits within. Thank you for your time and consideration.",
  "Sincerely,\n<Author Name>",
  "ATTACHMENT_INSTRUCTIONS: Attach query + first 25 pages via Submittable.",
].join("\n\n");

const ctxWithLLM = (content: string) =>
  mkCtx(
    "query-letter-writer",
    mkHost({
      llm: { chat: vi.fn().mockResolvedValue({ content, costUsd: 0.02, model: "t" }) },
    }),
  );

describe("query-letter-generate", () => {
  it("golden-path produces >= 3 paragraphs", async () => {
    const ctx = ctxWithLLM(goldenLetter);
    const res = await executeQueryLetterGenerate(
      {
        manuscript: {
          title: "The Tessellated Year",
          genre: "literary",
          wordCount: 85000,
          summary: "...",
          compTitles: ["Normal People by Sally Rooney"],
        },
        publisher: { name: "Sandstone Literary", acquiringEditor: "Marisol Kane" },
      },
      ctx,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.letter.split(/\n\s*\n/).filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(res.data.attachmentInstructions).toContain("Submittable");
  });

  it("requires non-empty publisher name", async () => {
    const ctx = ctxWithLLM(goldenLetter);
    const res = await executeQueryLetterGenerate(
      {
        manuscript: { title: "X", genre: "literary", wordCount: 80000, summary: "y" },
        publisher: { name: "" },
      } as never,
      ctx,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_INPUT");
  });
});
