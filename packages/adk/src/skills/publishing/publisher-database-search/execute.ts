// ──────────────────────────────────────────────────────
// Skill Execute — publisher-database-search
// DataApi: PublishersGlobal (publishers-global-v1)
// AIZ unlock required (200 AIZ) + per-call meter (4 AIZ/call)
// ──────────────────────────────────────────────────────

import type { SkillExecutionContext, SkillResult } from "../types";
import { fail, ok } from "../types";

export interface PublisherSearchInput {
  genre: string;
  themes?: string[];
  targetAudience?: string;
  wordCount: number;
  compTitles?: string[];
  limit?: number;
}

export interface PublisherSearchResult {
  publisherId: string;
  name: string;
  imprint: string;
  fitScore: number;
  acquiringEditors: { name: string; recentAcquisitions: string[] }[];
  submissionGuidelines: string;
}

interface RawPublisher {
  id: string;
  name: string;
  imprint: string;
  genres: string[];
  wordCountMin: number;
  wordCountMax: number;
  acquiringEditors: { name: string; recentAcquisitions: string[] }[];
  submissionGuidelines: string;
}

/**
 * Score a publisher's fit for the given search input.
 *
 * Rubric (max 100):
 *  +50  genre exact match
 *  +15  at least one theme matches a publisher genre tag
 *  +25  word count falls within publisher's min–max range
 *  +5   publisher has at least one acquiring editor listed
 *  +5   at least one acquiring editor has recent acquisitions
 */
function rank(p: RawPublisher, input: PublisherSearchInput): number {
  let score = 0;
  if (p.genres.includes(input.genre)) score += 50;
  if (input.themes?.some((t) => p.genres.includes(t))) score += 15;
  if (input.wordCount >= p.wordCountMin && input.wordCount <= p.wordCountMax) score += 25;
  if (p.acquiringEditors.length > 0) score += 5;
  if (p.acquiringEditors.some((e) => e.recentAcquisitions.length > 0)) score += 5;
  return Math.min(score, 100);
}

/**
 * Execute the publisher-database-search skill.
 *
 * Calls the PublishersGlobal DataApi connector, ranks results by fit score,
 * and returns the top `limit` matches (default 10).
 *
 * Error codes:
 *  INVALID_INPUT      — genre or wordCount missing
 *  ENTITLEMENT_DENIED — AIZ unlock not held by caller
 *  RATE_LIMITED       — connector returned 429
 *  DEPENDENCY_FAILED  — any other DataApi failure
 */
export async function executePublisherDatabaseSearch(
  input: PublisherSearchInput,
  ctx: SkillExecutionContext,
): Promise<SkillResult<{ results: PublisherSearchResult[] }>> {
  if (!input.genre || !input.wordCount) {
    return fail("INVALID_INPUT", "genre and wordCount are required");
  }

  let raw: unknown;
  try {
    raw = await ctx.host.dataApi.call("publishers-global-v1", "search", {
      genre: input.genre,
      themes: input.themes ?? [],
      wordCount: input.wordCount,
      compTitles: input.compTitles ?? [],
      limit: input.limit ?? 10,
    });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    if (/entitlement|unlock/i.test(msg)) return fail("ENTITLEMENT_DENIED", msg);
    if (/rate.?limit|429/i.test(msg)) return fail("RATE_LIMITED", msg);
    return fail("DEPENDENCY_FAILED", `PublishersGlobal call failed: ${msg}`);
  }

  const publishers = Array.isArray((raw as { publishers?: unknown[] })?.publishers)
    ? (raw as { publishers: RawPublisher[] }).publishers
    : [];

  const ranked: PublisherSearchResult[] = publishers
    .map((p) => ({
      publisherId: p.id,
      name: p.name,
      imprint: p.imprint,
      fitScore: rank(p, input),
      acquiringEditors: p.acquiringEditors,
      submissionGuidelines: p.submissionGuidelines,
    }))
    .filter((p) => p.fitScore > 0)
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, input.limit ?? 10);

  return ok({ results: ranked });
}
