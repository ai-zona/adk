// ──────────────────────────────────────────────────────
// Skill Execute — manuscript-ingest
// Parses epub/docx/pdf/txt into chapters + KB blocks
// ──────────────────────────────────────────────────────

import type { SkillExecutionContext, SkillResult } from "../types";
import { fail, ok } from "../types";

export interface ManuscriptIngestInput {
  manuscriptId: string;
  fileType: "epub" | "docx" | "pdf" | "txt";
  source: string | { base64: string };
  targetKbId: string;
}

export interface ManuscriptChapter {
  index: number;
  title: string;
  wordCount: number;
  blocks: string[];
}

export interface ManuscriptIngestOutput {
  manuscriptId: string;
  chapters: ManuscriptChapter[];
  totalWordCount: number;
}

type ParsedChunk = { title: string; body: string };

export interface Parsers {
  parseTxt: (raw: string) => Promise<ParsedChunk[]>;
  parseEpub: (buf: Buffer) => Promise<ParsedChunk[]>;
  parseDocx: (buf: Buffer) => Promise<ParsedChunk[]>;
  parsePdf: (buf: Buffer) => Promise<ParsedChunk[]>;
}

/**
 * Split body text into ~400-word KB-ready blocks.
 * Paragraph boundaries are preserved; blocks may be slightly over target
 * when a single paragraph exceeds the target.
 */
function chunkIntoBlocks(body: string, target = 400): string[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const blocks: string[] = [];
  let cur: string[] = [];
  let words = 0;

  for (const p of paragraphs) {
    const w = p.split(/\s+/).length;
    if (words + w > target && cur.length) {
      blocks.push(cur.join("\n\n"));
      cur = [p];
      words = w;
    } else {
      cur.push(p);
      words += w;
    }
  }
  if (cur.length) blocks.push(cur.join("\n\n"));
  return blocks;
}

/**
 * Load raw bytes or string from a URL string or base64 object.
 * URL sources are fetched; base64 objects are decoded directly.
 */
async function loadBytes(source: ManuscriptIngestInput["source"]): Promise<Buffer | string> {
  if (typeof source === "string") {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return Buffer.from(source.base64, "base64");
}

/**
 * Execute the manuscript-ingest skill.
 *
 * @param input   - Validated skill input (caller responsible for schema validation)
 * @param ctx     - Skill execution context (workspaceId, agentSlug, host)
 * @param parsers - Format-specific parser implementations (injectable for testing)
 * @returns SkillResult — never throws on expected errors
 */
export async function executeManuscriptIngest(
  input: ManuscriptIngestInput,
  ctx: SkillExecutionContext,
  parsers: Parsers,
): Promise<SkillResult<ManuscriptIngestOutput>> {
  if (!input.manuscriptId || !input.targetKbId) {
    return fail("INVALID_INPUT", "manuscriptId and targetKbId are required");
  }

  let raw: Buffer | string;
  try {
    raw = await loadBytes(input.source);
  } catch (e) {
    return fail("PARSE_FAILED", `Failed to load source: ${(e as Error).message}`);
  }

  let chunks: ParsedChunk[];
  try {
    switch (input.fileType) {
      case "txt":
        chunks = await parsers.parseTxt(typeof raw === "string" ? raw : raw.toString("utf8"));
        break;
      case "epub":
        chunks = await parsers.parseEpub(raw as Buffer);
        break;
      case "docx":
        chunks = await parsers.parseDocx(raw as Buffer);
        break;
      case "pdf":
        chunks = await parsers.parsePdf(raw as Buffer);
        break;
      default:
        return fail("INVALID_INPUT", `Unsupported fileType: ${input.fileType}`);
    }
  } catch (e) {
    return fail("PARSE_FAILED", `Parser threw: ${(e as Error).message}`, {
      fileType: input.fileType,
    });
  }

  if (!chunks.length) {
    return fail("PARSE_FAILED", "Parser returned zero chapters", { fileType: input.fileType });
  }

  const chapters: ManuscriptChapter[] = chunks.map((c, i) => ({
    index: i,
    title: c.title || `Chapter ${i + 1}`,
    wordCount: c.body.split(/\s+/).filter(Boolean).length,
    blocks: chunkIntoBlocks(c.body),
  }));

  const totalWordCount = chapters.reduce((s, c) => s + c.wordCount, 0);

  for (const ch of chapters) {
    await ctx.host.kb.write(input.targetKbId, `${input.manuscriptId}/ch-${ch.index}`, {
      content: ch.blocks.join("\n\n---\n\n"),
      metadata: {
        manuscriptId: input.manuscriptId,
        chapterIndex: ch.index,
        title: ch.title,
        wordCount: ch.wordCount,
      },
    });
  }

  ctx.host.log("info", "manuscript-ingest complete", {
    manuscriptId: input.manuscriptId,
    chapterCount: chapters.length,
    totalWordCount,
  });

  return ok({ manuscriptId: input.manuscriptId, chapters, totalWordCount });
}
