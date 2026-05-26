// ──────────────────────────────────────────────────────
// Tests — manuscript-summarize
// ──────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { executeManuscriptSummarize } from "../manuscript-summarize/execute";
import { mkCtx } from "./test-helpers";

const goldenJson = JSON.stringify({
  fiveLine: "L1.\nL2.\nL3.\nL4.\nL5.",
  onePage: "x".repeat(1500),
  threePage: "y".repeat(4500),
  tags: ["coming-of-age", "literary-fiction"],
  compTitles: ["Normal People by Sally Rooney"],
});

describe("manuscript-summarize", () => {
  it("golden-path returns JSON-parsed multi-length summary", async () => {
    const ctx = mkCtx("manuscript-reviewer");

    vi.mocked(ctx.host.kb.listKeys).mockResolvedValue(["m1/ch-0", "m1/ch-1"]);
    vi.mocked(ctx.host.kb.read).mockResolvedValue({ content: "Some chapter text." });
    vi.mocked(ctx.host.llm.chat).mockResolvedValue({
      content: goldenJson,
      costUsd: 0.01,
      model: "test-model",
    } as never);

    const res = await executeManuscriptSummarize({ manuscriptId: "m1", sourceKbId: "kb-1" }, ctx);

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // five-line summary must have exactly 5 newline-separated lines
    expect(res.data.fiveLine.split("\n").length).toBe(5);
    // 1-page summary must be non-empty (≥300 chars as per prompt)
    expect(res.data.onePage.length).toBeGreaterThanOrEqual(300);
    // 3-page summary must be non-empty (≥900 chars as per prompt)
    expect(res.data.threePage.length).toBeGreaterThanOrEqual(900);
    // tags array contains expected tag
    expect(res.data.tags).toContain("coming-of-age");
    // comp titles array contains expected title
    expect(res.data.compTitles).toContain("Normal People by Sally Rooney");
    // manuscriptId is threaded through
    expect(res.data.manuscriptId).toBe("m1");
  });

  it("empty manuscript (no chapter keys) returns NOT_FOUND", async () => {
    const ctx = mkCtx("manuscript-reviewer");

    vi.mocked(ctx.host.kb.listKeys).mockResolvedValue([]);

    const res = await executeManuscriptSummarize(
      { manuscriptId: "missing", sourceKbId: "kb-1" },
      ctx,
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NOT_FOUND");
    expect(res.message).toContain("missing");
  });
});
