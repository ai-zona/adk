// ──────────────────────────────────────────────────────
// Skill Execute — manuscript-summarize
// Reads chapters from KB, calls LLM inline, returns
// 5-line / 1-page / 3-page summaries + tags + comp titles
// ──────────────────────────────────────────────────────

import type { SkillExecutionContext, SkillResult } from "../types";
import { fail, ok } from "../types";

export interface ManuscriptSummarizeInput {
  manuscriptId: string;
  sourceKbId: string;
}

export interface ManuscriptSummarizeOutput {
  manuscriptId: string;
  fiveLine: string;
  onePage: string;
  threePage: string;
  tags: string[];
  compTitles: string[];
}

// Maximum manuscript characters forwarded to the LLM.
// ~200k chars ≈ 50k tokens — stays within a 100k-token context window with headroom.
const MAX_TEXT_CHARS = 200_000;

const SYSTEM_PROMPT = `You are a literary analyst summarizing an unpublished manuscript. Output MUST be valid JSON matching exactly:
{
  "fiveLine": "exactly 5 lines separated by \\n. L1=protagonist+central conflict. L2=setting+stakes. L3=rising action. L4=turning point. L5=resolution arc.",
  "onePage": "300-450 words, prose paragraphs, beginning hook to ending stake.",
  "threePage": "900-1200 words, full structural summary including subplots and thematic resonance.",
  "tags": ["4-8 thematic tags, lowercase, hyphenated"],
  "compTitles": ["3-5 published comp titles in 'Title by Author' format"]
}
Do NOT invent comp titles. No preamble. No markdown fences.`;

/**
 * Execute the manuscript-summarize skill.
 *
 * Reads all chapter entries for `manuscriptId` from the KB, concatenates them
 * (truncating at 200 000 chars), and issues a single LLM call requesting a
 * structured JSON response.  The parsed result is returned as-is after minimal
 * shape validation.
 *
 * @param input - Validated skill input (caller responsible for schema validation)
 * @param ctx   - Skill execution context (workspaceId, agentSlug, host)
 * @returns SkillResult — never throws on expected errors
 */
export async function executeManuscriptSummarize(
  input: ManuscriptSummarizeInput,
  ctx: SkillExecutionContext,
): Promise<SkillResult<ManuscriptSummarizeOutput>> {
  if (!input.manuscriptId || !input.sourceKbId) {
    return fail("INVALID_INPUT", "manuscriptId and sourceKbId are required");
  }

  // ── 1. Discover chapter keys ──────────────────────────────────────────────
  const keys = await ctx.host.kb.listKeys(input.sourceKbId, `${input.manuscriptId}/`);
  if (!keys.length) {
    return fail("NOT_FOUND", `No chapters found for manuscript ${input.manuscriptId}`);
  }

  // ── 2. Assemble full text ─────────────────────────────────────────────────
  const chapterContents: string[] = [];
  for (const key of keys.sort()) {
    const entry = await ctx.host.kb.read(input.sourceKbId, key);
    if (entry?.content) chapterContents.push(entry.content);
  }

  const fullText = chapterContents.join("\n\n=== CHAPTER BREAK ===\n\n");
  if (!fullText.trim()) {
    return fail("NOT_FOUND", "All chapters are empty");
  }

  const truncated =
    fullText.length > MAX_TEXT_CHARS
      ? `${fullText.slice(0, MAX_TEXT_CHARS)}\n\n[TRUNCATED]`
      : fullText;

  // ── 3. LLM call ───────────────────────────────────────────────────────────
  let resp: { content: string };
  try {
    resp = await ctx.host.llm.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Summarize this manuscript:\n\n${truncated}` },
      ],
      temperature: 0.3,
      maxTokens: 4096,
    });
  } catch (e) {
    return fail("DEPENDENCY_FAILED", `LLM call failed: ${(e as Error).message}`);
  }

  const content = typeof resp.content === "string" ? resp.content : "";

  // ── 4. Parse + validate JSON response ────────────────────────────────────
  try {
    const o = JSON.parse(content.trim());
    const parsed: ManuscriptSummarizeOutput = {
      manuscriptId: input.manuscriptId,
      fiveLine: String(o.fiveLine ?? ""),
      onePage: String(o.onePage ?? ""),
      threePage: String(o.threePage ?? ""),
      tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
      compTitles: Array.isArray(o.compTitles) ? o.compTitles.map(String) : [],
    };

    if (!parsed.fiveLine || parsed.fiveLine.split("\n").length < 3) {
      return fail("DEPENDENCY_FAILED", "malformed five-line summary");
    }

    ctx.host.log("info", "manuscript-summarize complete", {
      manuscriptId: input.manuscriptId,
      tags: parsed.tags,
    });

    return ok(parsed);
  } catch {
    return fail("DEPENDENCY_FAILED", "LLM returned non-JSON content", {
      snippet: content.slice(0, 200),
    });
  }
}
