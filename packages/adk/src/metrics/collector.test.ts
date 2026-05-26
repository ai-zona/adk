import { describe, expect, it } from "vitest";
import { MetricsCollector } from "./collector";

describe("MetricsCollector", () => {
  it("counts increments by labels", () => {
    const m = new MetricsCollector();
    m.incrementCounter("c", { provider: "openai" });
    m.incrementCounter("c", { provider: "openai" });
    m.incrementCounter("c", { provider: "anthropic" });

    const snap = m.getMetrics();
    const series = snap.counters.c;
    expect(series).toHaveLength(2);
    const openai = series?.find((e) => e.labels.provider === "openai");
    const anthropic = series?.find((e) => e.labels.provider === "anthropic");
    expect(openai?.value).toBe(2);
    expect(anthropic?.value).toBe(1);
  });

  it("setGauge and adjustGauge", () => {
    const m = new MetricsCollector();
    m.setGauge("active", 3);
    m.adjustGauge("active", -1);
    m.adjustGauge("active", 2);
    const series = m.getMetrics().gauges.active;
    expect(series?.[0]?.value).toBe(4);
  });

  it("observes histogram values into cumulative buckets", () => {
    const m = new MetricsCollector();
    m.observeHistogram("h", 0.5, undefined, [1, 5, 10]);
    m.observeHistogram("h", 3, undefined, [1, 5, 10]);
    m.observeHistogram("h", 12, undefined, [1, 5, 10]);

    const snap = m.getMetrics().histograms.h;
    const entry = snap?.[0];
    expect(entry?.count).toBe(3);
    expect(entry?.sum).toBe(15.5);
    // cumulative: <=1 → 1, <=5 → 2, <=10 → 2, >10 → only count
    expect(entry?.counts).toEqual([1, 2, 2]);
  });

  it("renders Prometheus output with TYPE, labels, and histogram +Inf bucket", () => {
    const m = new MetricsCollector();
    m.incrementCounter("adk_runs_total", { status: "success" }, 4);
    m.setGauge("adk_runs_active", 2);
    m.observeHistogram("adk_turns_per_run", 7, undefined, [1, 5, 10]);

    const text = m.toPrometheus();
    expect(text).toContain("# TYPE adk_runs_total counter");
    expect(text).toContain('adk_runs_total{status="success"} 4');
    expect(text).toContain("# TYPE adk_runs_active gauge");
    expect(text).toContain("adk_runs_active 2");
    expect(text).toContain("# TYPE adk_turns_per_run histogram");
    expect(text).toMatch(/adk_turns_per_run_bucket\{le="\+Inf"\} 1/);
    expect(text).toContain("adk_turns_per_run_sum 7");
    expect(text).toContain("adk_turns_per_run_count 1");
  });
});
