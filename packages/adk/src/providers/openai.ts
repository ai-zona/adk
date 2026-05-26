// ──────────────────────────────────────────────────────
// ADK OpenAI Provider
// ──────────────────────────────────────────────────────

import { extractText } from "../content/helpers";
import type {
  ChatParams,
  ChatParamsWithTools,
  ChatResponse,
  ChatResponseWithToolCalls,
  CompleteParams,
  CompleteResponse,
  EmbedParams,
  EmbedResponse,
  ProviderInitConfig,
  StreamChunk,
} from "../types/llm";
import { BaseProvider } from "./base-provider";
import { toOpenAIContent } from "./content-adapters";

const DEFAULT_MODEL = "gpt-4o";
const API_URL = "https://api.openai.com/v1";

export class OpenAIProvider extends BaseProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly isLocal: boolean = false;

  constructor(config: ProviderInitConfig) {
    super({ ...config, defaultModel: config.defaultModel ?? DEFAULT_MODEL });
    this.providerId = config.providerId ?? "openai";
    this.displayName = config.providerId === "xai" ? "xAI" : "OpenAI";
    this.baseUrl = config.baseUrl ?? API_URL;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getModels(): string[] {
    return Array.from(this.modelCosts.keys()).length > 0
      ? Array.from(this.modelCosts.keys())
      : ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3", "o4-mini"];
  }

  estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
    return this.calculateCost(inputTokens, outputTokens, model);
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    return this.chatWithTools(params);
  }

  async complete(params: CompleteParams): Promise<CompleteResponse> {
    const chatResult = await this.chat({
      messages: [{ role: "user", content: params.prompt }],
      model: params.model,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });
    return {
      text: chatResult.content,
      model: chatResult.model,
      providerId: chatResult.providerId,
      inputTokens: chatResult.inputTokens,
      outputTokens: chatResult.outputTokens,
      totalTokens: chatResult.totalTokens,
      latencyMs: chatResult.latencyMs,
      costUsd: chatResult.costUsd,
      finishReason: chatResult.finishReason,
    };
  }

  async chatWithTools(params: ChatParamsWithTools): Promise<ChatResponseWithToolCalls> {
    const model = params.model ?? this.defaultModel;
    const startTime = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: params.messages.flatMap(
        (
          m,
        ): { role: string; content?: unknown; tool_call_id?: string; tool_calls?: unknown[] }[] => {
          if (m.role === "tool" && m.toolResults) {
            return m.toolResults.map((tr) => ({
              role: "tool" as const,
              tool_call_id: tr.toolCallId,
              content: typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output),
            }));
          }
          if (m.role === "assistant" && m.toolCalls) {
            return [
              {
                role: "assistant" as const,
                content: extractText(m.content) || null,
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: { name: tc.name, arguments: JSON.stringify(tc.input) },
                })),
              },
            ];
          }
          return [{ role: m.role, content: toOpenAIContent(m.content) }];
        },
      ),
    };

    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
    if (params.stopSequences) body.stop = params.stopSequences;

    // Tools
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    // Response format
    if (params.responseFormat) {
      body.response_format = params.responseFormat;
    }

    // Tool choice
    if (params.toolChoice) {
      if (params.toolChoice === "required") body.tool_choice = "required";
      else if (params.toolChoice === "none") body.tool_choice = "none";
      else if (typeof params.toolChoice === "object")
        body.tool_choice = { type: "function", function: { name: params.toolChoice.name } };
      else body.tool_choice = "auto";
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw this.normalizeError(
        Object.assign(new Error(`OpenAI API error (${response.status}): ${error}`), {
          status: response.status,
        }),
        model,
      );
    }

    const data = (await response.json()) as {
      choices: Array<{
        message: {
          content?: string;
          tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
        };
        finish_reason: string;
      }>;
      model: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const latencyMs = Date.now() - startTime;
    const choice = data.choices[0]!;
    const inputTokens = data.usage.prompt_tokens;
    const outputTokens = data.usage.completion_tokens;

    const toolCalls = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
    }));

    return {
      content: choice.message.content ?? "",
      model: data.model,
      providerId: this.providerId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs,
      costUsd: this.calculateCost(inputTokens, outputTokens, model),
      finishReason: choice.finish_reason,
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async embed(params: EmbedParams): Promise<EmbedResponse> {
    const startTime = Date.now();
    const model = params.model ?? "text-embedding-3-small";

    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: params.input, model }),
    });

    if (!response.ok) {
      throw this.normalizeError(
        Object.assign(new Error(`OpenAI embedding error (${response.status})`), {
          status: response.status,
        }),
        model,
      );
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      model: string;
      usage: { total_tokens: number };
    };

    return {
      embeddings: data.data.map((d) => d.embedding),
      model: data.model,
      providerId: this.providerId,
      totalTokens: data.usage.total_tokens,
      latencyMs: Date.now() - startTime,
      costUsd: 0,
    };
  }

  async *chatStream(params: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
    const model = params.model ?? this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      stream: true,
      messages: params.messages.map((m) => ({ role: m.role, content: toOpenAIContent(m.content) })),
    };

    if (params.maxTokens) body.max_tokens = params.maxTokens;
    if (params.temperature !== undefined) body.temperature = params.temperature;

    if (params.tools) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw this.normalizeError(
        Object.assign(new Error(`OpenAI streaming error (${response.status})`), {
          status: response.status,
        }),
        model,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") return;

          try {
            const event = JSON.parse(jsonStr) as {
              choices: Array<{
                delta: {
                  content?: string;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
              }>;
              usage?: { prompt_tokens: number; completion_tokens: number };
            };

            const delta = event.choices[0]?.delta;
            if (delta?.content) {
              yield { type: "text_delta", content: delta.content };
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id && tc.function?.name) {
                  yield { type: "tool_use_start", id: tc.id, name: tc.function.name };
                }
                if (tc.function?.arguments) {
                  yield {
                    type: "tool_use_delta",
                    id: tc.id ?? `tool-${tc.index}`,
                    inputJson: tc.function.arguments,
                  };
                }
              }
            }
            if (event.usage) {
              yield {
                type: "message_end",
                usage: {
                  inputTokens: event.usage.prompt_tokens,
                  outputTokens: event.usage.completion_tokens,
                },
              };
            }
          } catch {
            // Skip
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
