// ──────────────────────────────────────────────────────
// Skill Execute — query-letter-generate
// Produces a one-page, industry-standard query letter via a single LLM call.
// Output is split at the ATTACHMENT_INSTRUCTIONS sentinel line.
// ──────────────────────────────────────────────────────

import type { SkillExecutionContext, SkillResult } from "../types";
import { fail, ok } from "../types";

export interface QueryLetterInput {
  manuscript: {
    title: string;
    genre: string;
    wordCount: number;
    summary: string;
    compTitles?: string[];
    authorBio?: string;
  };
  publisher: {
    name: string;
    acquiringEditor?: string;
    submissionGuidelines?: string;
    allowsSimultaneous?: boolean;
  };
}

export interface QueryLetterOutput {
  letter: string;
  attachmentInstructions: string;
}

const SYSTEM_PROMPT = `You are a query-letter writer who has placed dozens of debut novels. Draft a SINGLE one-page query letter. Structure (in order, blank lines between):
1. Salutation — "Dear <acquiringEditor>," when present, else "Dear <publisher.name> editorial team,"
2. Hook (3-5 sentences) — opens with a hook line (no rhetorical questions, no "in a world where"), introduces protagonist + central conflict, ends on the stakes.
3. Book pitch — opens "<TITLE> is a <wordCount>-word <genre> novel that will appeal to readers of <comp1> and <comp2>." then 4-6 sentences ending on a stake. Title ALL CAPS.
4. Bio (2-3 sentences) — use authorBio when present; else one neutral sentence ("This is my debut novel."). Never apologize.
5. Housekeeping (2-3 sentences) — why this publisher (cite a real signal from submissionGuidelines or skip), simultaneous-submission disclosure if allowsSimultaneous=true, "Thank you for your time and consideration." then "Sincerely," then "<Author Name>".

Rules: no markdown, no bullets, no headings, no [BRACKETS] except literally "<Author Name>". Do not invent comp titles or submissionGuidelines context. After the letter, on a final separate line:
ATTACHMENT_INSTRUCTIONS: <one sentence per guidelines, or "Send query letter only.">
Output letter, then newline, then the ATTACHMENT_INSTRUCTIONS line. Nothing else.`;

/**
 * Execute the query-letter-generate skill.
 *
 * Calls the LLM with a detailed system prompt instructing 5-section structure.
 * Splits the raw response at "ATTACHMENT_INSTRUCTIONS:" to extract the letter
 * body and attachment guidance separately.
 *
 * Validates that the letter body contains at least 3 blank-line-separated
 * paragraphs (salutation, hook, pitch, bio, housekeeping yield 5+).
 *
 * Error codes:
 *  INVALID_INPUT      — publisher.name, manuscript.title, or manuscript.summary missing
 *  DEPENDENCY_FAILED  — LLM call failed, or letter has fewer than 3 paragraphs
 */
export async function executeQueryLetterGenerate(
  input: QueryLetterInput,
  ctx: SkillExecutionContext,
): Promise<SkillResult<QueryLetterOutput>> {
  if (!input.publisher?.name) {
    return fail("INVALID_INPUT", "publisher.name is required");
  }
  if (!input.manuscript?.title || !input.manuscript.summary) {
    return fail("INVALID_INPUT", "manuscript title and summary are required");
  }

  let resp;
  try {
    resp = await ctx.host.llm.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `MANUSCRIPT:\n${JSON.stringify(input.manuscript, null, 2)}\n\nPUBLISHER:\n${JSON.stringify(input.publisher, null, 2)}`,
        },
      ],
      temperature: 0.5,
      maxTokens: 2048,
    });
  } catch (e) {
    return fail("DEPENDENCY_FAILED", `LLM call failed: ${(e as Error).message}`);
  }

  const raw = typeof resp.content === "string" ? resp.content.trim() : "";
  const SENTINEL = "ATTACHMENT_INSTRUCTIONS:";
  const idx = raw.lastIndexOf(SENTINEL);
  const letter = (idx >= 0 ? raw.slice(0, idx) : raw).trim();
  const attachmentInstructions =
    idx >= 0 ? raw.slice(idx + SENTINEL.length).trim() : "Send query letter only.";

  if (letter.split(/\n\s*\n/).filter((p) => p.trim()).length < 3) {
    return fail("DEPENDENCY_FAILED", "letter has fewer than 3 paragraphs");
  }

  return ok({ letter, attachmentInstructions });
}
