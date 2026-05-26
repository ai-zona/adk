// ──────────────────────────────────────────────────────
// Skill Execute — book-edit-suggest
// SANDBOX-safe: no node:fs / node:net / node:http / node:child_process imports.
// Reads chapter text from KB, calls LLM, persists edit suggestions back to KB.
// ──────────────────────────────────────────────────────

import type { SkillExecutionContext, SkillResult } from "../types";
import { fail, ok } from "../types";

export interface BookEditSuggestInput {
  manuscriptId: string;
  sourceKbId: string;
  suggestionsKbId: string;
  chapterStart: number;
  chapterEnd: number;
}

export interface EditSuggestion {
  chapterIndex: number;
  kind: "line" | "structural";
  location: string;
  note: string;
  suggestedText: string;
}

const SYSTEM_PROMPT = `You are a careful line + structural editor reviewing a chapter range. Output a JSON array of suggestions. Each MUST have:
- chapterIndex (integer)
- kind ("line" for word/sentence-level, "structural" for pacing/scene-level)
- location (e.g. "paragraph 3, sentence 2" or "scene transition mid-chapter")
- note (1-3 sentences explaining the issue)
- suggestedText (proposed replacement; for structural, brief description of the change)
Return AT LEAST 3 suggestions per chapter when text is non-trivial. Output ONLY the JSON array — no preamble.`;

/**
 * Execute the book-edit-suggest skill.
 *
 * Reads chapters in [chapterStart, chapterEnd] from the KB, calls the LLM for
 * line + structural edit suggestions, validates the response contains ≥ 3
 * suggestions, persists the result to suggestionsKbId, and returns the list.
 *
 * SANDBOX constraints: no node:fs / node:net / node:child_process usage —
 * all I/O flows through ctx.host.* injected by the sandbox runtime.
 *
 * @param input - Validated skill input
 * @param ctx   - Skill execution context (workspaceId, agentSlug, host)
 * @returns SkillResult — never throws on expected errors
 */
export async function executeBookEditSuggest(
  input: BookEditSuggestInput,
  ctx: SkillExecutionContext,
): Promise<SkillResult<{ suggestions: EditSuggestion[] }>> {
  if (input.chapterEnd < input.chapterStart) {
    return fail("INVALID_INPUT", "chapterEnd must be >= chapterStart");
  }

  // ── 1. Read chapter text from KB ─────────────────────────────────────────
  const chapters: { index: number; content: string }[] = [];
  for (let i = input.chapterStart; i <= input.chapterEnd; i++) {
    const entry = await ctx.host.kb.read(input.sourceKbId, `${input.manuscriptId}/ch-${i}`);
    if (entry?.content) {
      chapters.push({ index: i, content: entry.content });
    }
  }

  if (!chapters.length) {
    return fail("NOT_FOUND", "No chapters in range");
  }

  // ── 2. Build user prompt ──────────────────────────────────────────────────
  const userPrompt = chapters.map((c) => `=== CHAPTER ${c.index} ===\n${c.content}`).join("\n\n");

  // ── 3. LLM call ───────────────────────────────────────────────────────────
  let resp: { content: string };
  try {
    resp = await ctx.host.llm.chat({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      maxTokens: 4096,
    });
  } catch (e) {
    return fail("DEPENDENCY_FAILED", `LLM call failed: ${(e as Error).message}`);
  }

  // ── 4. Parse + validate suggestions ──────────────────────────────────────
  let suggestions: EditSuggestion[] = [];
  try {
    const raw = typeof resp.content === "string" ? resp.content.trim() : "";
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    suggestions = parsed
      .map((s) => ({
        chapterIndex: Number(s.chapterIndex ?? 0),
        kind: s.kind === "structural" ? ("structural" as const) : ("line" as const),
        location: String(s.location ?? ""),
        note: String(s.note ?? ""),
        suggestedText: String(s.suggestedText ?? ""),
      }))
      .filter((s) => s.note);
  } catch (e) {
    return fail("DEPENDENCY_FAILED", `LLM returned malformed JSON: ${(e as Error).message}`);
  }

  if (suggestions.length < 3) {
    return fail("DEPENDENCY_FAILED", "fewer than 3 actionable suggestions");
  }

  // ── 5. Persist suggestions to KB ─────────────────────────────────────────
  await ctx.host.kb.write(input.suggestionsKbId, `${input.manuscriptId}/edits-${Date.now()}`, {
    content: JSON.stringify(suggestions, null, 2),
    metadata: {
      manuscriptId: input.manuscriptId,
      chapterStart: input.chapterStart,
      chapterEnd: input.chapterEnd,
      suggestionCount: suggestions.length,
    },
  });

  ctx.host.log("info", "book-edit-suggest complete", {
    manuscriptId: input.manuscriptId,
    chapterStart: input.chapterStart,
    chapterEnd: input.chapterEnd,
    suggestionCount: suggestions.length,
  });

  return ok({ suggestions });
}
