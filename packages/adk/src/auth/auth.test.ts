import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, parseApiKey, validateApiKeyFormat } from "./api-key";
import { ProxyRouter } from "./proxy-router";

describe("API Key", () => {
  it("generates a live key", () => {
    const { key, hash, prefix } = generateApiKey("live");
    expect(key).toMatch(/^aiz_live_[a-f0-9]{64}$/);
    expect(prefix).toBe("aiz_live_");
    expect(hash).toBeTruthy();
  });

  it("generates a test key", () => {
    const { key } = generateApiKey("test");
    expect(key).toMatch(/^aiz_test_[a-f0-9]{64}$/);
  });

  it("hashing is deterministic", () => {
    const key = "aiz_live_abc123";
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("different keys produce different hashes", () => {
    const { hash: h1 } = generateApiKey("live");
    const { hash: h2 } = generateApiKey("live");
    expect(h1).not.toBe(h2);
  });

  it("parseApiKey parses live key", () => {
    const { key } = generateApiKey("live");
    const parsed = parseApiKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("live");
  });

  it("parseApiKey parses test key", () => {
    const { key } = generateApiKey("test");
    const parsed = parseApiKey(key);
    expect(parsed?.type).toBe("test");
  });

  it("parseApiKey returns null for invalid key", () => {
    expect(parseApiKey("invalid_key")).toBeNull();
  });

  it("validateApiKeyFormat validates correct format", () => {
    const { key } = generateApiKey("live");
    expect(validateApiKeyFormat(key)).toBe(true);
  });

  it("validateApiKeyFormat rejects bad format", () => {
    expect(validateApiKeyFormat("bad")).toBe(false);
    expect(validateApiKeyFormat("aiz_live_short")).toBe(false);
    expect(validateApiKeyFormat(`aiz_live_${"g".repeat(64)}`)).toBe(false); // non-hex
  });

  it("round-trip: generate → parse → hash matches", () => {
    const { key, hash } = generateApiKey("live");
    const parsed = parseApiKey(key);
    expect(parsed?.hash).toBe(hash);
  });
});

describe("ProxyRouter", () => {
  it("resolves provider credentials", () => {
    const router = new ProxyRouter(
      new Map([
        ["openai", "sk-openai-key"],
        ["anthropic", "sk-anthropic-key"],
      ]),
    );

    const result = router.resolve(
      {
        id: "key-1",
        keyHash: "hash",
        type: "live",
        permissions: [],
        active: true,
        ownerId: "user-1",
      },
      "openai",
    );

    expect(result).not.toBeNull();
    expect(result?.apiKey).toBe("sk-openai-key");
  });

  it("returns null for unconfigured provider", () => {
    const router = new ProxyRouter(new Map([["openai", "key"]]));
    const result = router.resolve(
      {
        id: "key-1",
        keyHash: "hash",
        type: "live",
        permissions: [],
        active: true,
        ownerId: "user-1",
      },
      "google",
    );
    expect(result).toBeNull();
  });

  it("hasProvider checks availability", () => {
    const router = new ProxyRouter(new Map([["openai", "key"]]));
    expect(router.hasProvider("openai")).toBe(true);
    expect(router.hasProvider("google")).toBe(false);
  });

  it("getConfiguredProviders lists all", () => {
    const router = new ProxyRouter(
      new Map([
        ["openai", "k"],
        ["anthropic", "k"],
      ]),
    );
    expect(router.getConfiguredProviders()).toEqual(["openai", "anthropic"]);
  });
});
