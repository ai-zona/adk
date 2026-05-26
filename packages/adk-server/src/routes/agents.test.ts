import { describe, expect, it } from "vitest";
import { createServer } from "../server";

describe("agent routes", () => {
  // ── List agents ────────────────────────────────────────

  describe("GET /v1/agents", () => {
    it("returns empty agent list with total count", async () => {
      const app = createServer();
      const res = await app.request("/v1/agents");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.agents).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("returns agents after registration", async () => {
      const app = createServer();

      // Register two agents
      await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "agent-alpha" }),
      });
      await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "agent-beta" }),
      });

      const res = await app.request("/v1/agents");
      const body = await res.json();
      expect(body.agents).toHaveLength(2);
      expect(body.total).toBe(2);
    });
  });

  // ── Register agent ─────────────────────────────────────

  describe("POST /v1/agents", () => {
    it("registers an agent with config and metadata", async () => {
      const app = createServer();
      const res = await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "smart-agent",
          config: { model: "claude-sonnet-4-20250514", temperature: 0.7 },
          version: "2.0.0",
          metadata: { team: "engineering" },
        }),
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("smart-agent");
      expect(body.config.model).toBe("claude-sonnet-4-20250514");
      expect(body.version).toBe("2.0.0");
      expect(body.metadata.team).toBe("engineering");
      expect(body.id).toMatch(/^agent-/);
      expect(body.createdAt).toBeDefined();
    });

    it("returns 400 for missing name", async () => {
      const app = createServer();
      const res = await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: {} }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("name");
    });

    it("returns 400 for invalid JSON body", async () => {
      const app = createServer();
      const res = await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      });
      expect(res.status).toBe(400);
    });
  });

  // ── Get agent by ID ────────────────────────────────────

  describe("GET /v1/agents/:id", () => {
    it("retrieves a registered agent by ID", async () => {
      const app = createServer();
      const createRes = await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "lookup-agent" }),
      });
      const created = await createRes.json();

      const res = await app.request(`/v1/agents/${created.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(created.id);
      expect(body.name).toBe("lookup-agent");
    });

    it("returns 404 for nonexistent agent", async () => {
      const app = createServer();
      const res = await app.request("/v1/agents/agent-nonexistent");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  // ── Update agent ───────────────────────────────────────

  describe("PUT /v1/agents/:id", () => {
    it("updates an existing agent", async () => {
      const app = createServer();
      const createRes = await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "update-me", config: { model: "gpt-4" } }),
      });
      const created = await createRes.json();

      const res = await app.request(`/v1/agents/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { model: "claude-sonnet-4-20250514" } }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.config.model).toBe("claude-sonnet-4-20250514");
    });

    it("returns 404 for updating nonexistent agent", async () => {
      const app = createServer();
      const res = await app.request("/v1/agents/agent-nonexistent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: {} }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ── Delete agent ───────────────────────────────────────

  describe("DELETE /v1/agents/:id", () => {
    it("deletes an agent and confirms it is no longer retrievable", async () => {
      const app = createServer();
      const createRes = await app.request("/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "delete-me" }),
      });
      const created = await createRes.json();

      const deleteRes = await app.request(`/v1/agents/${created.id}`, {
        method: "DELETE",
      });
      expect(deleteRes.status).toBe(200);

      // Verify deleted
      const getRes = await app.request(`/v1/agents/${created.id}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for deleting nonexistent agent", async () => {
      const app = createServer();
      const res = await app.request("/v1/agents/agent-ghost", {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });
});
