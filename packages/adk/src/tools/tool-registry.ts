// ──────────────────────────────────────────────────────
// ADK Tool Registry — Deferred tool loading + search
// ──────────────────────────────────────────────────────

import type { ToolDef } from "../types/tool";

/** Search result from the tool registry */
export interface ToolSearchResult {
  name: string;
  description: string;
  score: number;
}

/**
 * ToolRegistry — central store for all tools with BM25-style search.
 * Supports deferred loading: tools marked `deferLoading: true` are stored
 * but not returned to the LLM until explicitly loaded via search.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private loadedDeferred = new Set<string>();

  /** Register a tool */
  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  /** Register multiple tools */
  registerAll(tools: ToolDef[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** Get a tool by name */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Search tools by query using BM25-style keyword matching */
  search(query: string, limit = 5): ToolSearchResult[] {
    const queryTerms = this.tokenize(query.toLowerCase());
    if (queryTerms.length === 0) return [];

    // Compute IDF for each query term
    const totalDocs = this.tools.size;
    const idf = new Map<string, number>();
    for (const term of queryTerms) {
      let docFreq = 0;
      for (const tool of this.tools.values()) {
        const text = `${tool.name} ${tool.description}`.toLowerCase();
        if (text.includes(term)) docFreq++;
      }
      idf.set(term, Math.log((totalDocs - docFreq + 0.5) / (docFreq + 0.5) + 1));
    }

    const k1 = 1.2;
    const b = 0.75;

    // Compute average document length
    let totalLen = 0;
    for (const tool of this.tools.values()) {
      totalLen += this.tokenize(`${tool.name} ${tool.description}`).length;
    }
    const avgLen = totalLen / Math.max(1, totalDocs);

    const scored: ToolSearchResult[] = [];
    for (const tool of this.tools.values()) {
      const text = `${tool.name} ${tool.description}`.toLowerCase();
      const tokens = this.tokenize(text);
      const docLen = tokens.length;

      let score = 0;
      for (const term of queryTerms) {
        const tf = tokens.filter((t) => t === term).length;
        const termIdf = idf.get(term) ?? 0;
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLen / avgLen));
        score += termIdf * (numerator / denominator);
      }

      // Boost for name match (tool names are more specific)
      const nameLower = tool.name.toLowerCase().replace(/[_-]/g, " ");
      for (const term of queryTerms) {
        if (nameLower.includes(term)) score *= 1.5;
      }

      if (score > 0) {
        scored.push({ name: tool.name, description: tool.description, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** Load a deferred tool (mark it as available for LLM) */
  load(name: string): ToolDef | undefined {
    const tool = this.tools.get(name);
    if (tool?.deferLoading) {
      this.loadedDeferred.add(name);
    }
    return tool;
  }

  /** Get all eager (non-deferred) tools */
  getEager(): ToolDef[] {
    return Array.from(this.tools.values()).filter((t) => !t.deferLoading);
  }

  /** Get all tools that should be sent to LLM (eager + loaded deferred) */
  getAvailable(): ToolDef[] {
    return Array.from(this.tools.values()).filter(
      (t) => !t.deferLoading || this.loadedDeferred.has(t.name),
    );
  }

  /** Check if a deferred tool has been loaded */
  isLoaded(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    return !tool.deferLoading || this.loadedDeferred.has(name);
  }

  /** Get all registered tool names */
  getAllNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Clear all tools and loaded state */
  clear(): void {
    this.tools.clear();
    this.loadedDeferred.clear();
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/[^\w\s-]/g, " ")
      .split(/[\s_-]+/)
      .filter((w) => w.length > 1);
  }
}
