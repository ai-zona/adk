import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { apiKeyAuth } from "./api-key-auth";

// ─── Rank 26 — API-key validation middleware ──────────────────────
// Plan: valid key passes → handler runs, invalid key → 401.
//
// We test the middleware in isolation by mounting it on a throwaway Hono app
// with a single downstream route, so we can observe both the short-circuit
// (401) and the pass-through behaviour.

function buildApp(validateFn: Parameters<typeof apiKeyAuth>[0]) {
  const app = new Hono();
  app.use("*", apiKeyAuth(validateFn));
  app.get("/ping", (c) => {
    // Assert that the middleware set the apiKey record on the context when
    // it allowed the request through.
    const key = c.get("apiKey");
    return c.json({ ok: true, ownerId: (key as { ownerId?: string })?.ownerId });
  });
  return app;
}

describe("apiKeyAuth middleware", () => {
  it("allows the request through when the key resolves to an active record", async () => {
    const validate = vi.fn().mockResolvedValue({
      id: "key-1",
      keyHash: "hashed",
      type: "live" as const,
      permissions: [],
      active: true,
      ownerId: "user-42",
    });
    const app = buildApp(validate);

    const res = await app.request("/ping", {
      headers: { Authorization: "Bearer aiz_live_abc123" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, ownerId: "user-42" });

    // The middleware must hash the raw key before asking the validator —
    // the validator never sees the plaintext. A SHA-256 hex is 64 chars.
    expect(validate).toHaveBeenCalledTimes(1);
    const passedHash = validate.mock.calls[0][0] as string;
    expect(passedHash).not.toBe("aiz_live_abc123");
    expect(passedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns 401 when the validator rejects the key", async () => {
    const validate = vi.fn().mockResolvedValue(null);
    const app = buildApp(validate);

    const res = await app.request("/ping", {
      headers: { Authorization: "Bearer aiz_live_unknown" },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Invalid API key" });
    // The downstream route must not have executed — easiest check is that
    // the success payload shape is NOT present.
    expect(body).not.toHaveProperty("ok");
  });
});
