// ──────────────────────────────────────────────────────
// Tests — market-fit-score
// 2 cases: (1) score is integer in [0,100], (2) reasoning is non-empty prose
// Both dataApi.call and llm.chat are mocked.
// ──────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { mkCtx, mkHost } from "../../__tests__/test-helpers";
import { executeMarketFitScore } from "../execute";

const ctxWithLLM = (content: string) =>
  mkCtx(
    "publisher-researcher",
    mkHost({
      llm: { chat: vi.fn().mockResolvedValue({ content, costUsd: 0.01, model: "test-model" }) },
      dataApi: {
        call: vi.fn().mockResolvedValue({
          id: "pub-001",
          name: "Sandstone Literary",
          imprint: "Sandstone",
          genres: ["literary-fiction", "coming-of-age"],
          wordCountMin: 60000,
          wordCountMax: 120000,
          acquiringEditors: [
            {
              name: "Marisol Kane",
              recentAcquisitions: ["The Hollow Choir", "What the Cactus Knew"],
            },
          ],
          submissionGuidelines: "Query + first 25 pages via Submittable. No simultaneous.",
        }),
      },
    }),
  );

const baseInput = {
  manuscript: {
    genre: "literary",
    wordCount: 85000,
    summary: "A debut literary novel about a cartographer's daughter navigating grief.",
  },
  publisherId: "pub-001",
};

describe("market-fit-score", () => {
  it("score is integer in [0, 100]", async () => {
    // LLM returns a fractional score — execute must round to integer
    const ctx = ctxWithLLM(
      JSON.stringify({ score: 78.6, reasoning: "Genre overlap; word count in range." }),
    );
    const res = await executeMarketFitScore(baseInput, ctx);

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(Number.isInteger(res.data.score)).toBe(true);
    expect(res.data.score).toBeGreaterThanOrEqual(0);
    expect(res.data.score).toBeLessThanOrEqual(100);
  });

  it("reasoning is non-empty prose", async () => {
    const ctx = ctxWithLLM(
      JSON.stringify({
        score: 65,
        reasoning:
          "Themes align with the imprint's recent literary list including The Hollow Choir.",
      }),
    );
    const res = await executeMarketFitScore(baseInput, ctx);

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.reasoning.length).toBeGreaterThan(20);
  });
});
