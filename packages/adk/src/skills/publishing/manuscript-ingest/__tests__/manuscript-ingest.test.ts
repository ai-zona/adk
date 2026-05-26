import { describe, expect, it, vi } from "vitest";
import { mkCtx } from "../../__tests__/test-helpers";
import { type Parsers, executeManuscriptIngest } from "../execute";

const okParsers: Parsers = {
  parseTxt: vi.fn().mockResolvedValue([
    { title: "Chapter 1", body: "Once upon a time.\n\nThere was a hero." },
    { title: "Chapter 2", body: "The hero set out.\n\nIt was a long journey." },
  ]),
  parseEpub: vi.fn(),
  parseDocx: vi.fn(),
  parsePdf: vi.fn(),
};

const corruptParsers: Parsers = {
  parseTxt: vi.fn(),
  parseEpub: vi.fn().mockRejectedValue(new Error("corrupt zip header")),
  parseDocx: vi.fn(),
  parsePdf: vi.fn(),
};

describe("manuscript-ingest", () => {
  it("txt input round-trips to chapters + KB writes", async () => {
    const ctx = mkCtx("manuscript-reviewer");
    const res = await executeManuscriptIngest(
      {
        manuscriptId: "m1",
        fileType: "txt",
        source: { base64: Buffer.from("x").toString("base64") },
        targetKbId: "kb",
      },
      ctx,
      okParsers,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.chapters).toHaveLength(2);
    expect(res.data.totalWordCount).toBeGreaterThan(0);
    expect(ctx.host.kb.write).toHaveBeenCalledTimes(2);
  });

  it("corrupt input returns structured PARSE_FAILED (no throw)", async () => {
    const ctx = mkCtx("manuscript-reviewer");
    const res = await executeManuscriptIngest(
      {
        manuscriptId: "m2",
        fileType: "epub",
        source: { base64: "AAAA" },
        targetKbId: "kb",
      },
      ctx,
      corruptParsers,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("PARSE_FAILED");
    expect(res.message).toContain("corrupt zip header");
  });
});
