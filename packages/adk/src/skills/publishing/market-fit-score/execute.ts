// ──────────────────────────────────────────────────────
// Skill Execute — market-fit-score
// DataApi: PublishersGlobal (publishers-global-v1)
// AIZ unlock required (200 AIZ) + per-call meter (4 AIZ/call)
// LLM scores 0-100 fit between a manuscript and a single publisher catalog.
// ──────────────────────────────────────────────────────

import type { SkillExecutionContext, SkillResult } from "../types";
import { fail, ok } from "../types";

export interface MarketFitInput {
  manuscript: {
    title?: string;
    genre: string;
    wordCount: number;
    themes?: string[];
    summary: string;
    compTitles?: string[];
  };
  publisherId: string;
}

export interface MarketFitOutput {
  score: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You are a publishing-industry analyst. Given a manuscript metadata blob and a publisher catalog blob, output JSON exactly:
{ "score": <integer 0-100>, "reasoning": "<3-6 sentences citing specific catalog signals>" }
Rubric: 90-100 genre exact + WC in range + themes overlap + recent comparable acquisitions. 70-89 strong fit, one minor mismatch. 50-69 plausible but mismatched on a key dimension. 30-49 weak; query at own risk. 0-29 clear no.
Reasoning MUST cite at least one concrete catalog signal. Output ONLY the JSON.`;

/**
 * Execute the market-fit-score skill.
 *
 * Fetches the publisher's catalog via the PublishersGlobal DataApi connector,
 * then calls an LLM to score fit (0-100) with 3-6 sentences of reasoning.
 *
 * Score is clamped to [0, 100] and rounded to the nearest integer.
 *
 * Error codes:
 *  INVALID_INPUT      — publisherId or manuscript.summary missing
 *  ENTITLEMENT_DENIED — AIZ unlock not held by caller
 *  NOT_FOUND          — publisherId not found in catalog
 *  DEPENDENCY_FAILED  — DataApi or LLM failure, or malformed LLM response
 */
export async function executeMarketFitScore(
  input: MarketFitInput,
  ctx: SkillExecutionContext,
): Promise<SkillResult<MarketFitOutput>> {
  if (!input.publisherId || !input.manuscript?.summary) {
    return fail("INVALID_INPUT", "publisherId and manuscript.summary are required");
  }

  let catalog: unknown;
  try {
    catalog = await ctx.host.dataApi.call("publishers-global-v1", "getCatalog", {
      publisherId: input.publisherId,
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/entitlement|unlock/i.test(msg)) return fail("ENTITLEMENT_DENIED", msg);
    return fail("DEPENDENCY_FAILED", `Catalog fetch failed: ${msg}`);
  }

  if (!catalog) {
    return fail("NOT_FOUND", `Publisher ${input.publisherId} not in catalog`);
  }

  let resp;
  try {
    resp = await ctx.host.llm.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `MANUSCRIPT:\n${JSON.stringify(input.manuscript, null, 2)}\n\nPUBLISHER CATALOG:\n${JSON.stringify(catalog, null, 2)}`,
        },
      ],
      temperature: 0.2,
      maxTokens: 1024,
    });
  } catch (e) {
    return fail("DEPENDENCY_FAILED", `LLM call failed: ${(e as Error).message}`);
  }

  try {
    const raw = typeof resp.content === "string" ? resp.content.trim() : "";
    const o = JSON.parse(raw);
    const score = Math.max(0, Math.min(100, Math.round(Number(o.score))));
    const reasoning = String(o.reasoning ?? "");
    if (!Number.isInteger(score)) return fail("DEPENDENCY_FAILED", "score out of range");
    if (!reasoning.trim()) return fail("DEPENDENCY_FAILED", "empty reasoning");
    return ok({ score, reasoning });
  } catch {
    return fail("DEPENDENCY_FAILED", "LLM returned non-JSON");
  }
}
