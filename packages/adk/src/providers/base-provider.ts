// ──────────────────────────────────────────────────────
// ADK Base Provider — Abstract base with tool_use + streaming
// ──────────────────────────────────────────────────────

import type {
  ADKLLMProvider,
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
import { ADKProviderError } from "./errors";

export abstract class BaseProvider implements ADKLLMProvider {
  abstract readonly providerId: string;
  abstract readonly displayName: string;
  abstract readonly isLocal: boolean;

  protected apiKey?: string;
  protected baseUrl?: string;
  protected defaultModel: string;
  protected modelCosts: Map<string, { input: number; output: number }>;

  constructor(config: ProviderInitConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.defaultModel = config.defaultModel ?? "";
    this.modelCosts = config.modelCosts ?? new Map();
  }

  abstract chat(params: ChatParams): Promise<ChatResponse>;
  abstract complete(params: CompleteParams): Promise<CompleteResponse>;
  abstract chatWithTools(params: ChatParamsWithTools): Promise<ChatResponseWithToolCalls>;
  abstract chatStream(params: ChatParamsWithTools): AsyncGenerator<StreamChunk>;

  embed?(_params: EmbedParams): Promise<EmbedResponse>;
  abstract isAvailable(): boolean;
  abstract getModels(): string[];
  abstract estimateCost(inputTokens: number, outputTokens: number, model?: string): number;

  /** Update model costs (for hot-update from discovery) */
  updateModelCosts(costs: Map<string, { input: number; output: number }>): void {
    this.modelCosts = costs;
  }

  /**
   * Health check — sends a minimal chat request to verify provider reachability.
   * Subclasses can override for more specific checks (e.g., model listing).
   * Returns healthy status, latency, and optional error message.
   */
  async isHealthy(): Promise<{ healthy: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      await this.chat({
        messages: [{ role: "user", content: "ping" }],
        model: this.defaultModel || undefined,
        maxTokens: 1,
      });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Normalize any thrown error into a structured ADKProviderError */
  protected normalizeError(err: unknown, model?: string): ADKProviderError {
    if (err instanceof ADKProviderError) return err;

    const status =
      (err as Record<string, unknown>)?.status ?? (err as Record<string, unknown>)?.statusCode;

    if (status === 429) return ADKProviderError.rateLimited(this.providerId, undefined, err);
    if (status === 401) return ADKProviderError.invalidApiKey(this.providerId, err);
    if (status === 413) return ADKProviderError.contextExceeded(this.providerId, model, err);
    if (status === 404)
      return ADKProviderError.modelNotFound(this.providerId, model ?? "unknown", err);
    if (status === 503 || status === 502)
      return ADKProviderError.serviceUnavailable(this.providerId, err);

    if (
      err instanceof Error &&
      (err.message.includes("ECONNREFUSED") ||
        err.message.includes("ENOTFOUND") ||
        err.message.includes("fetch failed"))
    ) {
      return ADKProviderError.networkError(this.providerId, err);
    }

    if (
      err instanceof Error &&
      (err.message.includes("timeout") || err.message.includes("ETIMEDOUT"))
    ) {
      return ADKProviderError.timeout(this.providerId, err);
    }

    return ADKProviderError.unknown(this.providerId, err);
  }

  protected getModelCost(model?: string): { input: number; output: number } {
    const m = model ?? this.defaultModel;
    return this.modelCosts.get(m) ?? { input: 0, output: 0 };
  }

  protected calculateCost(inputTokens: number, outputTokens: number, model?: string): number {
    const costs = this.getModelCost(model);
    return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
  }
}
