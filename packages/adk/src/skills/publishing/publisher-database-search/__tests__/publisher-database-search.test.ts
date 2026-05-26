// ──────────────────────────────────────────────────────
// Tests — publisher-database-search
// 3 cases: golden-path, AIZ-unlock-denied, rate-limit
// ──────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { mkCtx, mkHost } from "../../__tests__/test-helpers";
import { executePublisherDatabaseSearch } from "../execute";

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/publishers-global-mock.json"), "utf8"),
);

const ctxWithCall = (impl: (...a: unknown[]) => Promise<unknown>) =>
  mkCtx("publisher-researcher", mkHost({ dataApi: { call: vi.fn(impl) } }));

describe("publisher-database-search", () => {
  it("golden-path returns ranked list sorted by fitScore descending", async () => {
    const ctx = ctxWithCall(async () => fixture);
    const res = await executePublisherDatabaseSearch(
      { genre: "literary-fiction", wordCount: 85000, themes: ["coming-of-age"] },
      ctx,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.results.length).toBeGreaterThan(0);

    // Scores must be sorted descending
    const scores = res.data.results.map((r) => r.fitScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));

    // Top result must match literary-fiction (genre exact match = 50pts minimum)
    expect(res.data.results[0]?.fitScore).toBeGreaterThanOrEqual(50);

    // Each result must carry submission guidelines and acquiringEditors
    for (const r of res.data.results) {
      expect(typeof r.submissionGuidelines).toBe("string");
      expect(Array.isArray(r.acquiringEditors)).toBe(true);
    }
  });

  it("AIZ-unlock-denied returns ENTITLEMENT_DENIED", async () => {
    const ctx = ctxWithCall(async () => {
      throw new Error("entitlement check failed: AIZ unlock required (200 AIZ)");
    });
    const res = await executePublisherDatabaseSearch({ genre: "sci-fi", wordCount: 95000 }, ctx);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("ENTITLEMENT_DENIED");
  });

  it("rate-limit on the connector returns RATE_LIMITED", async () => {
    const ctx = ctxWithCall(async () => {
      throw new Error("429 rate limit exceeded");
    });
    const res = await executePublisherDatabaseSearch(
      { genre: "literary-fiction", wordCount: 80000 },
      ctx,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("RATE_LIMITED");
  });
});
