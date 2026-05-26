// ──────────────────────────────────────────────────────
// ADK Embedding Service — Standalone embedding generation
// ──────────────────────────────────────────────────────
// Uses fetch() for HTTP calls (no external dependencies).
// Falls back to a deterministic hash-based pseudo-embedding
// when no API key is configured (useful for testing).
// ──────────────────────────────────────────────────────

import type { EmbedApiResponse, EmbeddingConfig } from "./types";

/** Default embedding dimensions for the hash-based fallback */
const HASH_EMBEDDING_DIMS = 1536;

/** Default OpenAI embedding model */
const DEFAULT_OPENAI_MODEL = "text-embedding-3-small";

/** Default OpenAI embedding API endpoint */
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export class EmbeddingService {
  private readonly provider: string;
  private readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly dimensions: number;

  constructor(config: EmbeddingConfig = {}) {
    this.provider = config.provider ?? "openai";
    this.model = config.model ?? DEFAULT_OPENAI_MODEL;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;
    this.dimensions = config.dimensions ?? HASH_EMBEDDING_DIMS;
  }

  /**
   * Generate embeddings for one or more texts.
   * If no API key is configured, falls back to hash-based pseudo-embeddings.
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      return texts.map((text) => this.hashEmbed(text));
    }

    if (this.provider === "openai") {
      return this.embedOpenAI(texts);
    }

    // Future: support additional providers here
    throw new Error(`Unsupported embedding provider: ${this.provider}`);
  }

  /**
   * Generate a single embedding for a text string.
   * Convenience wrapper around embed().
   */
  async embedSingle(text: string): Promise<number[]> {
    const results = await this.embed([text]);
    return results[0]!;
  }

  /** Whether the service has a real embedding provider configured */
  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  // ─── OpenAI Embedding API ────────────────────────────

  private async embedOpenAI(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown error");
      throw new Error(`Embedding API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
      model: string;
      usage: { prompt_tokens: number; total_tokens: number };
    };

    // Sort by index to ensure correct order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }

  // ─── Hash-based pseudo-embedding (no API key) ────────

  /**
   * Deterministic hash-based pseudo-embedding for testing.
   * Produces a normalized vector of the configured dimension.
   * NOT suitable for production semantic search — only for
   * development/testing when no embedding API is available.
   */
  private hashEmbed(text: string): number[] {
    const dims = this.dimensions;
    const embedding = new Array<number>(dims);

    // Use a simple hash function to seed the embedding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }

    // Generate deterministic pseudo-random values from the hash
    let seed = hash;
    for (let i = 0; i < dims; i++) {
      // xorshift32
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      embedding[i] = (seed / 0x7fffffff) * 2 - 1; // normalize to [-1, 1]
    }

    // L2 normalize the vector
    let norm = 0;
    for (let i = 0; i < dims; i++) {
      norm += embedding[i]! * embedding[i]!;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dims; i++) {
        embedding[i] = embedding[i]! / norm;
      }
    }

    return embedding;
  }

  /**
   * Create an EmbedApiResponse from raw embedding results.
   * Useful for callers that need the full response shape.
   */
  async embedWithResponse(texts: string[]): Promise<EmbedApiResponse> {
    const embeddings = await this.embed(texts);
    return {
      embeddings,
      model: this.apiKey ? this.model : "hash-pseudo-embedding",
      usage: {
        totalTokens: texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
      },
    };
  }
}
