// ──────────────────────────────────────────────────────
// ADK LLM Router — 5 strategies + budget enforcement
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/runtime/llm-router.ts
// Extended with tool calling support
// ──────────────────────────────────────────────────────

import type {
  ADKLLMProvider,
  AgentLLMConfig,
  ChatParamsWithTools,
  ChatResponseWithToolCalls,
  RoutingStrategy,
} from "../types/llm";
import type { ADKLLMAdapter } from "./llm-adapter";

export class ADKRouter {
  private configs = new Map<string, AgentLLMConfig>();
  private budgetUsage = new Map<string, number>();
  private adapter: ADKLLMAdapter;

  constructor(adapter: ADKLLMAdapter) {
    this.adapter = adapter;
  }

  setConfig(agentSlug: string, config: AgentLLMConfig): void {
    this.configs.set(agentSlug, config);
  }

  getConfig(agentSlug: string): AgentLLMConfig {
    return (
      this.configs.get(agentSlug) ?? {
        agentSlug,
        enabledProviders: this.adapter.getAvailableProviders().map((p) => p.providerId),
        strategy: "balanced",
      }
    );
  }

  async route(
    agentSlug: string,
    params: ChatParamsWithTools,
    context?: { taskId?: string },
  ): Promise<ChatResponseWithToolCalls> {
    const config = this.getConfig(agentSlug);

    // Budget check
    if (config.budgetLimitUsd) {
      const used = this.budgetUsage.get(agentSlug) ?? 0;
      if (used >= config.budgetLimitUsd) {
        // Try local/free provider fallback
        const freeProvider = this.adapter.getAvailableProviders().find((p) => p.isLocal);
        if (freeProvider) {
          return this.adapter.chatWithTools(freeProvider.providerId, params, {
            agentSlug,
            ...context,
          });
        }
        throw new Error(
          `Budget exceeded for agent "${agentSlug}": $${used.toFixed(4)} >= $${config.budgetLimitUsd}`,
        );
      }
    }

    // Select provider based on strategy
    const providerId = this.selectProvider(config);
    if (!providerId) {
      throw new Error(`No available provider for agent "${agentSlug}"`);
    }

    const response = await this.adapter.chatWithTools(providerId, params, {
      agentSlug,
      ...context,
    });

    // Track budget
    const currentUsage = this.budgetUsage.get(agentSlug) ?? 0;
    this.budgetUsage.set(agentSlug, currentUsage + response.costUsd);

    return response;
  }

  private selectProvider(config: AgentLLMConfig): string | null {
    const available = this.adapter
      .getAvailableProviders()
      .filter((p) => config.enabledProviders.includes(p.providerId));

    if (available.length === 0) return null;

    switch (config.strategy) {
      case "cost-optimized":
        return this.selectCheapest(available);
      case "latency-optimized":
        return this.selectFastest(available);
      case "quality-optimized":
        return this.selectHighestQuality(available, config);
      case "balanced":
        return this.selectBalanced(available);
      case "fallback-chain":
        return this.selectFromChain(available, config);
      default:
        return available[0]?.providerId ?? null;
    }
  }

  private selectCheapest(providers: ADKLLMProvider[]): string {
    let cheapest = providers[0]!;
    let cheapestCost = cheapest.estimateCost(1000, 1000);
    for (let i = 1; i < providers.length; i++) {
      const provider = providers[i]!;
      const cost = provider.estimateCost(1000, 1000);
      if (cost < cheapestCost) {
        cheapest = provider;
        cheapestCost = cost;
      }
    }
    return cheapest.providerId;
  }

  private selectFastest(providers: ADKLLMProvider[]): string {
    let fastest = providers[0]!;
    let fastestLatency =
      this.adapter.getProviderMetrics(fastest.providerId)?.avgLatencyMs ?? Number.POSITIVE_INFINITY;
    for (let i = 1; i < providers.length; i++) {
      const provider = providers[i]!;
      const latency =
        this.adapter.getProviderMetrics(provider.providerId)?.avgLatencyMs ??
        Number.POSITIVE_INFINITY;
      if (latency < fastestLatency) {
        fastest = provider;
        fastestLatency = latency;
      }
    }
    return fastest.providerId;
  }

  private selectHighestQuality(providers: ADKLLMProvider[], config: AgentLLMConfig): string {
    if (config.preferredModel) {
      const preferred = providers.find((p) => p.getModels().includes(config.preferredModel!));
      if (preferred) return preferred.providerId;
    }
    return providers[0]?.providerId ?? "";
  }

  private selectBalanced(providers: ADKLLMProvider[]): string {
    let best = providers[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const p of providers) {
      const metrics = this.adapter.getProviderMetrics(p.providerId);
      const cost = p.estimateCost(1000, 1000);
      const latency = metrics?.avgLatencyMs ?? 500;
      const successRate = metrics?.totalCalls ? metrics.successCalls / metrics.totalCalls : 1;

      // Lower cost + lower latency + higher success rate = better
      const costScore = 1 / (1 + cost);
      const latencyScore = 1 / (1 + latency / 1000);
      const score = costScore * 0.3 + latencyScore * 0.3 + successRate * 0.4;

      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    return best.providerId;
  }

  private selectFromChain(providers: ADKLLMProvider[], config: AgentLLMConfig): string {
    if (config.fallbackChain) {
      for (const providerId of config.fallbackChain) {
        if (providers.some((p) => p.providerId === providerId)) {
          return providerId;
        }
      }
    }
    return providers[0]?.providerId ?? "";
  }

  resetBudget(agentSlug: string): void {
    this.budgetUsage.delete(agentSlug);
  }

  resetAllBudgets(): void {
    this.budgetUsage.clear();
  }

  getBudgetUsage(agentSlug: string): number {
    return this.budgetUsage.get(agentSlug) ?? 0;
  }

  reset(): void {
    this.configs.clear();
    this.budgetUsage.clear();
  }
}
