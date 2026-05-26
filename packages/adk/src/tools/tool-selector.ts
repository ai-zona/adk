// ──────────────────────────────────────────────────────
// ADK Tool Selector — Dynamic per-turn tool filtering
// ──────────────────────────────────────────────────────

import type { ChatMessage } from "../types/llm";
import type { ToolDef } from "../types/tool";

/** Tool selection strategy */
export type ToolSelectionStrategy = "all" | "keyword" | "deferred";

/** Tool selection configuration */
export interface ToolSelectionConfig {
  /** Max tools to send to LLM per turn (default: 20) */
  maxToolsPerTurn?: number;
  /** Selection strategy (default: "all") */
  strategy?: ToolSelectionStrategy;
  /** Minimum relevance score to include (default: 0.1) */
  minRelevance?: number;
  /** Boost tools used in recent turns (default: true) */
  includeRecentlyUsed?: boolean;
  /** How many recent turns to consider for recently-used boost (default: 3) */
  recentTurnWindow?: number;
  /** Tool names that are never filtered out */
  alwaysInclude?: string[];
}

/** Tool relevance score */
export interface ToolRelevanceScore {
  tool: ToolDef;
  score: number;
  reason: string;
}

/** Default configuration values */
const DEFAULTS = {
  maxToolsPerTurn: 20,
  strategy: "all" as ToolSelectionStrategy,
  minRelevance: 0.1,
  includeRecentlyUsed: true,
  recentTurnWindow: 3,
};

/**
 * ToolSelector — selects relevant tools for each LLM turn.
 *
 * Strategies:
 * - "all": pass through all tools (no filtering)
 * - "keyword": extract keywords from recent messages, match against tool name + description
 */
export class ToolSelector {
  private config: Required<Omit<ToolSelectionConfig, "alwaysInclude">> & {
    alwaysInclude: string[];
  };

  constructor(config?: ToolSelectionConfig) {
    this.config = {
      maxToolsPerTurn: config?.maxToolsPerTurn ?? DEFAULTS.maxToolsPerTurn,
      strategy: config?.strategy ?? DEFAULTS.strategy,
      minRelevance: config?.minRelevance ?? DEFAULTS.minRelevance,
      includeRecentlyUsed: config?.includeRecentlyUsed ?? DEFAULTS.includeRecentlyUsed,
      recentTurnWindow: config?.recentTurnWindow ?? DEFAULTS.recentTurnWindow,
      alwaysInclude: config?.alwaysInclude ?? [],
    };
  }

  /** Select tools relevant to the current conversation turn */
  selectTools(
    allTools: ToolDef[],
    messages: ChatMessage[],
    _turnNumber: number,
    recentToolCalls?: string[],
  ): ToolDef[] {
    if (this.config.strategy === "all") {
      return allTools.slice(0, this.config.maxToolsPerTurn);
    }

    // Deferred strategy: only return non-deferred tools + any already-loaded deferred tools
    if (this.config.strategy === "deferred") {
      const eager = allTools.filter((t) => !t.deferLoading);
      return eager.slice(0, this.config.maxToolsPerTurn);
    }

    // Score all tools
    const scored = this.scoreTools(allTools, messages, recentToolCalls);

    // Separate always-include tools
    const alwaysSet = new Set(this.config.alwaysInclude);
    const alwaysTools = scored.filter((s) => alwaysSet.has(s.tool.name));
    const regularTools = scored.filter((s) => !alwaysSet.has(s.tool.name));

    // Filter by min relevance, sort by score descending
    const relevant = regularTools
      .filter((s) => s.score >= this.config.minRelevance)
      .sort((a, b) => b.score - a.score);

    // Combine: always-include first, then top-scored up to max
    const remaining = this.config.maxToolsPerTurn - alwaysTools.length;
    const selected = [
      ...alwaysTools.map((s) => s.tool),
      ...relevant.slice(0, Math.max(0, remaining)).map((s) => s.tool),
    ];

    return selected;
  }

  /** Score all tools by relevance to current messages */
  scoreTools(
    allTools: ToolDef[],
    messages: ChatMessage[],
    recentToolCalls?: string[],
  ): ToolRelevanceScore[] {
    // Extract keywords from recent messages
    const recentMessages = messages.slice(-this.config.recentTurnWindow * 2);
    const keywords = this.extractKeywords(recentMessages);

    const recentSet = new Set(recentToolCalls ?? []);

    return allTools.map((tool) => {
      let score = 0;
      let reason = "";

      // Keyword matching against tool name + description
      const toolText = `${tool.name} ${tool.description}`.toLowerCase();
      const toolTokens = this.tokenize(toolText);

      let matchCount = 0;
      for (const keyword of keywords) {
        if (toolText.includes(keyword)) {
          matchCount++;
        }
      }

      if (keywords.length > 0) {
        score = matchCount / keywords.length;
        reason =
          matchCount > 0 ? `matched ${matchCount}/${keywords.length} keywords` : "no keyword match";
      }

      // Boost by TF-IDF-like weighting: rare tool tokens matching keywords score higher
      const uniqueToolTokens = new Set(toolTokens);
      let specificityBoost = 0;
      for (const token of uniqueToolTokens) {
        if (keywords.includes(token)) {
          // Boost inversely proportional to how many tools contain this token
          const containingTools = allTools.filter((t) =>
            `${t.name} ${t.description}`.toLowerCase().includes(token),
          ).length;
          specificityBoost += 1 / Math.max(1, containingTools);
        }
      }
      score += specificityBoost * 0.3;

      // Recently-used boost
      if (this.config.includeRecentlyUsed && recentSet.has(tool.name)) {
        score += 0.4;
        reason += `${reason ? "; " : ""}recently used`;
      }

      // Always-include gets max score
      if (this.config.alwaysInclude.includes(tool.name)) {
        score = 10;
        reason = "always included";
      }

      return { tool, score, reason };
    });
  }

  /** Extract keywords from messages */
  private extractKeywords(messages: ChatMessage[]): string[] {
    const text = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content
              .filter((p) => p.type === "text")
              .map((p) => (p as { text: string }).text)
              .join(" "),
      )
      .join(" ")
      .toLowerCase();

    const tokens = this.tokenize(text);

    // Remove common stop words
    const stopWords = new Set([
      "the",
      "a",
      "an",
      "is",
      "are",
      "was",
      "were",
      "be",
      "been",
      "being",
      "have",
      "has",
      "had",
      "do",
      "does",
      "did",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "can",
      "shall",
      "to",
      "of",
      "in",
      "for",
      "on",
      "with",
      "at",
      "by",
      "from",
      "as",
      "into",
      "through",
      "during",
      "before",
      "after",
      "above",
      "below",
      "between",
      "out",
      "off",
      "over",
      "under",
      "again",
      "further",
      "then",
      "once",
      "here",
      "there",
      "when",
      "where",
      "why",
      "how",
      "all",
      "each",
      "every",
      "both",
      "few",
      "more",
      "most",
      "other",
      "some",
      "such",
      "no",
      "nor",
      "not",
      "only",
      "own",
      "same",
      "so",
      "than",
      "too",
      "very",
      "just",
      "because",
      "but",
      "and",
      "or",
      "if",
      "while",
      "about",
      "up",
      "it",
      "its",
      "i",
      "me",
      "my",
      "you",
      "your",
      "we",
      "our",
      "they",
      "them",
      "their",
      "this",
      "that",
      "what",
      "which",
      "who",
      "whom",
      "he",
      "she",
      "him",
      "her",
      "please",
      "help",
      "want",
      "need",
      "like",
      "use",
      "get",
      "make",
    ]);

    return [...new Set(tokens.filter((t) => t.length > 2 && !stopWords.has(t)))];
  }

  /** Tokenize text into words */
  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 0);
  }
}
