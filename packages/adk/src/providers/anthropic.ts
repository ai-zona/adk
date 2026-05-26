// ──────────────────────────────────────────────────────
// ADK Anthropic Provider
// ──────────────────────────────────────────────────────
// Extended with tool_use + streaming from platform-agents
// ──────────────────────────────────────────────────────

import { extractText } from "../content/helpers";
import type {
  ChatParams,
  ChatParamsWithTools,
  ChatResponse,
  ChatResponseWithToolCalls,
  CompleteParams,
  CompleteResponse,
  ProviderInitConfig,
  StreamChunk,
} from "../types/llm";
import { BaseProvider } from "./base-provider";
import { toAnthropicContent } from "./content-adapters";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const API_URL = "https://api.anthropic.com";

export class AnthropicProvider extends BaseProvider {
  readonly providerId = "anthropic";
  readonly displayName = "Anthropic";
  readonly isLocal = false;

  constructor(config: ProviderInitConfig) {
    super({ ...config, defaultModel: config.defaultModel ?? DEFAULT_MODEL });
    this.baseUrl = config.baseUrl ?? API_URL;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getModels(): string[] {
    return Array.from(this.modelCosts.keys()).length > 0
      ? Array.from(this.modelCosts.keys())
      : ["claude-opus-4-6", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"];
  }

  estimateCost(inputTokens: number, outputTokens: number, model?: string): number {
    return this.calculateCost(inputTokens, outputTokens, model);
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    const result = await this.chatWithTools(params);
    return result;
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

    // Build Anthropic request
    const body: Record<string, unknown> = {
      model,
      max_tokens: params.maxTokens ?? 4096,
      messages: params.messages
        .filter((m) => m.role !== "system")
        .map((m) => {
          if (m.role === "tool" && m.toolResults) {
            return {
              role: "user",
              content: m.toolResults.map((tr) => ({
                type: "tool_result",
                tool_use_id: tr.toolCallId,
                content: typeof tr.output === "string" ? tr.output : JSON.stringify(tr.output),
                is_error: tr.isError,
              })),
            };
          }
          if (m.role === "assistant" && m.toolCalls) {
            const text = extractText(m.content);
            return {
              role: "assistant",
              content: [
                ...(text ? [{ type: "text", text }] : []),
                ...m.toolCalls.map((tc) => ({
                  type: "tool_use",
                  id: tc.id,
                  name: tc.name,
                  input: tc.input,
                })),
              ],
            };
          }
          return {
            role: m.role === "tool" ? "user" : m.role,
            content: toAnthropicContent(m.content),
          };
        }),
    };

    // System prompt — promote to array form when cache_control is set, so the
    // system block can be cached across turns.
    const systemMsg = params.messages.find((m) => m.role === "system");
    const systemPrompt =
      params.systemPrompt ?? (systemMsg ? extractText(systemMsg.content) : undefined);
    if (systemPrompt) {
      if (systemMsg?.cacheControl) {
        body.system = [
          {
            type: "text",
            text: systemPrompt,
            cache_control: systemMsg.cacheControl,
          },
        ];
      } else {
        body.system = systemPrompt;
      }
    }

    // Extended thinking
    if (params.thinking) {
      body.thinking = {
        type: params.thinking.type,
        budget_tokens: params.thinking.budgetTokens,
      };
    }

    // Tools
    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    if (params.temperature !== undefined) body.temperature = params.temperature;
    if (params.topP !== undefined) body.top_p = params.topP;
    if (params.stopSequences) body.stop_sequences = params.stopSequences;

    // Tool choice
    if (params.toolChoice) {
      if (params.toolChoice === "required") body.tool_choice = { type: "any" };
      else if (params.toolChoice === "none") body.tool_choice = { type: "none" };
      else if (typeof params.toolChoice === "object")
        body.tool_choice = { type: "tool", name: params.toolChoice.name };
      else body.tool_choice = { type: "auto" };
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw this.normalizeError(
        Object.assign(new Error(`Anthropic API error (${response.status}): ${error}`), {
          status: response.status,
        }),
        model,
      );
    }

    const data = (await response.json()) as {
      content: Array<{
        type: string;
        text?: string;
        thinking?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }>;
      model: string;
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      stop_reason: string;
    };

    const latencyMs = Date.now() - startTime;
    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    const cacheCreationInputTokens = data.usage.cache_creation_input_tokens;
    const cacheReadInputTokens = data.usage.cache_read_input_tokens;

    // Extract text, thinking, and tool calls
    let content = "";
    let thinking = "";
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];

    for (const block of data.content) {
      if (block.type === "text" && block.text) {
        content += block.text;
      } else if (block.type === "thinking" && block.thinking) {
        thinking += block.thinking;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id!,
          name: block.name!,
          input: block.input,
        });
      }
    }

    // Cache tokens billed at the input rate (cache reads at a discount in Anthropic's
    // real pricing — we treat them as input-rate here so the local estimate at least
    // counts the read volume; provider-side billing is authoritative).
    const billableInputTokens =
      inputTokens + (cacheCreationInputTokens ?? 0) + (cacheReadInputTokens ?? 0);

    return {
      content,
      model: data.model,
      providerId: this.providerId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs,
      costUsd: this.calculateCost(billableInputTokens, outputTokens, model),
      finishReason: data.stop_reason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      thinking: thinking || undefined,
    };
  }

  async *chatStream(params: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
    const model = params.model ?? this.defaultModel;

    const body: Record<string, unknown> = {
      model,
      max_tokens: params.maxTokens ?? 4096,
      stream: true,
      messages: params.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "tool" ? "user" : m.role,
          content: toAnthropicContent(m.content),
        })),
    };

    const streamSysMsg = params.messages.find((m) => m.role === "system");
    const streamSystemPrompt =
      params.systemPrompt ?? (streamSysMsg ? extractText(streamSysMsg.content) : undefined);
    if (streamSystemPrompt) {
      if (streamSysMsg?.cacheControl) {
        body.system = [
          {
            type: "text",
            text: streamSystemPrompt,
            cache_control: streamSysMsg.cacheControl,
          },
        ];
      } else {
        body.system = streamSystemPrompt;
      }
    }

    if (params.thinking) {
      body.thinking = {
        type: params.thinking.type,
        budget_tokens: params.thinking.budgetTokens,
      };
    }

    if (params.tools) {
      body.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    if (params.temperature !== undefined) body.temperature = params.temperature;

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok || !response.body) {
      throw this.normalizeError(
        Object.assign(new Error(`Anthropic streaming error (${response.status})`), {
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
              type: string;
              delta?: {
                type: string;
                text?: string;
                thinking?: string;
                partial_json?: string;
              };
              content_block?: { type: string; id?: string; name?: string };
              index?: number;
              usage?: {
                input_tokens: number;
                output_tokens: number;
                cache_creation_input_tokens?: number;
                cache_read_input_tokens?: number;
              };
            };

            if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
              yield {
                type: "tool_use_start",
                id: event.content_block.id!,
                name: event.content_block.name!,
              };
            } else if (event.type === "content_block_delta") {
              if (event.delta?.type === "text_delta" && event.delta.text) {
                yield { type: "text_delta", content: event.delta.text };
              } else if (event.delta?.type === "thinking_delta" && event.delta.thinking) {
                yield { type: "thinking_delta", content: event.delta.thinking };
              } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
                yield {
                  type: "tool_use_delta",
                  id: `tool-${event.index}`,
                  inputJson: event.delta.partial_json,
                };
              }
            } else if (event.type === "content_block_stop") {
              // Could be text, thinking, or tool_use end
            } else if (event.type === "message_delta" && event.usage) {
              yield {
                type: "message_end",
                usage: {
                  inputTokens: event.usage.input_tokens,
                  outputTokens: event.usage.output_tokens,
                  cacheCreationInputTokens: event.usage.cache_creation_input_tokens,
                  cacheReadInputTokens: event.usage.cache_read_input_tokens,
                },
              };
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
