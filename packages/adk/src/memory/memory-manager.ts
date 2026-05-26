// ──────────────────────────────────────────────────────
// ADK Memory Manager — High-level memory operations
// ──────────────────────────────────────────────────────
// Orchestrates the MemoryBackend and EmbeddingService to
// provide store, search, context injection, extraction,
// and decay operations for agent long-term memory.
// ──────────────────────────────────────────────────────

import type { EmbeddingService } from "./embedding";
import type { MemoryBackend, MemoryEntry, MemorySearchResult, MemoryType } from "./types";

/** Configuration for the MemoryManager */
export interface MemoryManagerConfig {
  /** Default search result limit */
  defaultSearchLimit?: number;
  /** Default similarity threshold (0-1) for search results */
  defaultThreshold?: number;
  /** Maximum number of memories to inject into context */
  maxContextMemories?: number;
  /** Whether to automatically extract and store facts from conversations */
  autoExtract?: boolean;
}

/** Default configuration values */
const DEFAULTS: Required<MemoryManagerConfig> = {
  defaultSearchLimit: 10,
  defaultThreshold: 0.3,
  maxContextMemories: 5,
  autoExtract: false,
};

export class MemoryManager {
  private readonly backend: MemoryBackend;
  private readonly embedding: EmbeddingService;
  private readonly config: Required<MemoryManagerConfig>;

  constructor(
    backend: MemoryBackend,
    embeddingService: EmbeddingService,
    config: MemoryManagerConfig = {},
  ) {
    this.backend = backend;
    this.embedding = embeddingService;
    this.config = { ...DEFAULTS, ...config };
  }

  // ─── Core Operations ─────────────────────────────────

  /**
   * Store a new memory for an agent.
   * Embeds the content and persists it via the backend.
   */
  async storeMemory(
    agentId: string,
    content: string,
    type: MemoryType,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryEntry> {
    return this.backend.store(agentId, content, type, metadata);
  }

  /**
   * Search agent memories by semantic similarity.
   */
  async searchMemories(
    agentId: string,
    query: string,
    limit?: number,
    threshold?: number,
  ): Promise<MemorySearchResult[]> {
    return this.backend.search(
      agentId,
      query,
      limit ?? this.config.defaultSearchLimit,
      threshold ?? this.config.defaultThreshold,
    );
  }

  /**
   * Recall a specific memory by id.
   */
  async recallMemory(agentId: string, memoryId: string): Promise<MemoryEntry | null> {
    return this.backend.recall(agentId, memoryId);
  }

  /**
   * Forget (delete) a specific memory.
   */
  async forgetMemory(agentId: string, memoryId: string): Promise<void> {
    return this.backend.forget(agentId, memoryId);
  }

  /**
   * Get recent memories for an agent.
   */
  async getRecentMemories(agentId: string, limit?: number): Promise<MemoryEntry[]> {
    return this.backend.getRecent(agentId, limit ?? this.config.defaultSearchLimit);
  }

  // ─── Context Integration ─────────────────────────────

  /**
   * Search for memories relevant to the current conversation messages.
   * Combines the last few messages into a query and searches for matches.
   * Returns the top N most relevant memories for context injection.
   */
  async getContextMemories(
    agentId: string,
    currentMessages: string[],
  ): Promise<MemorySearchResult[]> {
    if (currentMessages.length === 0) {
      return [];
    }

    // Combine the last few messages into a search query
    // Take at most the last 3 messages to keep the query focused
    const recentMessages = currentMessages.slice(-3);
    const query = recentMessages.join(" ");

    return this.backend.search(
      agentId,
      query,
      this.config.maxContextMemories,
      this.config.defaultThreshold,
    );
  }

  /**
   * Format memory search results into a string suitable for
   * injection into a system or user prompt.
   */
  formatMemoriesForPrompt(memories: MemorySearchResult[]): string {
    if (memories.length === 0) {
      return "";
    }

    const lines = memories.map((m) => {
      const typeLabel = m.memoryType.toLowerCase().replace("_", " ");
      return `- [${typeLabel}] ${m.content} (relevance: ${(m.score * 100).toFixed(0)}%)`;
    });

    return `## Relevant Memories\n${lines.join("\n")}`;
  }

  // ─── Extraction ──────────────────────────────────────

  /**
   * Parse a conversation summary and extract key facts, preferences,
   * and skills learned, storing each as a separate memory.
   *
   * The extraction uses simple heuristics to classify content:
   * - Lines starting with "prefers" or "likes" / "dislikes" -> PREFERENCE
   * - Lines starting with "learned" or "can now" -> SKILL_LEARNED
   * - Lines that are questions or conversation flow -> CONVERSATION
   * - Everything else -> FACT
   *
   * Returns the list of newly created memory entries.
   */
  async extractAndStore(agentId: string, conversationSummary: string): Promise<MemoryEntry[]> {
    const lines = conversationSummary
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      return [];
    }

    const stored: MemoryEntry[] = [];

    for (const line of lines) {
      const type = this.classifyLine(line);
      const entry = await this.backend.store(agentId, line, type);
      stored.push(entry);
    }

    return stored;
  }

  // ─── Decay ───────────────────────────────────────────

  /**
   * Run memory importance decay for an agent.
   * Reduces importance scores for memories that haven't been
   * accessed recently, allowing less relevant memories to fade.
   * Returns the number of memories affected.
   */
  async runDecay(agentId: string): Promise<number> {
    return this.backend.decay(agentId);
  }

  // ─── Helpers ─────────────────────────────────────────

  /** Classify a line of text into a memory type using heuristics */
  private classifyLine(line: string): MemoryType {
    const lower = line.toLowerCase();

    // Preference indicators
    if (
      lower.startsWith("prefers") ||
      lower.startsWith("likes") ||
      lower.startsWith("dislikes") ||
      lower.startsWith("preference:") ||
      lower.includes("prefers to") ||
      lower.includes("would rather")
    ) {
      return "PREFERENCE";
    }

    // Skill / learning indicators
    if (
      lower.startsWith("learned") ||
      lower.startsWith("can now") ||
      lower.startsWith("skill:") ||
      lower.includes("learned how to") ||
      lower.includes("now knows") ||
      lower.includes("acquired skill")
    ) {
      return "SKILL_LEARNED";
    }

    // Conversation indicators
    if (
      lower.startsWith("user said") ||
      lower.startsWith("asked about") ||
      lower.startsWith("discussed") ||
      lower.startsWith("conversation:") ||
      lower.includes("talked about") ||
      lower.endsWith("?")
    ) {
      return "CONVERSATION";
    }

    // Default to fact
    return "FACT";
  }
}
