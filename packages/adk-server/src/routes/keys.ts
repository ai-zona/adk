// ──────────────────────────────────────────────────────
// API Key management routes
// ──────────────────────────────────────────────────────

import { generateApiKey } from "@aizona/adk";
import { Hono } from "hono";
import type { KeyStore } from "../storage/types";

export function keyRoutes(store: KeyStore): Hono {
  const app = new Hono();

  // Create API key
  app.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const type: "live" | "test" = body.type === "test" ? "test" : "live";
      const { key, hash, prefix } = generateApiKey(type);

      const id = `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const record = {
        id,
        prefix,
        hash,
        name: body.name ?? "API Key",
        type,
        active: true,
        createdAt: new Date().toISOString(),
      };

      await store.create(record);

      // Return the full key only on creation
      return c.json({ ...record, key }, 201);
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });

  // List API keys (masked)
  app.get("/", async (c) => {
    const keys = await store.list();
    const masked = keys.map((k) => ({
      id: k.id,
      prefix: k.prefix,
      name: k.name,
      type: k.type,
      active: k.active,
      createdAt: k.createdAt,
    }));
    return c.json({ keys: masked, total: masked.length });
  });

  // Revoke key
  app.delete("/:id", async (c) => {
    const id = c.req.param("id");
    const revoked = await store.revoke(id);
    if (!revoked) {
      return c.json({ error: "Key not found" }, 404);
    }
    return c.json({ revoked: true });
  });

  return app;
}
