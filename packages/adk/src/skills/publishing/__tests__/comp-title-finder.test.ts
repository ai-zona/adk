// ──────────────────────────────────────────────────────
// Skill 11 tests — comp-title-finder
// TDD: red → green
// DataApi: PublishersGlobal (publishers-global-v1)
// AIZ-200 unlock — same bundle as publisher-database-search (skill 4)
// ──────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { compTitleFinder } from "../comp-title-finder";

const meta = {
  title: "Salt River Days",
  genre: "climate-fiction",
  themes: ["water-rights"],
  wordCount: 92_000,
};

describe("comp-title-finder", () => {
  it("returns ≥3 titles on golden path", async () => {
    const dataApiCall = vi.fn(async () => ({
      titles: (
        [
          ["The Water Knife", "P. Bacigalupi", 220_000, 0.86],
          ["American War", "O. El Akkad", 180_000, 0.79],
          ["The Overstory", "R. Powers", 460_000, 0.91],
          ["Parable of the Sower", "O. Butler", 700_000, 0.95],
        ] as const
      ).map(([title, author, salesUnits, criticalScore]) => ({
        title,
        author,
        salesUnits,
        criticalScore,
      })),
    }));
    const result = await compTitleFinder.execute(meta, {
      dataApiCall,
      checkEntitlement: async () => ({
        unlocked: true,
        bundleId: "publisher-research-toolkit-v1",
      }),
      workspaceId: "ws_t",
    });
    expect(result.titles.length).toBeGreaterThanOrEqual(3);
    expect(result.titles[0]).toHaveProperty("salesUnits");
  });

  it("recognizes the publisher-research-toolkit bundle (paired with skill 4)", async () => {
    const checkEntitlement = vi.fn(async (ref) => ({
      unlocked: true,
      bundleId: "publisher-research-toolkit-v1",
      ref,
    }));
    const result = await compTitleFinder.execute(meta, {
      dataApiCall: async () => ({ titles: [] }),
      checkEntitlement,
      workspaceId: "ws_t",
    });
    expect(result.bundleSatisfied).toBe("publisher-research-toolkit-v1");
    expect(checkEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DATA_API", refId: "publishers-global-v1" }),
    );
  });
});
