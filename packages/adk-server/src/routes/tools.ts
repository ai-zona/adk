// ──────────────────────────────────────────────────────
// Tool listing routes
// ──────────────────────────────────────────────────────

import { Hono } from "hono";

export function toolRoutes(): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      tools: [],
      total: 0,
      message: "Register tools via the SDK to see them here",
    });
  });

  return app;
}
