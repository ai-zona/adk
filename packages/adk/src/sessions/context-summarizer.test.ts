import { describe, expect, it, vi } from "vitest";
import type { ADKLLMProvider, ChatMessage, ChatResponse } from "../types/llm";
import { ContextSummarizer } from "./context-summarizer";

/** Create a mock provider that returns a predefined summary */
function createMockSummaryProvider(summary: string): ADKLLMProvider {
  return {
    providerId: "mock",
    displayName: "Mock",
    isLocal: true,
    chat: vi.fn(async () => ({
      content: summary,
      model: "mock-model",
      providerId: "mock",
      inputTokens: 50,
      outputTokens: 20,
      totalTokens: 70,
      latencyMs: 100,
      costUsd: 0.001,
      finishReason: "stop",
    })),
    complete: vi.fn(),
    isAvailable: () => true,
    getModels: () => ["mock-model"],
    estimateCost: () => 0,
    chatWithTools: vi.fn(),
    async *chatStream() {
      yield { type: "text_delta" as const, content: summary };
      yield { type: "message_end" as const, usage: { inputTokens: 50, outputTokens: 20 } };
    },
  };
}

describe("ContextSummarizer", () => {
  const sampleMessages: ChatMessage[] = [
    { role: "user", content: "What is the capital of France?" },
    {
      role: "assistant",
      content:
        "The capital of France is Paris. It is known for the Eiffel Tower and its rich history.",
    },
    { role: "user", content: "What about Germany?" },
    {
      role: "assistant",
      content:
        "The capital of Germany is Berlin. It has a complex history including the Berlin Wall.",
    },
    { role: "user", content: "And Italy?" },
    {
      role: "assistant",
      content:
        "The capital of Italy is Rome. It's famous for the Colosseum and ancient Roman history.",
    },
  ];

  describe("summarize with LLM provider", () => {
    it("produces a summary message using the provider", async () => {
      const provider = createMockSummaryProvider(
        "User asked about European capitals: France→Paris, Germany→Berlin, Italy→Rome.",
      );
      const summarizer = new ContextSummarizer({ provider });

      const result = await summarizer.summarize(sampleMessages);
      expect(result.content).toContain("[Previous conversation summary]");
      expect(result.content).toContain("European capitals");
      expect(provider.chat).toHaveBeenCalledOnce();
    });

    it("passes model to provider", async () => {
      const provider = createMockSummaryProvider("Summary");
      const summarizer = new ContextSummarizer({ provider, model: "gpt-4o-mini" });

      await summarizer.summarize(sampleMessages);
      const call = (provider.chat as any).mock.calls[0][0];
      expect(call.model).toBe("gpt-4o-mini");
    });

    it("falls back to extractive on provider failure", async () => {
      const failingProvider = {
        ...createMockSummaryProvider(""),
        chat: vi.fn().mockRejectedValue(new Error("API error")),
      };
      const summarizer = new ContextSummarizer({ provider: failingProvider as ADKLLMProvider });

      const result = await summarizer.summarize(sampleMessages);
      expect(result.content).toContain("[Previous conversation summary]");
      // Extractive summary should still have content
      expect(result.content.length).toBeGreaterThan(30);
    });
  });

  describe("extractive fallback (no provider)", () => {
    it("extracts first and last sentences", async () => {
      const summarizer = new ContextSummarizer();
      const result = await summarizer.summarize(sampleMessages);

      expect(result.role).toBe("assistant");
      expect(result.content).toContain("[Previous conversation summary]");
      expect(result.content).toContain("capital of France");
    });

    it("handles empty messages", async () => {
      const summarizer = new ContextSummarizer();
      const result = await summarizer.summarize([]);

      expect(result.content).toContain("[No previous context]");
    });

    it("handles single-sentence messages", async () => {
      const summarizer = new ContextSummarizer();
      const result = await summarizer.summarize([{ role: "user", content: "Hello" }]);

      expect(result.content).toContain("Hello");
    });
  });

  describe("partitionMessages", () => {
    it("splits messages keeping recent turns", () => {
      const summarizer = new ContextSummarizer();
      const { summarize, keep } = summarizer.partitionMessages(sampleMessages, 2);

      // 2 recent turns = last 2 user messages + their responses
      expect(keep.length).toBeGreaterThan(0);
      expect(summarize.length).toBeGreaterThan(0);
      expect(summarize.length + keep.length).toBe(sampleMessages.length);
    });

    it("keeps all messages when keepRecentTurns covers everything", () => {
      const summarizer = new ContextSummarizer();
      const { summarize, keep } = summarizer.partitionMessages(sampleMessages, 10);

      expect(keep).toHaveLength(sampleMessages.length);
      expect(summarize).toHaveLength(0);
    });

    it("summarizes all when keepRecentTurns is 0", () => {
      const summarizer = new ContextSummarizer();
      const { summarize, keep } = summarizer.partitionMessages(sampleMessages, 0);

      expect(summarize).toHaveLength(sampleMessages.length);
      expect(keep).toHaveLength(0);
    });

    it("excludes system messages from partitioning", () => {
      const withSystem: ChatMessage[] = [
        { role: "system", content: "You are helpful." },
        ...sampleMessages,
      ];
      const summarizer = new ContextSummarizer();
      const { summarize, keep } = summarizer.partitionMessages(withSystem, 2);

      // System message should not be in either partition
      expect(summarize.every((m) => m.role !== "system")).toBe(true);
      expect(keep.every((m) => m.role !== "system")).toBe(true);
    });
  });
});
