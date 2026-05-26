import { MetricsCollector, setDefaultMetrics } from "@aizonaai/adk";
import { describe, expect, it } from "vitest";
import { createServer } from "../server";

describe("health routes", () => {
  describe("GET /health", () => {
    it("returns status ok with version and timestamp", async () => {
      const app = createServer();
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ok");
      expect(body.version).toBe("0.1.0");
      expect(body.timestamp).toBeDefined();
      expect(() => new Date(body.timestamp)).not.toThrow();
    });

    it("returns health even without authentication configured", async () => {
      const app = createServer();
      const res = await app.request("/health");
      expect(res.status).toBe(200);
    });

    it("returns health when auth is required for other routes", async () => {
      const app = createServer({
        validateApiKey: async () => null,
      });

      const healthRes = await app.request("/health");
      expect(healthRes.status).toBe(200);

      const agentsRes = await app.request("/v1/agents");
      expect(agentsRes.status).toBe(401);
    });
  });

  describe("GET /health/readiness", () => {
    it("returns 200 ready with no probes", async () => {
      const app = createServer();
      const res = await app.request("/health/readiness");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ready");
      expect(body.checks).toEqual([]);
    });

    it("returns 200 when all probes pass", async () => {
      const app = createServer({
        readinessProbes: [
          async () => ({ name: "provider", ok: true }),
          async () => ({ name: "storage", ok: true }),
        ],
      });
      const res = await app.request("/health/readiness");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("ready");
      expect(body.checks).toHaveLength(2);
      expect(body.checks[0].name).toBe("provider");
    });

    it("returns 503 when any probe fails", async () => {
      const app = createServer({
        readinessProbes: [
          async () => ({ name: "provider", ok: true }),
          async () => ({ name: "storage", ok: false, message: "db unreachable" }),
        ],
      });
      const res = await app.request("/health/readiness");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("not_ready");
      expect(body.checks[1].ok).toBe(false);
      expect(body.checks[1].message).toBe("db unreachable");
    });

    it("treats a thrown probe as not ready", async () => {
      const app = createServer({
        readinessProbes: [
          async () => {
            throw new Error("boom");
          },
        ],
      });
      const res = await app.request("/health/readiness");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.checks[0].ok).toBe(false);
    });
  });

  describe("GET /health/metrics", () => {
    it("exposes Prometheus exposition format", async () => {
      const m = new MetricsCollector();
      m.incrementCounter("adk_runs_total", { status: "completed" }, 3);
      m.setGauge("adk_runs_active", 1);
      const app = createServer({ metrics: m });

      const res = await app.request("/health/metrics");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/plain");
      const text = await res.text();
      expect(text).toContain("# TYPE adk_runs_total counter");
      expect(text).toContain('adk_runs_total{status="completed"} 3');
      expect(text).toContain("adk_runs_active 1");
    });

    it("falls back to the process-wide collector when none is configured", async () => {
      const m = new MetricsCollector();
      setDefaultMetrics(m);
      m.incrementCounter("adk_runs_total", { agent: "alice" }, 7);

      const app = createServer();
      const res = await app.request("/health/metrics");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('adk_runs_total{agent="alice"} 7');
    });
  });
});
