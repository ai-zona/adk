/**
 * 06 — Production Server
 *
 * A production-shaped HTTP server built on @aizonaai/adk-server:
 *   • Hono app with API-key authentication
 *   • Per-key rate limiting (60 rpm)
 *   • CORS allow-list
 *   • Usage tracking callback (cost, tokens, latency)
 *   • Structured JSON logging with redaction
 *   • Graceful SIGTERM shutdown
 *
 * For a real deployment, replace the in-memory validateApiKey + onUsage with
 * your database. The shape of the data shown here is exactly what the server
 * emits — see docs/security.md and docs/deployment.md for the hardening matrix.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... NODE_ENV=production pnpm start
 *
 * Then:
 *   curl -H "Authorization: Bearer sk_live_demo" \
 *        -H "Content-Type: application/json" \
 *        -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"hi"}]}' \
 *        http://localhost:3456/v1/chat/completions
 */

import { serve } from "@hono/node-server";
import { createProvider, hashApiKey, redact } from "@aizonaai/adk";
import {
  createServer,
  type ApiKeyRecord,
  type UsageRecord,
} from "@aizonaai/adk-server";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY environment variable.");
  process.exit(1);
}

const port = Number(process.env.ADK_PORT ?? 3456);

// ── Demo key store (replace with your DB in production) ─────────────────
// Hash the demo key once at boot so we never compare plaintext.
const demoKeyHash = await hashApiKey("sk_live_demo");

const keyTable = new Map<string, ApiKeyRecord>([
  [
    demoKeyHash,
    {
      id: "key_demo",
      keyHash: demoKeyHash,
      type: "live",
      permissions: ["*"],
      active: true,
      ownerId: "user_demo",
    },
  ],
]);

const validateApiKey = async (hash: string): Promise<ApiKeyRecord | null> => {
  const record = keyTable.get(hash) ?? null;
  if (!record?.active) return null;
  if (record.expiresAt && record.expiresAt < new Date()) return null;
  return record;
};

// ── Usage sink (replace with your warehouse / metrics pipe) ─────────────
const onUsage = async (record: UsageRecord): Promise<void> => {
  // In production: insert into Postgres, ship to BigQuery, increment a Prom counter, etc.
  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event: "usage",
      ...record,
    }),
  );
};

// ── Build the app ───────────────────────────────────────────────────────
const app = createServer({
  defaultProvider: createProvider({
    providerId: "anthropic",
    apiKey,
  }),
  validateApiKey,
  rateLimitRpm: Number(process.env.ADK_RATE_LIMIT_RPM ?? 60),
  corsOrigins: (process.env.ADK_CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  onUsage,
});

// ── Listen with graceful shutdown ───────────────────────────────────────
const handle = serve({ fetch: app.fetch, port }, ({ port: bound }) => {
  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event: "server.listening",
      port: bound,
      nodeEnv: process.env.NODE_ENV ?? "development",
      demoKey: redact("sk_live_demo"), // demonstrate the redact helper
    }),
  );
});

const shutdown = (signal: string) => {
  console.log(
    JSON.stringify({
      level: "info",
      ts: new Date().toISOString(),
      event: "server.shutdown",
      signal,
    }),
  );
  handle.close(() => process.exit(0));
  // Force-exit after 25 s if connections won't drain
  setTimeout(() => process.exit(1), 25_000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
