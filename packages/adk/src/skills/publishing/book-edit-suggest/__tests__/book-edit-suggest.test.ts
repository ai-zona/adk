// ──────────────────────────────────────────────────────
// Tests — book-edit-suggest
// ──────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mkCtx, mkHost } from "../../__tests__/test-helpers";
import { executeBookEditSuggest } from "../execute";

describe("book-edit-suggest", () => {
  it("skill body type-checks under sandbox constraints (no fs/net imports)", () => {
    const src = readFileSync(resolve(__dirname, "../execute.ts"), "utf8");
    const banned = [
      /from\s+["']node:fs["']/,
      /from\s+["']node:net["']/,
      /from\s+["']node:http["']/,
      /from\s+["']node:child_process["']/,
      /require\(["']fs["']\)/,
    ];
    for (const pattern of banned) {
      expect(src).not.toMatch(pattern);
    }
  });

  it("golden-path produces >= 3 edit suggestions", async () => {
    const goldenJson = JSON.stringify([
      {
        chapterIndex: 0,
        kind: "line",
        location: "p1, s1",
        note: "Tighten opening.",
        suggestedText: "Replacement.",
      },
      {
        chapterIndex: 0,
        kind: "structural",
        location: "scene break",
        note: "Add transition.",
        suggestedText: "Insert beat.",
      },
      {
        chapterIndex: 0,
        kind: "line",
        location: "p3, s2",
        note: "Cut filler.",
        suggestedText: "She left.",
      },
    ]);

    const ctx = mkCtx(
      "manuscript-reviewer",
      mkHost({
        llm: {
          chat: vi.fn().mockResolvedValue({ content: goldenJson, costUsd: 0.01, model: "t" }),
        },
        kb: {
          read: vi.fn().mockResolvedValue({ content: "Chapter content." }),
          write: vi.fn().mockResolvedValue(undefined),
          listKeys: vi.fn(),
        },
      }),
    );

    const res = await executeBookEditSuggest(
      {
        manuscriptId: "m1",
        sourceKbId: "kb-1",
        suggestionsKbId: "kb-edits",
        chapterStart: 0,
        chapterEnd: 0,
      },
      ctx,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.suggestions.length).toBeGreaterThanOrEqual(3);
    expect(ctx.host.kb.write).toHaveBeenCalled();
  });
});
