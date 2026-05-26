import { describe, expect, it } from "vitest";
import type { ChatMessage, LLMToolDefinition } from "../types/llm";
import { TokenCounter } from "./token-counter";

describe("TokenCounter", () => {
  describe("character strategy", () => {
    const counter = new TokenCounter({ strategy: "character" });

    it("counts empty string as 0", () => {
      expect(counter.countText("")).toBe(0);
    });

    it("counts text as ceil(length / 4)", () => {
      expect(counter.countText("hello")).toBe(2); // 5/4 = 1.25 → 2
      expect(counter.countText("hi")).toBe(1); // 2/4 = 0.5 → 1
      expect(counter.countText("abcdefgh")).toBe(2); // 8/4 = 2
    });
  });

  describe("tiktoken-approx strategy", () => {
    const counter = new TokenCounter({ strategy: "tiktoken-approx" });

    it("counts empty string as 0", () => {
      expect(counter.countText("")).toBe(0);
    });

    it("counts short words as ~1 token each", () => {
      const count = counter.countText("the cat sat");
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThan(10);
    });

    it("counts long words with sub-word splits", () => {
      const count = counter.countText("internationalization");
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it("handles punctuation", () => {
      const withPunct = counter.countText("Hello, world! How are you?");
      const withoutPunct = counter.countText("Hello world How are you");
      expect(withPunct).toBeGreaterThanOrEqual(withoutPunct);
    });

    it("handles mixed content", () => {
      const count = counter.countText(
        "function calculateTotal(items: Item[]): number { return items.reduce((sum, i) => sum + i.price, 0); }",
      );
      expect(count).toBeGreaterThan(10);
    });
  });

  describe("provider-reported strategy", () => {
    it("starts with tiktoken-approx baseline", () => {
      const counter = new TokenCounter({ strategy: "provider-reported" });
      const count = counter.countText("Hello world");
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it("calibrates from actual token count", () => {
      const counter = new TokenCounter({ strategy: "provider-reported" });
      const text = "Hello world, this is a test sentence.";
      const before = counter.countText(text);

      // Calibrate: pretend actual count is 2x what we estimated
      counter.calibrate(text, before * 2);

      const after = counter.countText(text);
      expect(after).toBeCloseTo(before * 2, 0);
    });

    it("reports calibration factor", () => {
      const counter = new TokenCounter({ strategy: "provider-reported" });
      expect(counter.getCalibrationFactor()).toBe(1.0);
    });
  });

  describe("countMessage", () => {
    const counter = new TokenCounter({ strategy: "character" });

    it("counts message content + overhead", () => {
      const msg: ChatMessage = { role: "user", content: "Hello" };
      const count = counter.countMessage(msg);
      // 5/4 = 2 + 4 overhead = 6
      expect(count).toBe(6);
    });

    it("counts tool calls within message", () => {
      const msg: ChatMessage = {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc-1", name: "search", input: { query: "AI" } }],
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(4); // At least overhead
    });

    it("counts tool results within message", () => {
      const msg: ChatMessage = {
        role: "tool",
        content: "Result data",
        toolResults: [{ toolCallId: "tc-1", name: "search", output: "Found 3 results" }],
      };
      const count = counter.countMessage(msg);
      expect(count).toBeGreaterThan(4);
    });
  });

  describe("countMessages", () => {
    const counter = new TokenCounter({ strategy: "character" });

    it("sums message counts", () => {
      const messages: ChatMessage[] = [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
      ];
      const total = counter.countMessages(messages);
      const individual = messages.reduce((sum, m) => sum + counter.countMessage(m), 0);
      expect(total).toBe(individual);
    });

    it("returns 0 for empty array", () => {
      expect(counter.countMessages([])).toBe(0);
    });
  });

  describe("countToolDef", () => {
    const counter = new TokenCounter({ strategy: "character" });

    it("counts tool name + description + schema + overhead", () => {
      const tool: LLMToolDefinition = {
        name: "search",
        description: "Search the web for information",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      };
      const count = counter.countToolDef(tool);
      expect(count).toBeGreaterThan(10 + 10); // overhead included
    });
  });

  describe("countToolDefs", () => {
    const counter = new TokenCounter({ strategy: "character" });

    it("sums tool definition counts", () => {
      const tools: LLMToolDefinition[] = [
        { name: "search", description: "Search", inputSchema: { type: "object" } },
        { name: "read", description: "Read file", inputSchema: { type: "object" } },
      ];
      const total = counter.countToolDefs(tools);
      const individual = tools.reduce((sum, t) => sum + counter.countToolDef(t), 0);
      expect(total).toBe(individual);
    });

    it("returns 0 for empty array", () => {
      expect(counter.countToolDefs([])).toBe(0);
    });
  });

  describe("default strategy", () => {
    it("defaults to tiktoken-approx", () => {
      const counter = new TokenCounter();
      const count = counter.countText("Hello world");
      // Should use tiktoken-approx, not character
      expect(count).toBeGreaterThanOrEqual(2);
    });
  });
});
