// ──────────────────────────────────────────────────────
// Skill 10 tests — author-bio-generate
// TDD: red → green
// ──────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { authorBioGenerate } from "../author-bio-generate";

// Build a fixture LLM response programmatically — each bio is "lorem" repeated to land within ±10%.
const bio = (n: number) => Array(n).fill("lorem").join(" ");
const sample = [
  `BIO_50W: ${bio(50)}.`,
  `BIO_150W: ${bio(150)}.`,
  `BIO_300W: ${bio(300)}.`,
  `HEADSHOT_PROMPT: ${bio(25)}.`,
].join("\n\n");

describe("author-bio-generate", () => {
  it("produces 50w / 150w / 300w bios within ±10% word counts", async () => {
    const llm = vi.fn(async () => ({ text: sample }));
    const result = await authorBioGenerate.execute(
      { background: "Phoenix climate-fiction author with MFA + agent + forthcoming novel" },
      { llm },
    );
    const wc = (s: string) => s.trim().split(/\s+/).length;
    expect(wc(result.bio50)).toBeGreaterThanOrEqual(45);
    expect(wc(result.bio50)).toBeLessThanOrEqual(55);
    expect(wc(result.bio150)).toBeGreaterThanOrEqual(135);
    expect(wc(result.bio150)).toBeLessThanOrEqual(165);
    expect(wc(result.bio300)).toBeGreaterThanOrEqual(270);
    expect(wc(result.bio300)).toBeLessThanOrEqual(330);
    expect(result.headshotPrompt.length).toBeGreaterThan(20);
  });
});
