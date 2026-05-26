// ──────────────────────────────────────────────────────
// ADK Memory Types — Vector memory system interfaces
// ──────────────────────────────────────────────────────

/** Memory classification types (mirrors Prisma MemoryType enum) */
export type MemoryType = "CONVERSATION" | "FACT" | "PREFERENCE" | "SKILL_LEARNED";

/** A stored memory entry */
export interface MemoryEntry {
  id: string;
  agentId: string;
  sessionId?: string;
  content: string;
  memoryType: MemoryType;
  importance: number;
  accessCount: number;
  lastAccessedAt?: Date;
  expiresAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/** A memory entry with a relevance score from search */
export interface MemorySearchResult extends MemoryEntry {
  /** Cosine similarity score (0-1, higher = more relevant) */
  score: number;
}

/**
 * Memory backend interface — pluggable storage for agent memories.
 * Implementations must handle embedding storage and vector similarity search.
 */
export interface MemoryBackend {
  /** Store a new memory with content and type */
  store(
    agentId: string,
    content: string,
    type: MemoryType,
    metadata?: Record<string, unknown>,
  ): Promise<MemoryEntry>;

  /** Search memories by semantic similarity to a query */
  search(
    agentId: string,
    query: string,
    limit?: number,
    threshold?: number,
  ): Promise<MemorySearchResult[]>;

  /** Recall a specific memory by id, incrementing access count */
  recall(agentId: string, memoryId: string): Promise<MemoryEntry | null>;

  /** Forget (delete) a specific memory */
  forget(agentId: string, memoryId: string): Promise<void>;

  /** Get the most recent memories for an agent */
  getRecent(agentId: string, limit: number): Promise<MemoryEntry[]>;

  /** Decay old memory importance scores; returns count of decayed memories */
  decay(agentId: string): Promise<number>;
}

/** Configuration for the embedding service */
export interface EmbeddingConfig {
  /** Embedding provider (e.g., "openai") */
  provider?: string;
  /** Embedding model name (e.g., "text-embedding-3-small") */
  model?: string;
  /** API key for the embedding provider */
  apiKey?: string;
  /** Base URL for the embedding API (for custom endpoints) */
  baseUrl?: string;
  /** Embedding dimensions (default depends on model) */
  dimensions?: number;
}

/** Raw embedding API response shape */
export interface EmbedApiResponse {
  embeddings: number[][];
  model: string;
  usage: { totalTokens: number };
}
