// ──────────────────────────────────────────────────────
// ADK Provider Factory
// ──────────────────────────────────────────────────────

import type { ADKLLMProvider, ProviderInitConfig } from "../types/llm";
import { AnthropicProvider } from "./anthropic";
import { GoogleProvider } from "./google";
import { LMStudioProvider } from "./lmstudio";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";
import { XAIProvider } from "./xai";

/** Create a provider from config. Returns null if required API key is missing for cloud providers. */
export function createProvider(config: ProviderInitConfig): ADKLLMProvider | null {
  switch (config.providerId) {
    case "anthropic":
      if (!config.apiKey) return null;
      return new AnthropicProvider(config);
    case "openai":
      if (!config.apiKey) return null;
      return new OpenAIProvider(config);
    case "google":
      if (!config.apiKey) return null;
      return new GoogleProvider(config);
    case "xai":
      if (!config.apiKey) return null;
      return new XAIProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    case "lmstudio":
      return new LMStudioProvider(config);
    default:
      return null;
  }
}
