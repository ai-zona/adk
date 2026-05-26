import { describe, expect, it, vi } from "vitest";
import type { ADKLLMProvider, ChatMessage } from "../types/llm";
import { ContextManager } from "./context-manager";
import { MemorySessionBackend } from "./memory-backend";

describe("MemorySessionBackend", () => {
  it("creates and retrieves a session", async () => {
    const backend = new MemorySessionBackend();
    const session = await backend.create({ agentName: "test-agent" });

    expect(session.id).toContain("session-");
    expect(session.agentName).toBe("test-agent");
    expect(session.messages).toEqual([]);
    expect(session.status).toBe("active");

    const retrieved = await backend.get(session.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(session.id);
  });

  it("returns null for non-existent session", async () => {
    const backend = new MemorySessionBackend();
    const result = await backend.get("non-existent");
    expect(result).toBeNull();
  });

  it("appends messages", async () => {
    const backend = new MemorySessionBackend();
    const session = await backend.create({ agentName: "test" });

    await backend.appendMessages(session.id, [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
    ]);

    const updated = await backend.get(session.id);
    expect(updated?.messages).toHaveLength(2);
  });

  it("updates session metadata and status", async () => {
    const backend = new MemorySessionBackend();
    const session = await backend.create({ agentName: "test" });

    await backend.update(session.id, {
      metadata: { key: "value" },
      status: "closed",
    });

    const updated = await backend.get(session.id);
    expect(updated?.metadata).toEqual({ key: "value" });
    expect(updated?.status).toBe("closed");
  });

  it("forks a session", async () => {
    const backend = new MemorySessionBackend();
    const original = await backend.create({ agentName: "test" });
    await backend.appendMessages(original.id, [{ role: "user", content: "Hello" }]);

    const forked = await backend.fork(original.id);

    expect(forked.id).not.toBe(original.id);
    expect(forked.parentId).toBe(original.id);
    expect(forked.messages).toHaveLength(1);
    expect(forked.agentName).toBe("test");
  });

  it("deletes a session", async () => {
    const backend = new MemorySessionBackend();
    const session = await backend.create({ agentName: "test" });

    await backend.delete(session.id);

    const result = await backend.get(session.id);
    expect(result).toBeNull();
  });

  it("lists sessions with filters", async () => {
    const backend = new MemorySessionBackend();
    await backend.create({ agentName: "agent-a" });
    await backend.create({ agentName: "agent-b" });
    await backend.create({ agentName: "agent-a" });

    const all = await backend.list();
    expect(all).toHaveLength(3);

    const filtered = await backend.list({ agentName: "agent-a" });
    expect(filtered).toHaveLength(2);

    const limited = await backend.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it("detects expired sessions", async () => {
    const backend = new MemorySessionBackend();
    const session = await backend.create({
      agentName: "test",
      expiresAt: new Date(Date.now() - 1000), // Already expired
    });

    const retrieved = await backend.get(session.id);
    expect(retrieved?.status).toBe("expired");
  });

  it("returns copies (not references)", async () => {
    const backend = new MemorySessionBackend();
    const session = await backend.create({ agentName: "test" });
    await backend.appendMessages(session.id, [{ role: "user", content: "Hello" }]);

    const retrieved = await backend.get(session.id);
    retrieved?.messages.push({ role: "assistant", content: "Injected!" });

    // Original should not be affected
    const original = await backend.get(session.id);
    expect(original?.messages).toHaveLength(1);
  });
});

describe("ContextManager", () => {
  const manager = new ContextManager();

  it("returns messages if under budget", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Be helpful." },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ];

    const trimmed = await manager.trimToFit(messages, 10000);
    expect(trimmed).toHaveLength(3);
  });

  it("trims old messages but keeps system and recent", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "System prompt." },
      { role: "user", content: "First message that is quite long ".repeat(100) },
      { role: "assistant", content: "First reply that is also long ".repeat(100) },
      { role: "user", content: "Latest question" },
      { role: "assistant", content: "Latest answer" },
    ];

    // Very small budget — should keep system + latest
    const trimmed = await manager.trimToFit(messages, 50);
    expect(trimmed[0]?.role).toBe("system");
    expect(trimmed.length).toBeLessThan(messages.length);
  });

  it("preserves system message", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Important system prompt." },
      { role: "user", content: "A".repeat(10000) },
      { role: "assistant", content: "B".repeat(10000) },
      { role: "user", content: "Short" },
    ];

    const trimmed = await manager.trimToFit(messages, 100);
    expect(trimmed[0]?.role).toBe("system");
  });

  it("getTokenCount returns token count for messages", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "Hello world" }];
    const count = manager.getTokenCount(messages);
    expect(count).toBeGreaterThan(0);
  });
});

describe("ContextManager (smart-summary)", () => {
  it("uses smart-summary with mock provider", async () => {
    const mockProvider: ADKLLMProvider = {
      providerId: "mock",
      displayName: "Mock",
      isLocal: true,
      chat: vi.fn(async () => ({
        content: "User discussed topics A and B.",
        model: "mock",
        providerId: "mock",
        inputTokens: 50,
        outputTokens: 20,
        totalTokens: 70,
        latencyMs: 50,
        costUsd: 0.001,
        finishReason: "stop",
      })),
      complete: vi.fn(),
      isAvailable: () => true,
      getModels: () => ["mock"],
      estimateCost: () => 0,
      chatWithTools: vi.fn(),
      async *chatStream() {
        yield { type: "text_delta" as const, content: "summary" };
        yield { type: "message_end" as const, usage: { inputTokens: 50, outputTokens: 20 } };
      },
    };

    const manager = new ContextManager({
      summarization: { provider: mockProvider },
      keepRecentTurns: 1,
    });

    const messages: ChatMessage[] = [
      { role: "system", content: "Be helpful." },
      { role: "user", content: "Old question ".repeat(200) },
      { role: "assistant", content: "Old answer ".repeat(200) },
      { role: "user", content: "Recent question" },
      { role: "assistant", content: "Recent answer" },
    ];

    const trimmed = await manager.trimToFit(messages, 200, "smart-summary");

    // Should have system + summary + recent messages
    expect(trimmed[0]?.role).toBe("system");
    expect(trimmed.length).toBeLessThan(messages.length);
    // Summary message should be present
    const summaryMsg = trimmed.find((m) =>
      (typeof m.content === "string" ? m.content : "").includes("[Previous conversation summary]"),
    );
    expect(summaryMsg).toBeTruthy();
  });

  it("falls back to sliding-window when no summarizer configured", async () => {
    const manager = new ContextManager(); // No summarization config

    const messages: ChatMessage[] = [
      { role: "system", content: "System." },
      { role: "user", content: "Long message ".repeat(200) },
      { role: "assistant", content: "Long reply ".repeat(200) },
      { role: "user", content: "Short" },
    ];

    const trimmed = await manager.trimToFit(messages, 50, "smart-summary");
    // Should fall back to sliding-window
    expect(trimmed[0]?.role).toBe("system");
    expect(trimmed.length).toBeLessThan(messages.length);
  });
});
