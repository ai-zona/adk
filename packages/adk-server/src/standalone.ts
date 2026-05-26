// ──────────────────────────────────────────────────────
// ADK Standalone Server — for `aizona dev` and standalone mode
// ──────────────────────────────────────────────────────

import { serve } from "@hono/node-server";
import { createServer } from "./server";
import type { ServerConfig } from "./server";

export interface StandaloneOptions extends ServerConfig {
  /** Port to listen on (default: 3456) */
  port?: number;
}

export interface StandaloneHandle {
  port: number;
  close: () => void;
}

/** Start a standalone ADK server on the given port */
export function startStandaloneServer(options: StandaloneOptions = {}): StandaloneHandle {
  const port = options.port ?? 3456;
  const app = createServer(options);

  const server = serve({
    fetch: app.fetch,
    port,
  });

  // Handle EADDRINUSE gracefully (port already taken by turbo dev sidecar)
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(
        `[adk-server] Port ${port} already in use — skipping (another instance is running)`,
      );
    } else {
      console.error("[adk-server] Server error:", err.message);
    }
  });

  console.log(`[adk-server] ADK server started on port ${port}`);
  console.log(`  API: http://localhost:${port}/v1`);
  console.log(`  Health: http://localhost:${port}/health`);
  console.log(`  OpenAPI: http://localhost:${port}/v1/openapi.json`);

  return {
    port,
    close: () => {
      server.close();
      console.log("[adk-server] ADK server stopped");
    },
  };
}
