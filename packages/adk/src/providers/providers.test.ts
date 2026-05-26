import { describe, expect, it } from "vitest";
import type {
  ChatParams,
  ChatParamsWithTools,
  ChatResponse,
  ChatResponseWithToolCalls,
  CompleteParams,
  CompleteResponse,
  StreamChunk,
} from "../types/llm";
import { AnthropicProvider } from "./anthropic";
import { BaseProvider } from "./base-provider";
import { createProvider } from "./factory";
import { GoogleProvider } from "./google";
import { LMStudioProvider } from "./lmstudio";
import { OllamaProvider } from "./ollama";
import { OpenAIProvider } from "./openai";
import { XAIProvider } from "./xai";

/** Concrete test subclass to exercise BaseProvider.isHealthy() */
class TestProvider extends BaseProvider {
  readonly providerId = "test";
  readonly displayName = "Test";
  readonly isLocal = true;

  private chatImpl: (params: ChatParams) => Promise<ChatResponse>;

  constructor(chatImpl?: (params: ChatParams) => Promise<ChatResponse>) {
    super({ providerId: "test" });
    this.chatImpl =
      chatImpl ??
      (async () => ({
        content: "pong",
        model: "test-model",
        providerId: "test",
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        latencyMs: 5,
        costUsd: 0,
        finishReason: "stop",
      }));
  }

  async chat(params: ChatParams): Promise<ChatResponse> {
    return this.chatImpl(params);
  }
  async complete(_params: CompleteParams): Promise<CompleteResponse> {
    return {
      text: "",
      model: "test",
      providerId: "test",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      costUsd: 0,
    };
  }
  async chatWithTools(_params: ChatParamsWithTools): Promise<ChatResponseWithToolCalls> {
    return {
      content: "",
      model: "test",
      providerId: "test",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      latencyMs: 0,
      costUsd: 0,
      finishReason: "stop",
      toolCalls: [],
    };
  }
  async *chatStream(_params: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
    yield { type: "text", content: "" };
  }
  isAvailable() {
    return true;
  }
  getModels() {
    return ["test-model"];
  }
  estimateCost() {
    return 0;
  }
}

describe("Provider Factory", () => {
  it("creates Anthropic provider with API key", () => {
    const provider = createProvider({ providerId: "anthropic", apiKey: "test-key" });
    expect(provider).toBeInstanceOf(AnthropicProvider);
    expect(provider?.providerId).toBe("anthropic");
    expect(provider?.isAvailable()).toBe(true);
  });

  it("returns null for Anthropic without API key", () => {
    const provider = createProvider({ providerId: "anthropic" });
    expect(provider).toBeNull();
  });

  it("creates OpenAI provider", () => {
    const provider = createProvider({ providerId: "openai", apiKey: "test-key" });
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider?.providerId).toBe("openai");
  });

  it("creates Google provider", () => {
    const provider = createProvider({ providerId: "google", apiKey: "test-key" });
    expect(provider).toBeInstanceOf(GoogleProvider);
  });

  it("creates xAI provider", () => {
    const provider = createProvider({ providerId: "xai", apiKey: "test-key" });
    expect(provider).toBeInstanceOf(XAIProvider);
    expect(provider?.providerId).toBe("xai");
  });

  it("creates Ollama provider (no API key needed)", () => {
    const provider = createProvider({ providerId: "ollama" });
    expect(provider).toBeInstanceOf(OllamaProvider);
    expect(provider?.isLocal).toBe(true);
    expect(provider?.estimateCost(1000, 1000)).toBe(0);
  });

  it("creates LMStudio provider (no API key needed)", () => {
    const provider = createProvider({ providerId: "lmstudio" });
    expect(provider).toBeInstanceOf(LMStudioProvider);
    expect(provider?.isLocal).toBe(true);
    expect(provider?.estimateCost(1000, 1000)).toBe(0);
  });

  it("returns null for unknown provider", () => {
    const provider = createProvider({ providerId: "unknown" });
    expect(provider).toBeNull();
  });
});

describe("AnthropicProvider", () => {
  it("has correct defaults", () => {
    const p = new AnthropicProvider({ providerId: "anthropic", apiKey: "key" });
    expect(p.providerId).toBe("anthropic");
    expect(p.displayName).toBe("Anthropic");
    expect(p.isLocal).toBe(false);
    expect(p.getModels()).toContain("claude-opus-4-6");
  });

  it("estimates cost with model costs", () => {
    const costs = new Map([["claude-opus-4-6", { input: 5, output: 25 }]]);
    const p = new AnthropicProvider({ providerId: "anthropic", apiKey: "key", modelCosts: costs });
    const cost = p.estimateCost(1_000_000, 1_000_000, "claude-opus-4-6");
    expect(cost).toBe(30); // 5 + 25
  });
});

describe("OpenAIProvider", () => {
  it("has correct defaults", () => {
    const p = new OpenAIProvider({ providerId: "openai", apiKey: "key" });
    expect(p.providerId).toBe("openai");
    expect(p.displayName).toBe("OpenAI");
    expect(p.getModels()).toContain("gpt-4o");
  });
});

describe("OllamaProvider", () => {
  it("has correct defaults", () => {
    const p = new OllamaProvider({ providerId: "ollama" });
    expect(p.providerId).toBe("ollama");
    expect(p.isLocal).toBe(true);
    expect(p.isAvailable()).toBe(true);
  });

  it("updates known models", () => {
    const p = new OllamaProvider({ providerId: "ollama" });
    p.updateKnownModels(["llama3.2", "codellama"]);
    expect(p.getModels()).toContain("codellama");
  });
});

describe("BaseProvider.isHealthy", () => {
  it("returns healthy when chat succeeds", async () => {
    const p = new TestProvider();
    const result = await p.isHealthy();
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it("returns unhealthy with error message when chat fails", async () => {
    const p = new TestProvider(async () => {
      throw new Error("Connection refused");
    });
    const result = await p.isHealthy();
    expect(result.healthy).toBe(false);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBe("Connection refused");
  });

  it("handles non-Error thrown values", async () => {
    const p = new TestProvider(async () => {
      throw "string-error";
    });
    const result = await p.isHealthy();
    expect(result.healthy).toBe(false);
    expect(result.error).toBe("string-error");
  });

  it("measures latency", async () => {
    const p = new TestProvider(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return {
        content: "pong",
        model: "test",
        providerId: "test",
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        latencyMs: 20,
        costUsd: 0,
        finishReason: "stop",
      };
    });
    const result = await p.isHealthy();
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(15);
  });
});
