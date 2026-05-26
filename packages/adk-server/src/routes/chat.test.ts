import type { ADKLLMProvider, ChatResponse } from "@aizonaai/adk";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../server";

// ─── Rank 27 — OpenAI-compatible /v1/chat/completions proxy ──────
// Plan: (1) forwards the request into the configured provider's chat()
//       call; (2) the inbound client Authorization header is not leaked
//       to the provider call.

/** Build a stub ADKLLMProvider with a spy on chat(). */
function buildProvider(): ADKLLMProvider & {
  chat: ReturnType<typeof vi.fn>;
} {
  const chatResponse: ChatResponse = {
    content: "pong",
    model: "gpt-4o-mini",
    providerId: "stub",
    inputTokens: 7,
    outputTokens: 3,
    totalTokens: 10,
    latencyMs: 5,
    costUsd: 0.0001,
    finishReason: "stop",
  };
  const chat = vi.fn().mockResolvedValue(chatResponse);
  return {
    providerId: "stub",
    displayName: "Stub Provider",
    isLocal: true,
    chat,
    complete: vi.fn(),
    isAvailable: () => true,
    getModels: () => ["gpt-4o-mini"],
    estimateCost: () => 0.0001,
    chatWithTools: vi.fn(),
    chatStream: vi.fn(),
  } as unknown as ADKLLMProvider & { chat: ReturnType<typeof vi.fn> };
}

describe("POST /v1/chat/completions", () => {
  it("forwards the OpenAI-format request into the default provider's chat() method", async () => {
    const provider = buildProvider();
    const app = createServer({ defaultProvider: provider });

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "be concise" },
          { role: "user", content: "ping" },
        ],
        temperature: 0.3,
        max_tokens: 50,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Response shape is the OpenAI chat.completion envelope.
    expect(body.object).toBe("chat.completion");
    expect(body.choices[0].message).toEqual({ role: "assistant", content: "pong" });
    expect(body.usage).toEqual({ prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 });

    // The provider was called exactly once with the translated payload —
    // system message pulled out, snake_case translated to camelCase.
    expect(provider.chat).toHaveBeenCalledTimes(1);
    const args = provider.chat.mock.calls[0][0] as {
      messages: { role: string; content: string }[];
      systemPrompt?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    };
    expect(args.systemPrompt).toBe("be concise");
    expect(args.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(args.model).toBe("gpt-4o-mini");
    expect(args.temperature).toBe(0.3);
    expect(args.maxTokens).toBe(50);
  });

  it("does not leak the inbound Authorization header into the provider call", async () => {
    const provider = buildProvider();
    // Accept any API key so we get past auth and reach the chat handler.
    const app = createServer({
      defaultProvider: provider,
      validateApiKey: async () => ({
        id: "key-1",
        keyHash: "hash",
        type: "live" as const,
        permissions: [],
        active: true,
        ownerId: "user-1",
      }),
    });

    const inboundAuth = "Bearer aiz_live_SECRET_client_token";
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: inboundAuth,
        "X-Custom-Secret": "do-not-forward",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(provider.chat).toHaveBeenCalledTimes(1);

    // The provider.chat() arguments are a plain params object — no headers
    // field at all — which is exactly the point: the proxy never passes
    // client auth on to the provider. Stringify and scan for the secret.
    const argsBlob = JSON.stringify(provider.chat.mock.calls[0][0]);
    expect(argsBlob).not.toContain("aiz_live_SECRET_client_token");
    expect(argsBlob).not.toContain("Authorization");
    expect(argsBlob).not.toContain("X-Custom-Secret");
  });
});
