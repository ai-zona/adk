import { Hono } from "hono";

export function healthRoutes(): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    c.json({
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    }),
  );

  return app;
}
