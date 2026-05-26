// ──────────────────────────────────────────────────────
// ADK LLM Adapter — Circuit breaker + metrics
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/runtime/llm-adapter.ts
// Extended with tool calling and streaming support
// ──────────────────────────────────────────────────────

import type { ADKEventBus } from "../events/event-bus";
import type {
  ADKLLMProvider,
  ChatParams,
  ChatParamsWithTools,
  ChatResponse,
  ChatResponseWithToolCalls,
  CircuitBreakerState,
  CompleteParams,
  CompleteResponse,
  EmbedParams,
  EmbedResponse,
  ProviderMetrics,
  StreamChunk,
} from "../types/llm";

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 30_000;
const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = 3;

export class ADKLLMAdapter {
  private providers = new Map<string, ADKLLMProvider>();
  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private metrics = new Map<string, ProviderMetrics>();
  private eventBus?: ADKEventBus;

  constructor(eventBus?: ADKEventBus) {
    this.eventBus = eventBus;
  }

  registerProvider(provider: ADKLLMProvider): void {
    this.providers.set(provider.providerId, provider);
    this.circuitBreakers.set(provider.providerId, {
      providerId: provider.providerId,
      state: "closed",
      failures: 0,
      lastFailure: null,
      lastSuccess: null,
      openedAt: null,
    });
    this.metrics.set(provider.providerId, {
      providerId: provider.providerId,
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      avgLatencyMs: 0,
      totalCostUsd: 0,
      lastCallAt: null,
    });
  }

  unregisterProvider(providerId: string): void {
    this.providers.delete(providerId);
    this.circuitBreakers.delete(providerId);
    this.metrics.delete(providerId);
  }

  getProvider(providerId: string): ADKLLMProvider | undefined {
    return this.providers.get(providerId);
  }

  getAllProviders(): ADKLLMProvider[] {
    return Array.from(this.providers.values());
  }

  getAvailableProviders(): ADKLLMProvider[] {
    return this.getAllProviders().filter((p) => {
      if (!p.isAvailable()) return false;
      const cb = this.getCircuitState(p.providerId);
      return cb.state !== "open";
    });
  }

  getCircuitState(providerId: string): CircuitBreakerState {
    const cb = this.circuitBreakers.get(providerId);
    if (!cb) {
      return {
        providerId,
        state: "closed",
        failures: 0,
        lastFailure: null,
        lastSuccess: null,
        openedAt: null,
      };
    }
    if (cb.state === "open" && cb.openedAt) {
      if (Date.now() - cb.openedAt >= CIRCUIT_BREAKER_RESET_MS) {
        cb.state = "half-open";
      }
    }
    return cb;
  }

  getProviderMetrics(providerId: string): ProviderMetrics | undefined {
    return this.metrics.get(providerId);
  }

  getAllMetrics(): ProviderMetrics[] {
    return Array.from(this.metrics.values());
  }

  async chat(
    providerId: string,
    params: ChatParams,
    context?: { agentSlug?: string; taskId?: string },
  ): Promise<ChatResponse> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`LLM provider "${providerId}" not registered`);
    this.checkCircuitBreaker(providerId);

    const startTime = Date.now();
    try {
      const response = await provider.chat(params);
      this.recordSuccess(providerId, Date.now() - startTime, response.costUsd);
      this.emitCallCompleted(providerId, response, context);
      return response;
    } catch (error) {
      this.recordFailure(providerId);
      this.emitCallFailed(providerId, params.model, error, Date.now() - startTime, context);
      throw error;
    }
  }

  async chatWithTools(
    providerId: string,
    params: ChatParamsWithTools,
    context?: { agentSlug?: string; taskId?: string },
  ): Promise<ChatResponseWithToolCalls> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`LLM provider "${providerId}" not registered`);
    this.checkCircuitBreaker(providerId);

    const startTime = Date.now();
    try {
      const response = await provider.chatWithTools(params);
      this.recordSuccess(providerId, Date.now() - startTime, response.costUsd);
      this.emitCallCompleted(providerId, response, context);
      return response;
    } catch (error) {
      this.recordFailure(providerId);
      this.emitCallFailed(providerId, params.model, error, Date.now() - startTime, context);
      throw error;
    }
  }

  async *chatStream(providerId: string, params: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`LLM provider "${providerId}" not registered`);
    this.checkCircuitBreaker(providerId);

    yield* provider.chatStream(params);
  }

  async complete(providerId: string, params: CompleteParams): Promise<CompleteResponse> {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`LLM provider "${providerId}" not registered`);
    this.checkCircuitBreaker(providerId);

    const startTime = Date.now();
    try {
      const response = await provider.complete(params);
      this.recordSuccess(providerId, Date.now() - startTime, response.costUsd);
      return response;
    } catch (error) {
      this.recordFailure(providerId);
      throw error;
    }
  }

  async embed(providerId: string, params: EmbedParams): Promise<EmbedResponse> {
    const provider = this.providers.get(providerId);
    if (!provider?.embed) throw new Error(`Provider "${providerId}" doesn't support embeddings`);

    const startTime = Date.now();
    try {
      const response = await provider.embed(params);
      this.recordSuccess(providerId, Date.now() - startTime, response.costUsd);
      return response;
    } catch (error) {
      this.recordFailure(providerId);
      throw error;
    }
  }

  private checkCircuitBreaker(providerId: string): void {
    const cb = this.getCircuitState(providerId);
    if (cb.state === "open") {
      throw new Error(`Circuit breaker open for provider "${providerId}"`);
    }
  }

  private recordSuccess(providerId: string, latencyMs: number, costUsd: number): void {
    const cb = this.circuitBreakers.get(providerId);
    if (cb) {
      cb.lastSuccess = Date.now();
      if (cb.state === "half-open") {
        cb.failures = Math.max(0, cb.failures - 1);
        if (cb.failures <= CIRCUIT_BREAKER_THRESHOLD - CIRCUIT_BREAKER_SUCCESS_THRESHOLD) {
          cb.state = "closed";
          cb.failures = 0;
          cb.openedAt = null;
        }
      } else {
        cb.failures = 0;
      }
    }
    const m = this.metrics.get(providerId);
    if (m) {
      m.totalCalls++;
      m.successCalls++;
      m.avgLatencyMs = (m.avgLatencyMs * (m.totalCalls - 1) + latencyMs) / m.totalCalls;
      m.totalCostUsd += costUsd;
      m.lastCallAt = Date.now();
    }
  }

  private recordFailure(providerId: string): void {
    const cb = this.circuitBreakers.get(providerId);
    if (cb) {
      cb.failures++;
      cb.lastFailure = Date.now();
      if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
        cb.state = "open";
        cb.openedAt = Date.now();
      }
    }
    const m = this.metrics.get(providerId);
    if (m) {
      m.totalCalls++;
      m.failedCalls++;
      m.lastCallAt = Date.now();
    }
  }

  private emitCallCompleted(
    providerId: string,
    response: ChatResponse,
    context?: { agentSlug?: string; taskId?: string },
  ): void {
    try {
      this.eventBus?.emit("llm.call.completed", {
        callId: `${providerId}-${Date.now()}`,
        providerId,
        model: response.model,
        agentSlug: context?.agentSlug,
        taskId: context?.taskId,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        costUsd: response.costUsd,
        latencyMs: response.latencyMs,
        ttfbMs: response.ttfbMs,
        timestamp: Date.now(),
      });
    } catch {
      /* non-critical */
    }
  }

  private emitCallFailed(
    providerId: string,
    model: string | undefined,
    error: unknown,
    latencyMs: number,
    context?: { agentSlug?: string; taskId?: string },
  ): void {
    try {
      this.eventBus?.emit("llm.call.failed", {
        callId: `${providerId}-${Date.now()}`,
        providerId,
        model: model ?? "unknown",
        agentSlug: context?.agentSlug,
        taskId: context?.taskId,
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
        timestamp: Date.now(),
      });
    } catch {
      /* non-critical */
    }
  }

  reset(): void {
    this.providers.clear();
    this.circuitBreakers.clear();
    this.metrics.clear();
  }
}
