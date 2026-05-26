// ──────────────────────────────────────────────────────
// Agent CRUD routes
// ──────────────────────────────────────────────────────

import { Hono } from "hono";
import type { AgentStore } from "../storage/types";

export function agentRoutes(store: AgentStore): Hono {
  const app = new Hono();

  // List agents
  app.get("/", async (c) => {
    const agents = await store.list();
    return c.json({ agents, total: agents.length });
  });

  // Register agent
  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { name, config, version, metadata } = body;

      if (!name) {
        return c.json({ error: "name is required" }, 400);
      }

      const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const agent = {
        id,
        name,
        config: config ?? {},
        version: version ?? "1.0.0",
        metadata: metadata ?? {},
        createdAt: new Date().toISOString(),
      };

      await store.create(agent);
      return c.json(agent, 201);
    } catch (error) {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  // Get agent
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const agent = await store.get(id);
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json(agent);
  });

  // Update agent
  app.put("/:id", async (c) => {
    const id = c.req.param("id");

    try {
      const body = await c.req.json();
      const updated = await store.update(id, body);
      if (!updated) {
        return c.json({ error: "Agent not found" }, 404);
      }
      return c.json(updated);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  // Delete agent
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const deleted = await store.delete(id);
    if (!deleted) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json({ deleted: true });
  });

  return app;
}
