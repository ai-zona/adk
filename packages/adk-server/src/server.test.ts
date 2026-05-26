import { describe, expect, it, vi } from "vitest";
import { createServer } from "./server";
import type { ServerConfig } from "./server";

describe("createServer", () => {
  it("creates a Hono app", () => {
    const app = createServer();
    expect(app).toBeTruthy();
    expect(typeof app.fetch).toBe("function");
  });

  it("health endpoint returns ok", async () => {
    const app = createServer();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });

  it("CORS headers are set", async () => {
    const app = createServer({ corsOrigins: ["*"] });
    const res = await app.request("/health");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("OPTIONS returns 204", async () => {
    const app = createServer();
    const res = await app.request("/health", { method: "OPTIONS" });
    expect(res.status).toBe(204);
  });

  it("OpenAPI spec endpoint works", async () => {
    const app = createServer();
    const res = await app.request("/v1/openapi.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("AIZona ADK API");
  });
});

describe("Agent routes", () => {
  it("lists agents (empty)", async () => {
    const app = createServer();
    const res = await app.request("/v1/agents");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toBeDefined();
  });

  it("registers an agent", async () => {
    const app = createServer();
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-agent", config: { model: "gpt-4" } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("test-agent");
    expect(body.id).toContain("agent-");
  });

  it("returns 400 for missing name", async () => {
    const app = createServer();
    const res = await app.request("/v1/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("gets agent by id", async () => {
    const app = createServer();
    // Create first
    const createRes = await app.request("/v1/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "get-test" }),
    });
    const created = await createRes.json();

    // Get by id
    const res = await app.request(`/v1/agents/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("get-test");
  });

  it("returns 404 for unknown agent", async () => {
    const app = createServer();
    const res = await app.request("/v1/agents/nonexistent");
    expect(res.status).toBe(404);
  });

  it("deletes an agent", async () => {
    const app = createServer();
    const createRes = await app.request("/v1/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "delete-test" }),
    });
    const created = await createRes.json();

    const res = await app.request(`/v1/agents/${created.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });
});

describe("Session routes", () => {
  it("creates a session", async () => {
    const app = createServer();
    const res = await app.request("/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName: "test-agent" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toContain("session-");
    expect(body.agentName).toBe("test-agent");
  });

  it("returns 404 for unknown session", async () => {
    const app = createServer();
    const res = await app.request("/v1/sessions/nonexistent");
    expect(res.status).toBe(404);
  });
});

describe("Key routes", () => {
  it("creates an API key", async () => {
    const app = createServer();
    const res = await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Key", type: "test" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.key).toMatch(/^aiz_test_/);
    expect(body.name).toBe("My Key");
  });

  it("lists keys (masked)", async () => {
    const app = createServer();
    // Create a key first
    await app.request("/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "List Test" }),
    });

    const res = await app.request("/v1/keys");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toBeDefined();
    // Masked keys should not expose the full key
    for (const k of body.keys) {
      expect(k).not.toHaveProperty("key");
    }
  });
});

describe("Run routes", () => {
  it("creates a run", async () => {
    const app = createServer();
    const res = await app.request("/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: "Hello" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toContain("run-");
    expect(body.status).toBe("completed");
  });

  it("returns 400 for missing input", async () => {
    const app = createServer();
    const res = await app.request("/v1/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("Tool routes", () => {
  it("lists tools (empty)", async () => {
    const app = createServer();
    const res = await app.request("/v1/tools");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toEqual([]);
  });
});

describe("API Key Auth middleware", () => {
  it("rejects requests without auth when enabled", async () => {
    const app = createServer({
      validateApiKey: async () => null,
    });
    const res = await app.request("/v1/agents");
    expect(res.status).toBe(401);
  });

  it("passes with valid API key", async () => {
    const app = createServer({
      validateApiKey: async () => ({
        id: "key-1",
        keyHash: "hash",
        type: "live" as const,
        permissions: [],
        active: true,
        ownerId: "user-1",
      }),
    });

    const res = await app.request("/v1/agents", {
      headers: { Authorization: "Bearer aiz_live_test" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects revoked key", async () => {
    const app = createServer({
      validateApiKey: async () => ({
        id: "key-1",
        keyHash: "hash",
        type: "live" as const,
        permissions: [],
        active: false,
        ownerId: "user-1",
      }),
    });

    const res = await app.request("/v1/agents", {
      headers: { Authorization: "Bearer aiz_live_test" },
    });
    expect(res.status).toBe(403);
  });
});

describe("Rate limiter middleware", () => {
  it("includes rate limit headers", async () => {
    const app = createServer({
      validateApiKey: async () => ({
        id: "key-1",
        keyHash: "hash",
        type: "live" as const,
        permissions: [],
        active: true,
        ownerId: "user-1",
      }),
      rateLimitRpm: 100,
    });

    const res = await app.request("/v1/agents", {
      headers: { Authorization: "Bearer aiz_live_test" },
    });
    expect(res.headers.get("X-RateLimit-Limit")).toBe("100");
  });
});
