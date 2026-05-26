import type Redis from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthTranslator, MCPServerAuthType } from "../bridge/auth-translator";
import { type InMemoryRedis, createRedisStub } from "./helpers/in-memory-redis";

const ctx = {
  agentDid: "did:aza:testnet:alpha",
  agentId: "agent-alpha",
  serverId: "server-alpha",
};

describe("AuthTranslator", () => {
  let redis: InMemoryRedis;
  let translator: AuthTranslator;

  beforeEach(() => {
    redis = createRedisStub();
    translator = new AuthTranslator(redis as unknown as Redis);
  });

  // ── Test 1: NONE returns empty passthrough ──────────

  it("NONE auth type returns an empty headers object (passthrough)", async () => {
    const result = await translator.translate(ctx, MCPServerAuthType.NONE, { anything: "xyz" });
    expect(result).toEqual({ headers: {} });
  });

  // ── Test 2: BEARER inserts Authorization header ─────

  it("BEARER auth type inserts `Authorization: Bearer <token>` header", async () => {
    const result = await translator.translate(ctx, MCPServerAuthType.BEARER, {
      token: "secret-token-abc",
    });
    expect(result.headers).toEqual({
      Authorization: "Bearer secret-token-abc",
    });
  });

  // ── Test 3: API_KEY placement (default + custom header) ─

  it("API_KEY auth honours a custom header name when provided", async () => {
    // Default header is X-API-Key
    const defaultResult = await translator.translate(ctx, MCPServerAuthType.API_KEY, {
      apiKey: "k-1",
    });
    expect(defaultResult.headers).toEqual({ "X-API-Key": "k-1" });

    // Custom header overrides the default
    const customResult = await translator.translate(ctx, MCPServerAuthType.API_KEY, {
      apiKey: "k-2",
      headerName: "X-Custom-Auth",
    });
    expect(customResult.headers).toEqual({ "X-Custom-Auth": "k-2" });
  });

  // ── Test 4: OAUTH2 passthrough (refresh is TODO) ────

  it("OAUTH2 performs access-token passthrough without attempting refresh", async () => {
    // OAuth2 refresh is explicitly TODO in the source - we verify:
    //   1. A valid access token produces Authorization Bearer
    //   2. Missing access token gracefully yields empty headers (no crash)
    //   3. No Redis I/O happens from refresh attempts
    const spy = vi.spyOn(redis, "get");

    const withToken = await translator.translate(ctx, MCPServerAuthType.OAUTH2, {
      accessToken: "oauth-access-1",
      refreshToken: "oauth-refresh-1", // present, must NOT trigger refresh logic
    });
    expect(withToken.headers).toEqual({
      Authorization: "Bearer oauth-access-1",
    });

    const withoutToken = await translator.translate(ctx, MCPServerAuthType.OAUTH2, {
      refreshToken: "oauth-refresh-1",
    });
    expect(withoutToken.headers).toEqual({});

    // The translator must not consult Redis when inline credentials are provided
    expect(spy).not.toHaveBeenCalled();
  });

  // ── Test 5: Credential cache TTL 24h in Redis ───────

  it("storeCredentials persists to Redis with a 24h TTL", async () => {
    const expireSpy = vi.spyOn(redis, "expire");

    await translator.storeCredentials("server-alpha", "agent-alpha", {
      token: "stored-token",
    });

    // 24 hours = 86400 seconds
    expect(expireSpy).toHaveBeenCalledWith(
      expect.stringContaining("mcp:creds:server-alpha:agent-alpha"),
      86400,
    );

    // The stored credentials are retrievable
    const got = await translator.getCredentials("server-alpha", "agent-alpha");
    expect(got).toEqual({ token: "stored-token" });

    // ...and usable for a BEARER translation (goes through Redis lookup, no inline creds)
    const result = await translator.translate(ctx, MCPServerAuthType.BEARER);
    expect(result.headers).toEqual({ Authorization: "Bearer stored-token" });
  });
});
