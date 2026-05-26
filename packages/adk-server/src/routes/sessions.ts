// ──────────────────────────────────────────────────────
// Session routes
// ──────────────────────────────────────────────────────

import type { SessionBackend } from "@aizonaai/adk";
import { Hono } from "hono";

export function sessionRoutes(backend: SessionBackend): Hono {
  const app = new Hono();

  // Create session
  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const session = await backend.create({
        agentName: body.agentName ?? "default",
        metadata: body.metadata,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
      });
      return c.json(session, 201);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  // Get session
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const session = await backend.get(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(session);
  });

  // Resume session
  app.post("/:id/resume", async (c) => {
    const id = c.req.param("id");
    const session = await backend.get(id);
    if (!session) {
      return c.json({ error: "Session not found" }, 404);
    }

    try {
      const body = await c.req.json();
      if (body.messages) {
        await backend.appendMessages(id, body.messages);
      }
      const updated = await backend.get(id);
      return c.json(updated);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  // Fork session
  app.post("/:id/fork", async (c) => {
    const id = c.req.param("id");
    try {
      const forked = await backend.fork(id);
      return c.json(forked, 201);
    } catch {
      return c.json({ error: "Session not found or fork failed" }, 404);
    }
  });

  return app;
}
