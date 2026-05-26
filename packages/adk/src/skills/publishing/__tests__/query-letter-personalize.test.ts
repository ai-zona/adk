import { describe, expect, it, vi } from "vitest";
import { queryLetterPersonalize } from "../query-letter-personalize";

const baseLetter = "Dear Editor,\n\nI am pleased to submit my novel...\n\nSincerely,\nAuthor";

describe("query-letter-personalize", () => {
  it("adds a personalization paragraph when acquisitions are available", async () => {
    const llm = vi.fn(async () => ({
      text: baseLetter.replace(
        "Dear Editor,",
        'Dear Editor,\n\nI noticed you recently acquired "Solar Drift" — my book shares its climate-fiction focus.',
      ),
    }));
    const dataApiCall = vi.fn(async () => ({
      acquisitions: [
        { title: "Solar Drift", year: 2025 },
        { title: "Quiet Earth", year: 2024 },
      ],
    }));
    const result = await queryLetterPersonalize.execute(
      { queryLetter: baseLetter, editorId: "ed_jane" },
      { llm, dataApiCall, workspaceId: "ws_t" },
    );
    expect(result.personalized).toContain("Solar Drift");
    expect(result.personalized.length).toBeGreaterThan(baseLetter.length);
    expect(result.acquisitionsUsed).toBe(2);
  });

  it("falls back to the original letter when acquisitions are unavailable", async () => {
    const llm = vi.fn();
    const dataApiCall = vi.fn(async () => ({ acquisitions: [] }));
    const result = await queryLetterPersonalize.execute(
      { queryLetter: baseLetter, editorId: "ed_unknown" },
      { llm, dataApiCall, workspaceId: "ws_t" },
    );
    expect(result.personalized).toBe(baseLetter);
    expect(result.acquisitionsUsed).toBe(0);
    expect(llm).not.toHaveBeenCalled();
  });
});
