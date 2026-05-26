// ──────────────────────────────────────────────────────
// Anthropic Provider — Extended Thinking tests
// ──────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatParamsWithTools, StreamChunk } from "../../types/llm";
import { AnthropicProvider } from "../anthropic";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseResponse(events: string[]): Response {
  const body = events.map((e) => `data: ${e}\n\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

const baseBody = {
  content: [
    { type: "thinking", thinking: "Let me think step by step..." },
    { type: "text", text: "Final answer." },
  ],
  model: "claude-sonnet-4-5-20250929",
  usage: { input_tokens: 10, output_tokens: 20 },
  stop_reason: "end_turn",
};

describe("AnthropicProvider — extended thinking", () => {
  let fetchMock: FetchMock;
  let provider: AnthropicProvider;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(baseBody));
    vi.stubGlobal("fetch", fetchMock);
    provider = new AnthropicProvider({
      providerId: "anthropic",
      apiKey: "sk-test",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes thinking config (snake_case) into the request body", async () => {
    const params: ChatParamsWithTools = {
      messages: [{ role: "user", content: "tricky question" }],
      thinking: { type: "enabled", budgetTokens: 10_000 },
    };

    await provider.chatWithTools(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 10_000 });
  });

  it("does not include thinking field when not configured", async () => {
    await provider.chatWithTools({
      messages: [{ role: "user", content: "hi" }],
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.thinking).toBeUndefined();
  });

  it("parses thinking content blocks into response.thinking, separate from content", async () => {
    const res = await provider.chatWithTools({
      messages: [{ role: "user", content: "tricky" }],
      thinking: { type: "enabled", budgetTokens: 5_000 },
    });

    expect(res.thinking).toBe("Let me think step by step...");
    expect(res.content).toBe("Final answer.");
  });

  it("parses thinking deltas from streaming responses", async () => {
    const events = [
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Hmm, " },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "let me consider..." },
      }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Answer." },
      }),
      JSON.stringify({
        type: "message_delta",
        usage: { input_tokens: 10, output_tokens: 8 },
      }),
    ];

    fetchMock.mockResolvedValueOnce(sseResponse(events));

    const chunks: StreamChunk[] = [];
    for await (const chunk of provider.chatStream({
      messages: [{ role: "user", content: "go" }],
      thinking: { type: "enabled", budgetTokens: 5_000 },
    })) {
      chunks.push(chunk);
    }

    const thinkingDeltas = chunks.filter((c) => c.type === "thinking_delta");
    expect(thinkingDeltas).toEqual([
      { type: "thinking_delta", content: "Hmm, " },
      { type: "thinking_delta", content: "let me consider..." },
    ]);

    const textDeltas = chunks.filter((c) => c.type === "text_delta");
    expect(textDeltas).toEqual([{ type: "text_delta", content: "Answer." }]);
  });

  it("propagates thinking config through chatStream request body", async () => {
    fetchMock.mockResolvedValueOnce(sseResponse([]));

    const gen = provider.chatStream({
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budgetTokens: 2_048 },
    });
    // Drain
    for await (const _chunk of gen) {
      // no-op
    }

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 2_048 });
  });
});
