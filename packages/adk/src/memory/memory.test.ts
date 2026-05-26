// ──────────────────────────────────────────────────────
// ADK Memory Module Tests
// ──────────────────────────────────────────────────────

import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "./embedding";
import { MemoryManager } from "./memory-manager";
import { PgVectorMemoryBackend } from "./pgvector-backend";
import type { MemoryBackend, MemoryEntry, MemorySearchResult, MemoryType } from "./types";

// ─── EmbeddingService Tests ────────────────────────────

describe("EmbeddingService", () => {
  it("should create with default config", () => {
    const svc = new EmbeddingService();
    expect(svc.isConfigured).toBe(false);
  });

  it("should create with custom config", () => {
    const svc = new EmbeddingService({
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: "test-key",
    });
    expect(svc.isConfigured).toBe(true);
  });

  describe("hash-based pseudo-embedding (no API key)", () => {
    let svc: EmbeddingService;

    beforeEach(() => {
      svc = new EmbeddingService();
    });

    it("should produce embeddings of correct dimension", async () => {
      const results = await svc.embed(["hello world"]);
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(1536);
    });

    it("should produce deterministic embeddings", async () => {
      const [a] = await svc.embed(["hello world"]);
      const [b] = await svc.embed(["hello world"]);
      expect(a).toEqual(b);
    });

    it("should produce different embeddings for different texts", async () => {
      const [a] = await svc.embed(["hello"]);
      const [b] = await svc.embed(["goodbye"]);
      expect(a).not.toEqual(b);
    });

    it("should handle multiple texts in a single call", async () => {
      const results = await svc.embed(["hello", "world", "test"]);
      expect(results).toHaveLength(3);
      for (const r of results) expect(r).toHaveLength(1536);
    });

    it("should produce L2-normalized vectors", async () => {
      const [embedding] = await svc.embed(["normalize me"]);
      const norm = Math.sqrt(embedding?.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });

    it("should support custom dimensions", async () => {
      const svc256 = new EmbeddingService({ dimensions: 256 });
      const [result] = await svc256.embed(["test"]);
      expect(result).toHaveLength(256);
    });

    it("embedSingle should return a single vector", async () => {
      const result = await svc.embedSingle("test");
      expect(result).toHaveLength(1536);
      expect(Array.isArray(result)).toBe(true);
    });

    it("embedWithResponse should return full response shape", async () => {
      const response = await svc.embedWithResponse(["hello", "world"]);
      expect(response.embeddings).toHaveLength(2);
      expect(response.model).toBe("hash-pseudo-embedding");
      expect(response.usage.totalTokens).toBeGreaterThan(0);
    });
  });

  describe("OpenAI embedding API", () => {
    it("should call fetch with correct parameters", async () => {
      const mockResponse = {
        data: [{ embedding: new Array(1536).fill(0.1), index: 0 }],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 5, total_tokens: 5 },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const svc = new EmbeddingService({
        apiKey: "test-key-123",
        model: "text-embedding-3-small",
      });

      const results = await svc.embed(["test input"]);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.openai.com/v1/embeddings");
      expect(options.method).toBe("POST");
      expect(options.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key-123",
        }),
      );

      const body = JSON.parse(options.body as string);
      expect(body.input).toEqual(["test input"]);
      expect(body.model).toBe("text-embedding-3-small");

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(1536);

      vi.unstubAllGlobals();
    });

    it("should throw on API error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const svc = new EmbeddingService({ apiKey: "bad-key" });

      await expect(svc.embed(["test"])).rejects.toThrow("Embedding API error (401): Unauthorized");

      vi.unstubAllGlobals();
    });

    it("should sort results by index", async () => {
      const mockResponse = {
        data: [
          { embedding: [0.2, 0.3], index: 1 },
          { embedding: [0.1, 0.2], index: 0 },
        ],
        model: "text-embedding-3-small",
        usage: { prompt_tokens: 10, total_tokens: 10 },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const svc = new EmbeddingService({ apiKey: "key" });
      const results = await svc.embed(["a", "b"]);

      expect(results[0]).toEqual([0.1, 0.2]);
      expect(results[1]).toEqual([0.2, 0.3]);

      vi.unstubAllGlobals();
    });

    it("should use custom base URL", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [{ embedding: [0.1], index: 0 }],
            model: "custom",
            usage: { prompt_tokens: 1, total_tokens: 1 },
          }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const svc = new EmbeddingService({
        apiKey: "key",
        baseUrl: "https://custom.api.com/v1",
      });
      await svc.embed(["test"]);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://custom.api.com/v1/embeddings");

      vi.unstubAllGlobals();
    });

    it("should throw for unsupported provider", async () => {
      const svc = new EmbeddingService({
        apiKey: "key",
        provider: "unsupported-provider",
      });

      await expect(svc.embed(["test"])).rejects.toThrow(
        "Unsupported embedding provider: unsupported-provider",
      );
    });
  });
});

// ─── Mock MemoryBackend for MemoryManager Tests ────────

function createMockBackend(): MemoryBackend {
  const memories: MemoryEntry[] = [];
  let idCounter = 0;

  return {
    store: vi.fn(
      async (
        agentId: string,
        content: string,
        type: MemoryType,
        metadata?: Record<string, unknown>,
      ): Promise<MemoryEntry> => {
        const entry: MemoryEntry = {
          id: `mem-${++idCounter}`,
          agentId,
          content,
          memoryType: type,
          importance: 0.5,
          accessCount: 0,
          metadata: metadata ?? {},
          createdAt: new Date(),
        };
        memories.push(entry);
        return entry;
      },
    ),

    search: vi.fn(
      async (_agentId: string, _query: string, limit?: number): Promise<MemorySearchResult[]> => {
        return memories.slice(0, limit ?? 10).map((m, i) => ({
          ...m,
          score: 0.9 - i * 0.1,
        }));
      },
    ),

    recall: vi.fn(async (_agentId: string, memoryId: string): Promise<MemoryEntry | null> => {
      return memories.find((m) => m.id === memoryId) ?? null;
    }),

    forget: vi.fn(async (_agentId: string, memoryId: string): Promise<void> => {
      const idx = memories.findIndex((m) => m.id === memoryId);
      if (idx >= 0) memories.splice(idx, 1);
    }),

    getRecent: vi.fn(async (_agentId: string, limit: number): Promise<MemoryEntry[]> => {
      return memories.slice(-limit).reverse();
    }),

    decay: vi.fn(async (): Promise<number> => {
      return 3; // pretend 3 memories were decayed
    }),
  };
}

// ─── MemoryManager Tests ───────────────────────────────

describe("MemoryManager", () => {
  let backend: MemoryBackend;
  let embedding: EmbeddingService;
  let manager: MemoryManager;

  beforeEach(() => {
    backend = createMockBackend();
    embedding = new EmbeddingService();
    manager = new MemoryManager(backend, embedding);
  });

  describe("storeMemory", () => {
    it("should delegate to backend.store", async () => {
      const entry = await manager.storeMemory("agent-1", "User prefers TypeScript", "PREFERENCE", {
        source: "conversation",
      });

      expect(backend.store).toHaveBeenCalledWith(
        "agent-1",
        "User prefers TypeScript",
        "PREFERENCE",
        { source: "conversation" },
      );
      expect(entry.agentId).toBe("agent-1");
      expect(entry.content).toBe("User prefers TypeScript");
      expect(entry.memoryType).toBe("PREFERENCE");
    });
  });

  describe("searchMemories", () => {
    it("should delegate to backend.search with defaults", async () => {
      await manager.searchMemories("agent-1", "TypeScript");

      expect(backend.search).toHaveBeenCalledWith("agent-1", "TypeScript", 10, 0.3);
    });

    it("should use custom limit and threshold", async () => {
      await manager.searchMemories("agent-1", "query", 5, 0.5);

      expect(backend.search).toHaveBeenCalledWith("agent-1", "query", 5, 0.5);
    });
  });

  describe("recallMemory", () => {
    it("should delegate to backend.recall", async () => {
      await manager.storeMemory("agent-1", "some fact", "FACT");
      const result = await manager.recallMemory("agent-1", "mem-1");

      expect(backend.recall).toHaveBeenCalledWith("agent-1", "mem-1");
      expect(result).not.toBeNull();
      expect(result?.id).toBe("mem-1");
    });

    it("should return null for non-existent memory", async () => {
      const result = await manager.recallMemory("agent-1", "non-existent");
      expect(result).toBeNull();
    });
  });

  describe("forgetMemory", () => {
    it("should delegate to backend.forget", async () => {
      await manager.forgetMemory("agent-1", "mem-1");
      expect(backend.forget).toHaveBeenCalledWith("agent-1", "mem-1");
    });
  });

  describe("getRecentMemories", () => {
    it("should delegate to backend.getRecent with default limit", async () => {
      await manager.getRecentMemories("agent-1");
      expect(backend.getRecent).toHaveBeenCalledWith("agent-1", 10);
    });

    it("should use custom limit", async () => {
      await manager.getRecentMemories("agent-1", 25);
      expect(backend.getRecent).toHaveBeenCalledWith("agent-1", 25);
    });
  });

  describe("getContextMemories", () => {
    it("should combine recent messages into a search query", async () => {
      await manager.getContextMemories("agent-1", ["Hello there", "How does TypeScript work?"]);

      expect(backend.search).toHaveBeenCalledWith(
        "agent-1",
        "Hello there How does TypeScript work?",
        5, // maxContextMemories default
        0.3, // defaultThreshold
      );
    });

    it("should return empty array for no messages", async () => {
      const result = await manager.getContextMemories("agent-1", []);
      expect(result).toEqual([]);
      expect(backend.search).not.toHaveBeenCalled();
    });

    it("should use at most the last 3 messages", async () => {
      await manager.getContextMemories("agent-1", ["msg 1", "msg 2", "msg 3", "msg 4", "msg 5"]);

      expect(backend.search).toHaveBeenCalledWith("agent-1", "msg 3 msg 4 msg 5", 5, 0.3);
    });
  });

  describe("formatMemoriesForPrompt", () => {
    it("should format memories with type labels and scores", () => {
      const memories: MemorySearchResult[] = [
        {
          id: "m1",
          agentId: "agent-1",
          content: "User likes TypeScript",
          memoryType: "PREFERENCE",
          importance: 0.8,
          accessCount: 3,
          createdAt: new Date(),
          score: 0.92,
        },
        {
          id: "m2",
          agentId: "agent-1",
          content: "Project uses React 19",
          memoryType: "FACT",
          importance: 0.6,
          accessCount: 1,
          createdAt: new Date(),
          score: 0.75,
        },
      ];

      const result = manager.formatMemoriesForPrompt(memories);

      expect(result).toContain("## Relevant Memories");
      expect(result).toContain("[preference] User likes TypeScript (relevance: 92%)");
      expect(result).toContain("[fact] Project uses React 19 (relevance: 75%)");
    });

    it("should handle skill_learned type label", () => {
      const memories: MemorySearchResult[] = [
        {
          id: "m1",
          agentId: "agent-1",
          content: "Learned how to deploy",
          memoryType: "SKILL_LEARNED",
          importance: 0.7,
          accessCount: 0,
          createdAt: new Date(),
          score: 0.85,
        },
      ];

      const result = manager.formatMemoriesForPrompt(memories);
      expect(result).toContain("[skill learned]");
    });

    it("should return empty string for no memories", () => {
      const result = manager.formatMemoriesForPrompt([]);
      expect(result).toBe("");
    });
  });

  describe("extractAndStore", () => {
    it("should extract and classify lines from conversation summary", async () => {
      const summary = [
        "Prefers dark mode for all editors",
        "The project uses pnpm workspaces",
        "Learned how to configure Prisma multi-schema",
        "Asked about deployment strategies",
      ].join("\n");

      const stored = await manager.extractAndStore("agent-1", summary);

      expect(stored).toHaveLength(4);
      expect(backend.store).toHaveBeenCalledTimes(4);

      // Check classifications
      const calls = (backend.store as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]?.[2]).toBe("PREFERENCE"); // "Prefers dark mode..."
      expect(calls[1]?.[2]).toBe("FACT"); // "The project uses..."
      expect(calls[2]?.[2]).toBe("SKILL_LEARNED"); // "Learned how to..."
      expect(calls[3]?.[2]).toBe("CONVERSATION"); // "Asked about..."
    });

    it("should skip empty lines", async () => {
      const summary = "fact one\n\n\nfact two\n";
      const stored = await manager.extractAndStore("agent-1", summary);

      expect(stored).toHaveLength(2);
    });

    it("should return empty array for empty summary", async () => {
      const stored = await manager.extractAndStore("agent-1", "");
      expect(stored).toEqual([]);
    });

    it("should classify question marks as conversation", async () => {
      const stored = await manager.extractAndStore("agent-1", "What is the best framework?");
      expect(stored).toHaveLength(1);
      const calls = (backend.store as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]?.[2]).toBe("CONVERSATION");
    });

    it("should classify likes/dislikes as preference", async () => {
      await manager.extractAndStore("agent-1", "Likes functional programming");
      const calls = (backend.store as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]?.[2]).toBe("PREFERENCE");
    });

    it("should classify 'can now' as skill_learned", async () => {
      await manager.extractAndStore("agent-1", "Can now write SQL queries");
      const calls = (backend.store as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls[0]?.[2]).toBe("SKILL_LEARNED");
    });
  });

  describe("runDecay", () => {
    it("should delegate to backend.decay", async () => {
      const count = await manager.runDecay("agent-1");
      expect(backend.decay).toHaveBeenCalledWith("agent-1");
      expect(count).toBe(3);
    });
  });

  describe("custom config", () => {
    it("should use custom defaults", async () => {
      const customManager = new MemoryManager(backend, embedding, {
        defaultSearchLimit: 20,
        defaultThreshold: 0.5,
        maxContextMemories: 8,
      });

      await customManager.searchMemories("agent-1", "test");
      expect(backend.search).toHaveBeenCalledWith("agent-1", "test", 20, 0.5);

      await customManager.getContextMemories("agent-1", ["msg"]);
      expect(backend.search).toHaveBeenCalledWith("agent-1", "msg", 8, 0.5);
    });
  });
});

// ─── PgVectorMemoryBackend Tests ───────────────────────

describe("PgVectorMemoryBackend", () => {
  let mockDb: {
    $queryRaw: ReturnType<typeof vi.fn>;
  };
  let embeddingSvc: EmbeddingService;
  let backend: PgVectorMemoryBackend;

  const mockRow = {
    id: "test-id-1",
    agentId: "agent-1",
    sessionId: null,
    content: "Test memory content",
    memoryType: "FACT" as MemoryType,
    importance: 0.5,
    accessCount: 0,
    lastAccessedAt: null,
    expiresAt: null,
    metadata: {},
    createdAt: new Date("2024-01-01"),
  };

  beforeEach(() => {
    mockDb = {
      $queryRaw: vi.fn().mockResolvedValue([mockRow]),
    };
    embeddingSvc = new EmbeddingService(); // hash-based, no API key
    backend = new PgVectorMemoryBackend(mockDb, embeddingSvc);
  });

  describe("store", () => {
    it("should embed content and execute INSERT query", async () => {
      const result = await backend.store("agent-1", "Important fact about the project", "FACT", {
        source: "test",
      });

      expect(mockDb.$queryRaw).toHaveBeenCalledOnce();
      expect(result.agentId).toBe("agent-1");
      expect(result.content).toBe("Test memory content");
      expect(result.memoryType).toBe("FACT");
    });

    it("should handle metadata as undefined", async () => {
      await backend.store("agent-1", "content", "FACT");
      expect(mockDb.$queryRaw).toHaveBeenCalledOnce();
    });
  });

  describe("search", () => {
    it("should embed query and execute SELECT with cosine distance", async () => {
      const searchRow = { ...mockRow, distance: 0.15 };
      mockDb.$queryRaw.mockResolvedValue([searchRow]);

      const results = await backend.search("agent-1", "what is the project about?");

      expect(mockDb.$queryRaw).toHaveBeenCalledOnce();
      expect(results).toHaveLength(1);
      expect(results[0]?.score).toBeCloseTo(0.85, 5); // 1 - 0.15
      expect(results[0]?.content).toBe("Test memory content");
    });

    it("should return empty array when no results", async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      const results = await backend.search("agent-1", "unrelated query");
      expect(results).toEqual([]);
    });

    it("should pass limit and threshold to query", async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      await backend.search("agent-1", "query", 5, 0.4);
      expect(mockDb.$queryRaw).toHaveBeenCalledOnce();
    });
  });

  describe("recall", () => {
    it("should update access count and return memory", async () => {
      const result = await backend.recall("agent-1", "test-id-1");

      expect(mockDb.$queryRaw).toHaveBeenCalledOnce();
      expect(result).not.toBeNull();
      expect(result?.id).toBe("test-id-1");
    });

    it("should return null when memory not found", async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      const result = await backend.recall("agent-1", "non-existent");
      expect(result).toBeNull();
    });
  });

  describe("forget", () => {
    it("should execute DELETE query", async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      await backend.forget("agent-1", "test-id-1");
      expect(mockDb.$queryRaw).toHaveBeenCalledOnce();
    });
  });

  describe("getRecent", () => {
    it("should return recent memories ordered by creation date", async () => {
      const rows = [
        { ...mockRow, id: "recent-1", createdAt: new Date("2024-02-01") },
        { ...mockRow, id: "recent-2", createdAt: new Date("2024-01-15") },
      ];
      mockDb.$queryRaw.mockResolvedValue(rows);

      const results = await backend.getRecent("agent-1", 10);

      expect(results).toHaveLength(2);
      expect(results[0]?.id).toBe("recent-1");
      expect(results[1]?.id).toBe("recent-2");
    });
  });

  describe("decay", () => {
    it("should return count of decayed memories", async () => {
      mockDb.$queryRaw.mockResolvedValue([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);

      const count = await backend.decay("agent-1");
      expect(count).toBe(3);
    });

    it("should return 0 when no memories decayed", async () => {
      mockDb.$queryRaw.mockResolvedValue([]);

      const count = await backend.decay("agent-1");
      expect(count).toBe(0);
    });
  });

  describe("custom options", () => {
    it("should accept custom decay factor and stale days", () => {
      const customBackend = new PgVectorMemoryBackend(mockDb, embeddingSvc, {
        decayFactor: 0.9,
        decayStaleDays: 14,
      });
      // Just verify it constructs without error
      expect(customBackend).toBeDefined();
    });
  });

  describe("metadata parsing", () => {
    it("should parse string metadata as JSON", async () => {
      const rowWithStringMeta = {
        ...mockRow,
        metadata: '{"key": "value"}',
      };
      mockDb.$queryRaw.mockResolvedValue([rowWithStringMeta]);

      const result = await backend.recall("agent-1", "test-id-1");
      expect(result?.metadata).toEqual({ key: "value" });
    });

    it("should pass through object metadata directly", async () => {
      const rowWithObjectMeta = {
        ...mockRow,
        metadata: { key: "value" },
      };
      mockDb.$queryRaw.mockResolvedValue([rowWithObjectMeta]);

      const result = await backend.recall("agent-1", "test-id-1");
      expect(result?.metadata).toEqual({ key: "value" });
    });
  });

  describe("null field handling", () => {
    it("should convert null optional fields to undefined", async () => {
      mockDb.$queryRaw.mockResolvedValue([mockRow]);

      const result = await backend.recall("agent-1", "test-id-1");
      expect(result?.sessionId).toBeUndefined();
      expect(result?.lastAccessedAt).toBeUndefined();
      expect(result?.expiresAt).toBeUndefined();
    });

    it("should preserve non-null optional fields", async () => {
      const rowWithOptionals = {
        ...mockRow,
        sessionId: "session-1",
        lastAccessedAt: new Date("2024-01-15"),
        expiresAt: new Date("2024-12-31"),
      };
      mockDb.$queryRaw.mockResolvedValue([rowWithOptionals]);

      const result = await backend.recall("agent-1", "test-id-1");
      expect(result?.sessionId).toBe("session-1");
      expect(result?.lastAccessedAt).toEqual(new Date("2024-01-15"));
      expect(result?.expiresAt).toEqual(new Date("2024-12-31"));
    });
  });
});

// ─── Integration-style Tests ───────────────────────────

describe("Memory module integration", () => {
  it("should re-export all types from index", async () => {
    const mod = await import("./index");

    // Classes
    expect(mod.EmbeddingService).toBeDefined();
    expect(mod.MemoryManager).toBeDefined();
    expect(mod.PgVectorMemoryBackend).toBeDefined();
  });

  it("should work end-to-end with mock backend and hash embeddings", async () => {
    const embedding = new EmbeddingService();
    const backend = createMockBackend();
    const manager = new MemoryManager(backend, embedding);

    // Store a memory
    const entry = await manager.storeMemory("agent-test", "User prefers dark mode", "PREFERENCE");
    expect(entry.memoryType).toBe("PREFERENCE");

    // Search for related memories
    const results = await manager.searchMemories("agent-test", "dark theme");
    expect(results.length).toBeGreaterThan(0);

    // Format for prompt
    const prompt = manager.formatMemoriesForPrompt(results);
    expect(prompt).toContain("## Relevant Memories");

    // Extract and store from summary
    const stored = await manager.extractAndStore(
      "agent-test",
      "Prefers functional style\nThe database uses PostgreSQL",
    );
    expect(stored).toHaveLength(2);

    // Run decay
    const decayed = await manager.runDecay("agent-test");
    expect(decayed).toBe(3);
  });
});
