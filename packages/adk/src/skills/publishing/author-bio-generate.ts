// ──────────────────────────────────────────────────────
// Skill 10 — author-bio-generate
// Generates 50w / 150w / 300w author bios plus a
// headshot prompt from a freeform author background.
// executionMode: INLINE  (single LLM call, no external deps)
// ──────────────────────────────────────────────────────

import { defineSkill } from "../define-skill";

// ─── Types ───────────────────────────────────────────

export interface AuthorBioGenerateInput {
  /** Freeform author background (credentials, genre, milestones, tone notes, etc.). Min 20 chars. */
  background: string;
}

export interface AuthorBioGenerateOutput {
  /** Approximately 50-word third-person bio. */
  bio50: string;
  /** Approximately 150-word third-person bio. */
  bio150: string;
  /** Approximately 300-word third-person bio. */
  bio300: string;
  /** Stable-diffusion-style headshot prompt (20-40 words). */
  headshotPrompt: string;
}

export interface AuthorBioGenerateContext {
  /** Inline LLM call — injected so tests can mock without I/O. */
  llm: (args: { prompt: string }) => Promise<{ text: string }>;
}

// ─── Prompt template ─────────────────────────────────

const PROMPT = (background: string) => `\
You are a publishing-industry copywriter specialising in author branding.
Given the author background below, emit FOUR labelled sections in the EXACT format shown.
Do NOT add any other commentary, headings, or preamble — output only the four labelled sections.

BIO_50W: <approximately 50 words ±10%, third-person, present tense>

BIO_150W: <approximately 150 words ±10%, third-person, present tense, suitable for a book jacket>

BIO_300W: <approximately 300 words ±10%, third-person, present tense, suitable for a press kit or festival programme>

HEADSHOT_PROMPT: <a single sentence stable-diffusion-style portrait prompt, 20-40 words, beginning with "Professional author headshot of">

AUTHOR BACKGROUND:
${background}`;

// ─── Parser ───────────────────────────────────────────

/**
 * Extracts the text following a labelled section header.
 * Matches everything between the label and the next label (or end of string).
 * Note: label character class includes digits ([A-Z0-9_]) because labels such as
 * BIO_50W and BIO_150W contain numeric characters.
 */
const extract = (label: string, text: string): string =>
  text.match(new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n[A-Z0-9_]+:|$)`))?.[1]?.trim() ?? "";

// ─── Manifest ────────────────────────────────────────

export const authorBioGenerateManifest = defineSkill({
  name: "author-bio-generate",
  version: "1.0.0",
  description:
    "Generate three author bios (50w, 150w, 300w) plus a headshot prompt from a " +
    "freeform author background. Single inline LLM call — no external data sources required.",
  category: "publishing",
  tags: ["bio", "author", "copywriting", "inline-llm"],
  tools: [
    {
      name: "generate",
      description:
        "Emit three bio lengths (50w / 150w / 300w) plus a stable-diffusion headshot prompt " +
        "from the provided author background text.",
      inputSchema: {
        type: "object",
        required: ["background"],
        properties: {
          background: {
            type: "string",
            minLength: 20,
            description:
              "Freeform author background: genre, credentials, awards, forthcoming works, tone notes.",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["bio50", "bio150", "bio300", "headshotPrompt"],
        properties: {
          bio50: { type: "string", description: "~50-word third-person bio." },
          bio150: { type: "string", description: "~150-word third-person bio." },
          bio300: { type: "string", description: "~300-word third-person bio." },
          headshotPrompt: {
            type: "string",
            description: "Stable-diffusion portrait prompt (20-40 words).",
          },
        },
      },
    },
  ],
  metadata: {
    executionMode: "INLINE",
  },
});

// ─── Skill Object ────────────────────────────────────

export const authorBioGenerate = {
  manifest: authorBioGenerateManifest,

  async execute(
    input: AuthorBioGenerateInput,
    ctx: AuthorBioGenerateContext,
  ): Promise<AuthorBioGenerateOutput> {
    const { text } = await ctx.llm({ prompt: PROMPT(input.background) });

    return {
      bio50: extract("BIO_50W", text),
      bio150: extract("BIO_150W", text),
      bio300: extract("BIO_300W", text),
      headshotPrompt: extract("HEADSHOT_PROMPT", text),
    };
  },
};
