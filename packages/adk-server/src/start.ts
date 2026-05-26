// ──────────────────────────────────────────────────────
// ADK Server — Entry Point
// Usage: npx tsx packages/adk-server/src/start.ts
// ──────────────────────────────────────────────────────

import { startStandaloneServer } from "./standalone";

const port = Number(process.env.ADK_PORT ?? 3456);
const handle = startStandaloneServer({ port });

// Graceful shutdown
process.on("SIGINT", () => {
  handle.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  handle.close();
  process.exit(0);
});
