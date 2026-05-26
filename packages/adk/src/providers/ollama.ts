// ──────────────────────────────────────────────────────
// ADK Ollama Provider (Local)
// ──────────────────────────────────────────────────────

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
import { toOllamaContent } from "./content-adapters";

const DEFAULT_MODEL = "llama3.2";
const API_URL = "http://localhost:11434";

export class OllamaProvider extends BaseProvider {
  readonly providerId = "ollama";
  readonly displayName = "Ollama";
  readonly isLocal = true;
  private knownModels: string[];

  constructor(config: ProviderInitConfig) {
    super({ ...config, defaultModel: config.defaultModel ?? DEFAULT_MODEL });
    this.baseUrl = config.baseUrl ?? API_URL;
    this.knownModels = config.knownModels ?? [DEFAULT_MODEL];
  }

  isAvailable(): boolean {
    return true; // Local — always "available", may fail on actual call
  }

  getModels(): string[] {
    return this.knownModels;
  }

  estimateCost(): number {
    return 0; // Local is free
  }

  updateKnownModels(models: string[]): void {
    this.knownModels = models;
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    return this.chatWithTools(params);
  }

  async complete(params: CompleteParams): Promise<CompleteResponse> {
    const startTime = Date.now();
    const model = params.model ?? this.defaultModel;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: params.prompt,
        stream: false,
        options: {
          temperature: params.temperature,
          top_p: params.topP,
          num_predict: params.maxTokens,
          stop: params.stopSequences,
        },
      }),
    });

    if (!response.ok) {
      throw this.normalizeError(
        Object.assign(new Error(`Ollama error (${response.status})`), {
          status: response.status,
        }),
        model,
      );
    }

    const data = (await response.json()) as {
      response: string;
      model: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: data.response,
      model: data.model,
      providerId: this.providerId,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      latencyMs: Date.now() - startTime,
      costUsd: 0,
      finishReason: "stop",
    };
  }

  async chatWithTools(params: ChatParamsWithTools): Promise<ChatResponseWithToolCalls> {
    const model = params.model ?? this.defaultModel;
    const startTime = Date.now();

    const body: Record<string, unknown> = {
      model,
      messages: params.messages.map((m) => {
        const { content, images } = toOllamaContent(m.content);
        return images ? { role: m.role, content, images } : { role: m.role, content };
      }),
      stream: false,
      options: {
        temperature: params.temperature,
        top_p: params.topP,
        num_predict: params.maxTokens,
      },
    };

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

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw this.normalizeError(
        Object.assign(new Error(`Ollama error (${response.status})`), {
          status: response.status,
        }),
        model,
      );
    }

    const data = (await response.json()) as {
      message: {
        content: string;
        tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
      };
      model: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    const latencyMs = Date.now() - startTime;
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;

    const toolCalls = data.message.tool_calls?.map((tc, i) => ({
      id: `call-${i}`,
      name: tc.function.name,
      input: tc.function.arguments,
    }));

    return {
      content: data.message.content,
      model: data.model,
      providerId: this.providerId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs,
      costUsd: 0,
      finishReason: "stop",
      toolCalls: toolCalls && toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: streaming response parsing requires branching
  async *chatStream(params: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
    const model = params.model ?? this.defaultModel;

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: params.messages.map((m) => {
          const { content, images } = toOllamaContent(m.content);
          return images ? { role: m.role, content, images } : { role: m.role, content };
        }),
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw this.normalizeError(
        Object.assign(new Error(`Ollama streaming error (${response.status})`), {
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
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as {
              message?: { content: string };
              done: boolean;
              prompt_eval_count?: number;
              eval_count?: number;
            };
            if (event.message?.content) {
              yield { type: "text_delta", content: event.message.content };
            }
            if (event.done) {
              yield {
                type: "message_end",
                usage: {
                  inputTokens: event.prompt_eval_count ?? 0,
                  outputTokens: event.eval_count ?? 0,
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
