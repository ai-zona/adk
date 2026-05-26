// ──────────────────────────────────────────────────────
// ADK xAI Provider (Grok)
// ──────────────────────────────────────────────────────
// Wraps OpenAI provider with xAI base URL

import type { ProviderInitConfig } from "../types/llm";
import { OpenAIProvider } from "./openai";

const DEFAULT_MODEL = "grok-3-mini";
const API_URL = "https://api.x.ai/v1";

export class XAIProvider extends OpenAIProvider {
  override readonly providerId = "xai";
  override readonly displayName = "xAI";

  constructor(config: ProviderInitConfig) {
    super({
      ...config,
      providerId: "xai",
      baseUrl: config.baseUrl ?? API_URL,
      defaultModel: config.defaultModel ?? DEFAULT_MODEL,
    });
  }

  override getModels(): string[] {
    return Array.from(this.modelCosts.keys()).length > 0
      ? Array.from(this.modelCosts.keys())
      : ["grok-4", "grok-4-fast", "grok-3-mini"];
  }
}
