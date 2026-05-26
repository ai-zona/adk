import { describe, expect, it } from "vitest";
import type {
  ChatParams,
  ChatParamsWithTools,
  ChatResponse,
  ChatResponseWithToolCalls,
  CompleteParams,
  CompleteResponse,
  StreamChunk,
} from "../../types/llm";
import { BaseProvider } from "../base-provider";
import { ADKProviderError } from "../errors";

// Concrete subclass to test the protected normalizeError method
class TestProvider extends BaseProvider {
  readonly providerId = "test-provider";
  readonly displayName = "Test";
  readonly isLocal = false;

  // Expose normalizeError for testing
  public testNormalizeError(err: unknown, model?: string) {
    return this.normalizeError(err, model);
  }

  chat(_params: ChatParams): Promise<ChatResponse> {
    throw new Error("Not implemented");
  }
  complete(_params: CompleteParams): Promise<CompleteResponse> {
    throw new Error("Not implemented");
  }
  chatWithTools(_params: ChatParamsWithTools): Promise<ChatResponseWithToolCalls> {
    throw new Error("Not implemented");
  }
  // biome-ignore lint/correctness/useYield: stub generator for test
  async *chatStream(_params: ChatParamsWithTools): AsyncGenerator<StreamChunk> {
    throw new Error("Not implemented");
  }
  isAvailable(): boolean {
    return true;
  }
  getModels(): string[] {
    return [];
  }
  estimateCost(): number {
    return 0;
  }
}

describe("ADKProviderError", () => {
  describe("static factory methods", () => {
    it("rateLimited creates correct error", () => {
      const err = ADKProviderError.rateLimited("anthropic", 5000, { orig: true });
      expect(err).toBeInstanceOf(ADKProviderError);
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.providerId).toBe("anthropic");
      expect(err.retryable).toBe(true);
      expect(err.retryAfterMs).toBe(5000);
      expect(err.statusCode).toBe(429);
      expect(err.raw).toEqual({ orig: true });
      expect(err.name).toBe("ADKProviderError");
      expect(err.message).toContain("anthropic");
    });

    it("contextExceeded creates correct error", () => {
      const err = ADKProviderError.contextExceeded("openai", "gpt-4o");
      expect(err.code).toBe("CONTEXT_LENGTH_EXCEEDED");
      expect(err.providerId).toBe("openai");
      expect(err.model).toBe("gpt-4o");
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(413);
      expect(err.message).toContain("gpt-4o");
    });

    it("contextExceeded uses unknown when model is omitted", () => {
      const err = ADKProviderError.contextExceeded("openai");
      expect(err.message).toContain("unknown");
    });

    it("invalidApiKey creates correct error", () => {
      const err = ADKProviderError.invalidApiKey("google");
      expect(err.code).toBe("INVALID_API_KEY");
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(401);
    });

    it("modelNotFound creates correct error", () => {
      const err = ADKProviderError.modelNotFound("openai", "gpt-99");
      expect(err.code).toBe("MODEL_NOT_FOUND");
      expect(err.model).toBe("gpt-99");
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(404);
      expect(err.message).toContain("gpt-99");
    });

    it("contentFiltered creates correct error", () => {
      const err = ADKProviderError.contentFiltered("anthropic");
      expect(err.code).toBe("CONTENT_FILTERED");
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(400);
    });

    it("serviceUnavailable creates correct error", () => {
      const err = ADKProviderError.serviceUnavailable("openai");
      expect(err.code).toBe("SERVICE_UNAVAILABLE");
      expect(err.retryable).toBe(true);
      expect(err.statusCode).toBe(503);
    });

    it("timeout creates correct error", () => {
      const err = ADKProviderError.timeout("google");
      expect(err.code).toBe("TIMEOUT");
      expect(err.retryable).toBe(true);
      expect(err.statusCode).toBeUndefined();
    });

    it("networkError creates correct error", () => {
      const err = ADKProviderError.networkError("ollama");
      expect(err.code).toBe("NETWORK_ERROR");
      expect(err.retryable).toBe(true);
    });

    it("insufficientQuota creates correct error", () => {
      const err = ADKProviderError.insufficientQuota("openai");
      expect(err.code).toBe("INSUFFICIENT_QUOTA");
      expect(err.retryable).toBe(false);
      expect(err.statusCode).toBe(402);
    });

    it("unknown creates correct error from Error", () => {
      const rawErr = new Error("something broke");
      const err = ADKProviderError.unknown("xai", rawErr);
      expect(err.code).toBe("UNKNOWN");
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("something broke");
      expect(err.raw).toBe(rawErr);
    });

    it("unknown creates correct error from string", () => {
      const err = ADKProviderError.unknown("test", "plain string");
      expect(err.message).toContain("plain string");
    });
  });

  describe("constructor defaults", () => {
    it("retryable defaults to false", () => {
      const err = new ADKProviderError({
        code: "UNKNOWN",
        message: "test",
        providerId: "test",
      });
      expect(err.retryable).toBe(false);
    });

    it("optional fields are undefined when not provided", () => {
      const err = new ADKProviderError({
        code: "UNKNOWN",
        message: "test",
        providerId: "test",
      });
      expect(err.model).toBeUndefined();
      expect(err.retryAfterMs).toBeUndefined();
      expect(err.statusCode).toBeUndefined();
      expect(err.raw).toBeUndefined();
    });
  });

  describe("normalizeError on BaseProvider", () => {
    const provider = new TestProvider({});

    it("passes through existing ADKProviderError unchanged", () => {
      const original = ADKProviderError.rateLimited("anthropic", 1000);
      const result = provider.testNormalizeError(original);
      expect(result).toBe(original);
    });

    it("maps status 429 to RATE_LIMITED", () => {
      const err = provider.testNormalizeError({ status: 429 });
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.retryable).toBe(true);
    });

    it("maps status 401 to INVALID_API_KEY", () => {
      const err = provider.testNormalizeError({ status: 401 });
      expect(err.code).toBe("INVALID_API_KEY");
      expect(err.retryable).toBe(false);
    });

    it("maps status 413 to CONTEXT_LENGTH_EXCEEDED", () => {
      const err = provider.testNormalizeError({ status: 413 }, "gpt-4o");
      expect(err.code).toBe("CONTEXT_LENGTH_EXCEEDED");
      expect(err.model).toBe("gpt-4o");
    });

    it("maps status 404 to MODEL_NOT_FOUND", () => {
      const err = provider.testNormalizeError({ status: 404 }, "gpt-99");
      expect(err.code).toBe("MODEL_NOT_FOUND");
      expect(err.model).toBe("gpt-99");
    });

    it("maps status 503 to SERVICE_UNAVAILABLE", () => {
      const err = provider.testNormalizeError({ status: 503 });
      expect(err.code).toBe("SERVICE_UNAVAILABLE");
      expect(err.retryable).toBe(true);
    });

    it("maps status 502 to SERVICE_UNAVAILABLE", () => {
      const err = provider.testNormalizeError({ status: 502 });
      expect(err.code).toBe("SERVICE_UNAVAILABLE");
    });

    it("maps statusCode property as well", () => {
      const err = provider.testNormalizeError({ statusCode: 429 });
      expect(err.code).toBe("RATE_LIMITED");
    });

    it("maps ECONNREFUSED to NETWORK_ERROR", () => {
      const err = provider.testNormalizeError(new Error("connect ECONNREFUSED 127.0.0.1:11434"));
      expect(err.code).toBe("NETWORK_ERROR");
      expect(err.retryable).toBe(true);
    });

    it("maps ENOTFOUND to NETWORK_ERROR", () => {
      const err = provider.testNormalizeError(new Error("getaddrinfo ENOTFOUND api.openai.com"));
      expect(err.code).toBe("NETWORK_ERROR");
    });

    it("maps fetch failed to NETWORK_ERROR", () => {
      const err = provider.testNormalizeError(new Error("fetch failed"));
      expect(err.code).toBe("NETWORK_ERROR");
    });

    it("maps timeout message to TIMEOUT", () => {
      const err = provider.testNormalizeError(new Error("Request timeout after 30000ms"));
      expect(err.code).toBe("TIMEOUT");
      expect(err.retryable).toBe(true);
    });

    it("maps ETIMEDOUT to TIMEOUT", () => {
      const err = provider.testNormalizeError(new Error("connect ETIMEDOUT"));
      expect(err.code).toBe("TIMEOUT");
    });

    it("falls back to UNKNOWN for unrecognized errors", () => {
      const err = provider.testNormalizeError(new Error("something random"));
      expect(err.code).toBe("UNKNOWN");
      expect(err.retryable).toBe(false);
      expect(err.message).toContain("something random");
    });

    it("falls back to UNKNOWN for non-Error values", () => {
      const err = provider.testNormalizeError("just a string");
      expect(err.code).toBe("UNKNOWN");
      expect(err.message).toContain("just a string");
    });

    it("includes providerId from the provider instance", () => {
      const err = provider.testNormalizeError(new Error("fail"));
      expect(err.providerId).toBe("test-provider");
    });
  });
});
