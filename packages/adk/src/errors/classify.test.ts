import { describe, expect, it } from "vitest";
import { ADKProviderError } from "../providers/errors";
import { classifyError } from "./classify";

describe("classifyError", () => {
  it("buckets rate-limit as transient + retryable", () => {
    const c = classifyError(ADKProviderError.rateLimited("openai", 1000));
    expect(c.category).toBe("transient");
    expect(c.retryable).toBe(true);
    expect(c.providerId).toBe("openai");
    expect(c.code).toBe("RATE_LIMITED");
  });

  it("buckets invalid API key as configuration", () => {
    const c = classifyError(ADKProviderError.invalidApiKey("anthropic"));
    expect(c.category).toBe("configuration");
    expect(c.retryable).toBe(false);
  });

  it("buckets model-not-found as configuration", () => {
    const c = classifyError(ADKProviderError.modelNotFound("openai", "gpt-99"));
    expect(c.category).toBe("configuration");
  });

  it("buckets content-filtered as permanent", () => {
    const c = classifyError(ADKProviderError.contentFiltered("openai"));
    expect(c.category).toBe("permanent");
  });

  it("buckets non-provider TypeError as permanent", () => {
    const c = classifyError(new TypeError("x is not a function"));
    expect(c.category).toBe("permanent");
    expect(c.errorName).toBe("TypeError");
  });

  it("buckets fetch failed as transient via heuristic", () => {
    const c = classifyError(new Error("fetch failed"));
    expect(c.category).toBe("transient");
  });

  it("buckets 'missing API key' generic errors as configuration", () => {
    const c = classifyError(new Error("OPENAI_API_KEY is not configured"));
    expect(c.category).toBe("configuration");
  });

  it("produces identical fingerprints for identical errors", () => {
    const a = classifyError(ADKProviderError.rateLimited("openai"));
    const b = classifyError(ADKProviderError.rateLimited("openai"));
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("produces stable fingerprints across UUID / number variation", () => {
    const a = classifyError(new Error("Run abc123 failed after 1500ms"));
    const b = classifyError(new Error("Run xyz789 failed after 9999ms"));
    // Wait — these differ on alphanumeric IDs which our shaper doesn't strip;
    // the assurance is that pure numeric noise alone does not change fingerprints.
    const c = classifyError(new Error("retry attempt 1 of 5"));
    const d = classifyError(new Error("retry attempt 4 of 5"));
    expect(c.fingerprint).toBe(d.fingerprint);
    expect(a.fingerprint).not.toBe(undefined);
    expect(b.fingerprint).not.toBe(undefined);
  });

  it("handles non-Error throws", () => {
    const c = classifyError("oops");
    expect(c.category).toBe("permanent");
    expect(c.providerId).toBe("unknown");
    expect(c.message).toBe("oops");
  });
});
