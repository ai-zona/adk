// ──────────────────────────────────────────────────────
// Anthropic Provider — Prompt Caching tests
// ──────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatParamsWithTools } from "../../types/llm";
import { AnthropicProvider } from "../anthropic";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const okBody = {
  content: [{ type: "text", text: "hi" }],
  model: "claude-sonnet-4-5-20250929",
  usage: {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 200,
  },
  stop_reason: "end_turn",
};

describe("AnthropicProvider — prompt caching", () => {
  let fetchMock: FetchMock;
  let provider: AnthropicProvider;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(okBody));
    vi.stubGlobal("fetch", fetchMock);
    provider = new AnthropicProvider({
      providerId: "anthropic",
      apiKey: "sk-test",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes cache_control on system message when set via cacheControl on the system message", async () => {
    const params: ChatParamsWithTools = {
      messages: [
        {
          role: "system",
          content: "You are helpful.",
          cacheControl: { type: "ephemeral" },
        },
        { role: "user", content: "hi" },
      ],
    };

    await provider.chatWithTools(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);

    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system).toEqual([
      {
        type: "text",
        text: "You are helpful.",
        cache_control: { type: "ephemeral" },
      },
    ]);
  });

  it("sends plain string system when no cacheControl is provided", async () => {
    await provider.chatWithTools({
      messages: [
        { role: "system", content: "Plain prompt." },
        { role: "user", content: "hi" },
      ],
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe("Plain prompt.");
  });

  it("captures cache_creation_input_tokens and cache_read_input_tokens in response", async () => {
    const res = await provider.chatWithTools({
      messages: [
        {
          role: "system",
          content: "You are helpful.",
          cacheControl: { type: "ephemeral" },
        },
        { role: "user", content: "hi" },
      ],
    });

    expect(res.cacheCreationInputTokens).toBe(100);
    expect(res.cacheReadInputTokens).toBe(200);
  });

  it("omits cache token fields when the API does not return them", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        content: [{ type: "text", text: "hi" }],
        model: "claude-sonnet-4-5-20250929",
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn",
      }),
    );

    const res = await provider.chatWithTools({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.cacheCreationInputTokens).toBeUndefined();
    expect(res.cacheReadInputTokens).toBeUndefined();
  });

  it("includes cache tokens in cost estimation (counted at input rate)", async () => {
    const provider2 = new AnthropicProvider({
      providerId: "anthropic",
      apiKey: "sk-test",
      modelCosts: new Map([
        // Per-MT (per million) input/output rates
        ["claude-sonnet-4-5-20250929", { input: 3, output: 15 }],
      ]),
    });

    const res = await provider2.chatWithTools({
      messages: [
        {
          role: "system",
          content: "You are helpful.",
          cacheControl: { type: "ephemeral" },
        },
        { role: "user", content: "hi" },
      ],
      model: "claude-sonnet-4-5-20250929",
    });

    // input_tokens=10, output_tokens=5, cache_creation=100, cache_read=200
    // cost = (10 + 100 + 200) * 3/1M + 5 * 15/1M
    //      = 310 * 3e-6 + 5 * 15e-6 = 9.3e-4 + 7.5e-5 = 1.005e-3
    expect(res.costUsd).toBeCloseTo(0.001005, 9);
  });
});
