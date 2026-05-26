// ──────────────────────────────────────────────────────
// ADK LM Studio Provider (Local, OpenAI-compatible)
// ──────────────────────────────────────────────────────

import type { ProviderInitConfig } from "../types/llm";
import { OpenAIProvider } from "./openai";

const API_URL = "http://localhost:1234/v1";

export class LMStudioProvider extends OpenAIProvider {
  override readonly providerId = "lmstudio";
  override readonly displayName = "LM Studio";
  override readonly isLocal: boolean = true;

  constructor(config: ProviderInitConfig) {
    super({
      ...config,
      providerId: "lmstudio",
      baseUrl: config.baseUrl ?? API_URL,
      apiKey: config.apiKey ?? "lm-studio",
      defaultModel: config.defaultModel ?? "default",
    });
  }

  override isAvailable(): boolean {
    return true; // Local — always "available"
  }

  override estimateCost(): number {
    return 0; // Local is free
  }

  override getModels(): string[] {
    return this.knownModels ?? ["default"];
  }

  private knownModels?: string[];

  updateKnownModels(models: string[]): void {
    this.knownModels = models;
  }
}
