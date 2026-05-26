// ──────────────────────────────────────────────────────
// ADK Hono Server
// ──────────────────────────────────────────────────────

import type { ADKLLMProvider, MetricsCollector, ProxyRouter } from "@aizonaai/adk";
import { Hono } from "hono";
import { apiKeyAuth } from "./middleware/api-key-auth";
import { corsMiddleware } from "./middleware/cors";
import { rateLimiter } from "./middleware/rate-limiter";
import { usageTracker } from "./middleware/usage-tracker";
import { agentRoutes } from "./routes/agents";
import { chatRoutes } from "./routes/chat";
import { healthRoutes, type ReadinessProbe } from "./routes/health";
import { keyRoutes } from "./routes/keys";
import { runRoutes } from "./routes/runs";
import { sessionRoutes } from "./routes/sessions";
import { toolRoutes } from "./routes/tools";
import { createMemoryStorage } from "./storage/memory-storage";
import type { StorageBackend } from "./storage/types";

/** Server configuration */
export interface ServerConfig {
  /** Proxy router for API key → provider resolution */
  proxyRouter?: ProxyRouter;
  /** Default LLM provider */
  defaultProvider?: ADKLLMProvider;
  /** API key validation function */
  validateApiKey?: (keyHash: string) => Promise<ApiKeyRecord | null>;
  /** Rate limit: requests per minute */
  rateLimitRpm?: number;
  /** CORS allowed origins */
  corsOrigins?: string[];
  /** Usage tracking callback */
  onUsage?: (record: UsageRecord) => Promise<void>;
  /** Base path prefix (default: "") */
  basePath?: string;
  /** Storage backend (default: in-memory) */
  storage?: StorageBackend;
  /** Readiness probes for /readiness (provider + storage health). */
  readinessProbes?: ReadinessProbe[];
  /** Metrics collector exposed at /metrics (defaults to process-wide). */
  metrics?: MetricsCollector;
}

/** API key record from storage */
export interface ApiKeyRecord {
  id: string;
  keyHash: string;
  type: "live" | "test";
  permissions: string[];
  active: boolean;
  ownerId: string;
  expiresAt?: Date;
}

/** Usage record for tracking */
export interface UsageRecord {
  apiKeyId: string;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  endpoint: string;
  statusCode: number;
  latencyMs: number;
  agentName?: string;
  sessionId?: string;
  runId?: string;
}

/** Create a configured Hono server */
export function createServer(config: ServerConfig = {}): Hono {
  // In production, require API key validation — do not silently skip auth
  if (process.env.NODE_ENV === "production" && !config.validateApiKey) {
    throw new Error(
      "ADK server requires a validateApiKey function in production. " +
        "Provide one via ServerConfig.validateApiKey to enable API key authentication.",
    );
  }

  const app = new Hono();
  const storage = config.storage ?? createMemoryStorage();
  const prefix = config.basePath ?? "";

  // Security headers for all responses
  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    if (process.env.NODE_ENV === "production") {
      c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
    }
  });

  // Global middleware
  app.use("*", corsMiddleware(config.corsOrigins));

  // Health check (no auth) — mounted at basePath so /api/adk/health works in Next.js mode.
  // Also exposes /health/readiness (provider+storage) and /health/metrics (Prometheus).
  app.route(
    `${prefix}/health`,
    healthRoutes({
      readinessProbes: config.readinessProbes,
      metrics: config.metrics,
    }),
  );

  // API routes (with auth)
  const api = new Hono();

  if (config.validateApiKey) {
    api.use("*", apiKeyAuth(config.validateApiKey));
  }
  if (config.rateLimitRpm) {
    api.use("*", rateLimiter(config.rateLimitRpm));
  }
  if (config.onUsage) {
    api.use("*", usageTracker(config.onUsage));
  }

  // Mount routes with injected stores
  api.route("/chat", chatRoutes(config));
  api.route("/agents", agentRoutes(storage.agents));
  api.route("/runs", runRoutes(config, storage.runs));
  api.route("/sessions", sessionRoutes(storage.sessions));
  api.route("/tools", toolRoutes());
  api.route("/keys", keyRoutes(storage.keys));

  // OpenAPI spec
  api.get("/openapi.json", (c) =>
    c.json({
      openapi: "3.1.0",
      info: {
        title: "AIZona ADK API",
        version: "0.1.0",
        description: "AI Agent Development Kit REST API",
      },
      paths: {
        "/v1/chat/completions": { post: { summary: "OpenAI-compatible chat completions proxy" } },
        "/v1/agents": { get: { summary: "List agents" }, post: { summary: "Register agent" } },
        "/v1/agents/{id}": {
          get: { summary: "Get agent" },
          put: { summary: "Update agent" },
          delete: { summary: "Delete agent" },
        },
        "/v1/agents/{id}/runs": { post: { summary: "Start a run" } },
        "/v1/runs/{id}": { get: { summary: "Get run result" } },
        "/v1/sessions": { post: { summary: "Create session" } },
        "/v1/sessions/{id}": { get: { summary: "Get session" } },
        "/v1/sessions/{id}/resume": { post: { summary: "Resume session" } },
        "/v1/sessions/{id}/fork": { post: { summary: "Fork session" } },
        "/v1/tools": { get: { summary: "List tools" } },
        "/v1/keys": { get: { summary: "List API keys" }, post: { summary: "Create API key" } },
        "/v1/keys/{id}": { delete: { summary: "Revoke key" } },
        "/v1/usage": { get: { summary: "Usage stats" } },
        "/health": { get: { summary: "Health check" } },
      },
    }),
  );

  // Mount API under /v1
  app.route(`${prefix}/v1`, api);

  return app;
}
