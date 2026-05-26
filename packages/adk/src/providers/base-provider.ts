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

/** Retry policy for transient errors */
export interface RetryConfig {
  /** Max retry attempts after the initial call (default: 3 → up to 4 total) */
  maxRetries?: number;
  /** Base backoff in ms (default: 200) */
  baseDelayMs?: number;
  /** Max delay cap in ms (default: 10_000) */
  maxDelayMs?: number;
  /** Backoff multiplier (default: 2) */
  factor?: number;
  /** Jitter fraction 0..1 (default: 0.25) */
  jitter?: number;
  /** Optional sleep override (for tests) */
  sleep?: (ms: number) => Promise<void>;
  /** Optional clock override (for tests) */
  now?: () => number;
}

const DEFAULT_RETRY: Required<Omit<RetryConfig, "sleep" | "now">> = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 10_000,
  factor: 2,
  jitter: 0.25,
};

export abstract class BaseProvider implements ADKLLMProvider {
  abstract readonly providerId: string;
  abstract readonly displayName: string;
  abstract readonly isLocal: boolean;

  protected apiKey?: string;
  protected baseUrl?: string;
  protected defaultModel: string;
  protected modelCosts: Map<string, { input: number; output: number }>;
  protected retryConfig: Required<Omit<RetryConfig, "sleep" | "now">>;
  protected sleepFn: (ms: number) => Promise<void>;

  constructor(config: ProviderInitConfig & { retry?: RetryConfig }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
    this.defaultModel = config.defaultModel ?? "";
    this.modelCosts = config.modelCosts ?? new Map();
    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? DEFAULT_RETRY.maxRetries,
      baseDelayMs: config.retry?.baseDelayMs ?? DEFAULT_RETRY.baseDelayMs,
      maxDelayMs: config.retry?.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs,
      factor: config.retry?.factor ?? DEFAULT_RETRY.factor,
      jitter: config.retry?.jitter ?? DEFAULT_RETRY.jitter,
    };
    this.sleepFn = config.retry?.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Update retry config at runtime */
  setRetryConfig(config: RetryConfig): void {
    this.retryConfig = {
      maxRetries: config.maxRetries ?? this.retryConfig.maxRetries,
      baseDelayMs: config.baseDelayMs ?? this.retryConfig.baseDelayMs,
      maxDelayMs: config.maxDelayMs ?? this.retryConfig.maxDelayMs,
      factor: config.factor ?? this.retryConfig.factor,
      jitter: config.jitter ?? this.retryConfig.jitter,
    };
    if (config.sleep) this.sleepFn = config.sleep;
  }

  /**
   * Execute a network call with exponential backoff + jitter for transient errors.
   * Transient = `ADKProviderError.retryable === true` (429/502/503/network/timeout).
   * Honors `err.retryAfterMs` when present (rate-limit headers).
   */
  protected async withRetry<T>(fn: () => Promise<T>, model?: string): Promise<T> {
    const cfg = this.retryConfig;
    let attempt = 0;
    let lastErr: unknown;
    while (true) {
      try {
        return await fn();
      } catch (err) {
        const normalized = this.normalizeError(err, model);
        lastErr = normalized;
        if (!normalized.retryable || attempt >= cfg.maxRetries) {
          throw normalized;
        }
        const delay = this.computeBackoff(attempt, normalized.retryAfterMs);
        await this.sleepFn(delay);
        attempt++;
      }
    }
    // unreachable — TS doesn't know the while(true) only exits via throw/return
    // biome-ignore lint/correctness/noUnreachable: defensive
    throw lastErr;
  }

  /** Compute next backoff delay (ms) with jitter, respecting retryAfterMs hint */
  protected computeBackoff(attempt: number, retryAfterMs?: number): number {
    const cfg = this.retryConfig;
    const exp = Math.min(cfg.baseDelayMs * cfg.factor ** attempt, cfg.maxDelayMs);
    const jitterRange = exp * cfg.jitter;
    const jittered = exp + (Math.random() * 2 - 1) * jitterRange;
    const base = Math.max(0, Math.floor(jittered));
    if (retryAfterMs && retryAfterMs > base) {
      return Math.min(retryAfterMs, cfg.maxDelayMs);
    }
    return base;
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
