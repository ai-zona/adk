// ──────────────────────────────────────────────────────
// ADK Google Provider (Gemini)
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
import { toGoogleParts } from "./content-adapters";

const DEFAULT_MODEL = "gemini-2.0-flash";
const API_URL = "https://generativelanguage.googleapis.com";

export class GoogleProvider extends BaseProvider {
  readonly providerId = "google";
  readonly displayName = "Google";
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
      : ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"];
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

    // Convert messages to Google format
    const contents = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: toGoogleParts(m.content),
      }));

    const body: Record<string, unknown> = { contents };

    // System instruction
    const systemMsg = params.messages.find((m) => m.role === "system");
    const systemPrompt =
      params.systemPrompt ?? (systemMsg ? extractText(systemMsg.content) : undefined);
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    // Generation config
    const generationConfig: Record<string, unknown> = {};
    if (params.maxTokens) generationConfig.maxOutputTokens = params.maxTokens;
    if (params.temperature !== undefined) generationConfig.temperature = params.temperature;
    if (params.topP !== undefined) generationConfig.topP = params.topP;
    if (params.stopSequences) generationConfig.stopSequences = params.stopSequences;

    if (
      params.responseFormat?.type === "json_schema" ||
      params.responseFormat?.type === "json_object"
    ) {
      generationConfig.responseMimeType = "application/json";
      if (params.responseFormat.type === "json_schema" && "schema" in params.responseFormat) {
        generationConfig.responseSchema = params.responseFormat.schema;
      }
    }

    if (Object.keys(generationConfig).length > 0) {
      body.generationConfig = generationConfig;
    }

    // Tools
    if (params.tools && params.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: params.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
    }

    const response = await fetch(
      `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw this.normalizeError(
        Object.assign(new Error(`Google API error (${response.status}): ${error}`), {
          status: response.status,
        }),
        model,
      );
    }

    const data = (await response.json()) as {
      candidates: Array<{
        content: {
          parts: Array<{ text?: string; functionCall?: { name: string; args: unknown } }>;
        };
        finishReason: string;
      }>;
      usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
    };

    const latencyMs = Date.now() - startTime;
    const candidate = data.candidates[0]!;
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    let content = "";
    const toolCalls: Array<{ id: string; name: string; input: unknown }> = [];
    let toolCallCounter = 0;

    for (const part of candidate.content.parts) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `call-${++toolCallCounter}`,
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      }
    }

    return {
      content,
      model,
      providerId: this.providerId,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs,
      costUsd: this.calculateCost(inputTokens, outputTokens, model),
      finishReason: candidate.finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  async *chatStream(params: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
    const model = params.model ?? this.defaultModel;

    const contents = params.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: toGoogleParts(m.content),
      }));

    const body: Record<string, unknown> = { contents };

    const streamSysMsg = params.messages.find((m) => m.role === "system");
    const systemPrompt =
      params.systemPrompt ?? (streamSysMsg ? extractText(streamSysMsg.content) : undefined);
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const response = await fetch(
      `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?key=${this.apiKey}&alt=sse`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok || !response.body) {
      throw this.normalizeError(
        Object.assign(new Error(`Google streaming error (${response.status})`), {
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
          try {
            const event = JSON.parse(line.slice(6)) as {
              candidates?: Array<{ content: { parts: Array<{ text?: string }> } }>;
              usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
            };
            const text = event.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield { type: "text_delta", content: text };
            if (event.usageMetadata) {
              yield {
                type: "message_end",
                usage: {
                  inputTokens: event.usageMetadata.promptTokenCount,
                  outputTokens: event.usageMetadata.candidatesTokenCount,
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
