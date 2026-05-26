// ──────────────────────────────────────────────────────
// Skill 7 — query-letter-personalize
// Personalize a query letter using an acquiring editor's
// recent acquisitions (via publishers-global-v1 connector).
// executionMode: INLINE
// ──────────────────────────────────────────────────────

import { defineSkill } from "../define-skill";

// ─── Types ───────────────────────────────────────────

export interface QueryLetterPersonalizeInput {
  /** The raw query letter produced by skill 6. */
  queryLetter: string;
  /** Acquiring editor identifier (used to look up recent acquisitions). */
  editorId: string;
}

export interface QueryLetterPersonalizeOutput {
  /** The query letter with a personalization paragraph injected (or the original if no acquisitions). */
  personalized: string;
  /** Number of recent acquisitions referenced in the personalization. 0 means no LLM call was made. */
  acquisitionsUsed: number;
}

export interface AcquisitionRecord {
  title: string;
  year: number;
}

export interface QueryLetterPersonalizeContext {
  /** Inline LLM call — returns the revised letter text. */
  llm: (args: { prompt: string }) => Promise<{ text: string }>;
  /** Host-fn boundary for the publishers-global-v1 DataApiConnector. */
  dataApiCall: (args: {
    slug: string;
    op: string;
    params: Record<string, unknown>;
  }) => Promise<{ acquisitions: AcquisitionRecord[] }>;
  /** Workspace identifier (entitlement enforcement is upstream at host-fn boundary). */
  workspaceId: string;
}

// ─── Manifest ────────────────────────────────────────

export const queryLetterPersonalizeManifest = defineSkill({
  name: "query-letter-personalize",
  version: "1.0.0",
  description:
    "Personalize a query letter by inserting one paragraph that ties the editor's recent acquisitions thematically to the author's manuscript. Falls back gracefully when no acquisitions are available.",
  category: "publishing",
  tags: ["query-letter", "personalization", "publishing"],
  tools: [
    {
      name: "personalize",
      description:
        "Inject a personalization paragraph into a query letter using the editor's recent acquisitions from the publishers-global-v1 connector.",
      inputSchema: {
        type: "object",
        required: ["queryLetter", "editorId"],
        properties: {
          queryLetter: {
            type: "string",
            minLength: 50,
            description: "The full query letter text.",
          },
          editorId: {
            type: "string",
            description: "Acquiring editor identifier.",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["personalized", "acquisitionsUsed"],
        properties: {
          personalized: {
            type: "string",
            description: "Query letter with personalization injected.",
          },
          acquisitionsUsed: {
            type: "number",
            description: "Count of acquisitions referenced (0 = passthrough).",
          },
        },
      },
    },
  ],
});

// ─── Prompt Template ─────────────────────────────────

function buildPrompt(letter: string, acquisitions: AcquisitionRecord[]): string {
  const acqList = acquisitions.map((a) => `- "${a.title}" (${a.year})`).join("\n");

  return [
    "You are a query-letter polish assistant.",
    "Insert ONE personalization paragraph between the salutation and the opening pitch.",
    "Reference 1-3 of the editor's recent acquisitions; tie them thematically to the author's manuscript.",
    "Keep tone professional.",
    "Do NOT alter any other paragraph.",
    "",
    "EDITOR'S RECENT ACQUISITIONS:",
    acqList,
    "",
    "ORIGINAL QUERY LETTER:",
    letter,
    "",
    "Return ONLY the revised letter, no commentary.",
  ].join("\n");
}

// ─── Skill Object ────────────────────────────────────

export const queryLetterPersonalize = {
  manifest: queryLetterPersonalizeManifest,

  async execute(
    input: QueryLetterPersonalizeInput,
    ctx: QueryLetterPersonalizeContext,
  ): Promise<QueryLetterPersonalizeOutput> {
    // Fetch recent acquisitions via the publishers-global-v1 connector.
    // Entitlement is enforced upstream at the host-fn boundary (same as skill 4).
    const { acquisitions } = await ctx.dataApiCall({
      slug: "publishers-global-v1",
      op: "editor.acquisitions",
      params: { editorId: input.editorId, limit: 5 },
    });

    // Graceful fallback: no acquisitions available → return original unchanged.
    if (acquisitions.length === 0) {
      return { personalized: input.queryLetter, acquisitionsUsed: 0 };
    }

    // Inline LLM call — insert the personalization paragraph.
    const { text } = await ctx.llm({
      prompt: buildPrompt(input.queryLetter, acquisitions),
    });

    return {
      personalized: text.trim(),
      acquisitionsUsed: acquisitions.length,
    };
  },
};
