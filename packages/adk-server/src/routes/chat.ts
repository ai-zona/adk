// ──────────────────────────────────────────────────────
// POST /v1/chat/completions — OpenAI-compatible proxy
// ──────────────────────────────────────────────────────

import { Hono } from "hono";
import type { ServerConfig } from "../server";

export function chatRoutes(config: ServerConfig): Hono {
  const app = new Hono();

  // OpenAI-compatible chat completions proxy
  app.post("/completions", async (c) => {
    try {
      const body = await c.req.json();
      const { model, messages, temperature, max_tokens, stream } = body;

      if (!messages || !Array.isArray(messages)) {
        return c.json({ error: "messages is required" }, 400);
      }

      const provider = config.defaultProvider;
      if (!provider) {
        return c.json({ error: "No LLM provider configured" }, 503);
      }

      // Convert OpenAI format to ADK format
      const systemMsg = messages.find((m: { role: string }) => m.role === "system");
      const chatMessages = messages.filter((m: { role: string }) => m.role !== "system");

      const response = await provider.chat({
        messages: chatMessages.map((m: { role: string; content: string }) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        systemPrompt: systemMsg?.content,
        model,
        temperature,
        maxTokens: max_tokens,
      });

      // Track usage
      (c as any).set("usage", {
        providerId: (provider as any).id ?? "unknown",
        model: model ?? "default",
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: response.costUsd,
      });

      // Return OpenAI-compatible format
      return c.json({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: model ?? "default",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: response.content,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: response.inputTokens,
          completion_tokens: response.outputTokens,
          total_tokens: response.inputTokens + response.outputTokens,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      return c.json({ error: message }, 500);
    }
  });

  return app;
}
