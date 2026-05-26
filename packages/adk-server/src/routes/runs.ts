// ──────────────────────────────────────────────────────
// Run routes
// ──────────────────────────────────────────────────────

import { Hono } from "hono";
import type { ServerConfig } from "../server";
import type { RunStore } from "../storage/types";

export function runRoutes(config: ServerConfig, store: RunStore): Hono {
  const app = new Hono();

  // Start a run
  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { agentId, input, maxTurns, sessionId } = body;

      if (!input) {
        return c.json({ error: "input is required" }, 400);
      }

      const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const run = {
        id,
        agentId: agentId ?? "default",
        status: "completed",
        result: {
          output: `Processed: ${input}`,
          usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
        },
        createdAt: new Date().toISOString(),
      };

      await store.create(run);

      return c.json(run, 201);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  // Get run result
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const run = await store.get(id);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json(run);
  });

  return app;
}
