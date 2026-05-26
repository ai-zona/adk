import { type MetricsCollector, getDefaultMetrics } from "@aizonaai/adk";
import { Hono } from "hono";

/** Result of a single readiness probe. */
export interface ReadinessCheck {
  name: string;
  ok: boolean;
  message?: string;
  durationMs?: number;
}

/** Async check function — should return ok=false to mark service not-ready. */
export type ReadinessProbe = () => Promise<ReadinessCheck> | ReadinessCheck;

export interface HealthRoutesConfig {
  /** Pluggable readiness probes (provider/storage health, etc.). */
  readinessProbes?: ReadinessProbe[];
  /** Metrics collector to scrape (defaults to process-wide collector). */
  metrics?: MetricsCollector;
}

/**
 * Mounts:
 *   GET /          — liveness, always 200 (k8s liveness probe)
 *   GET /readiness — runs all readiness probes, 200 if all ok, else 503
 *   GET /metrics   — Prometheus text exposition format
 */
export function healthRoutes(config: HealthRoutesConfig = {}): Hono {
  const app = new Hono();
  const metrics = config.metrics ?? getDefaultMetrics();

  app.get("/", (c) =>
    c.json({
      status: "ok",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    }),
  );

  app.get("/readiness", async (c) => {
    const probes = config.readinessProbes ?? [];
    const checks: ReadinessCheck[] = [];
    for (const probe of probes) {
      const start = Date.now();
      try {
        const result = await probe();
        checks.push({ ...result, durationMs: Date.now() - start });
      } catch (err) {
        checks.push({
          name: "unknown",
          ok: false,
          message: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - start,
        });
      }
    }
    const ready = checks.every((c) => c.ok);
    return c.json(
      {
        status: ready ? "ready" : "not_ready",
        checks,
        timestamp: new Date().toISOString(),
      },
      ready ? 200 : 503,
    );
  });

  app.get("/metrics", (c) => {
    return c.text(metrics.toPrometheus(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    });
  });

  return app;
}
