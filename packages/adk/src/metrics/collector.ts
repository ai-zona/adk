// ──────────────────────────────────────────────────────
// ADK Metrics Collector
// ──────────────────────────────────────────────────────
// In-process metrics: counters, gauges, and histograms.
// Pull-based snapshot via getMetrics(); Prometheus export via toPrometheus().
// ──────────────────────────────────────────────────────

/** Default histogram buckets (turns_per_run scale). */
const DEFAULT_TURN_BUCKETS = [1, 2, 3, 5, 8, 13, 21, 50];
/** Default histogram buckets in milliseconds (tool call latency). */
const DEFAULT_DURATION_BUCKETS_MS = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000];

type LabelSet = Record<string, string>;

function labelKey(labels: LabelSet | undefined): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}=${labels[k]}`).join(",");
}

function promLabels(labels: LabelSet | undefined): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const parts = keys.map((k) => `${k}="${String(labels[k]).replace(/"/g, '\\"')}"`);
  return `{${parts.join(",")}}`;
}

interface CounterEntry {
  labels: LabelSet;
  value: number;
}
interface GaugeEntry {
  labels: LabelSet;
  value: number;
}
interface HistogramEntry {
  labels: LabelSet;
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

export interface MetricsSnapshot {
  counters: Record<string, CounterEntry[]>;
  gauges: Record<string, GaugeEntry[]>;
  histograms: Record<string, HistogramEntry[]>;
  timestamp: string;
}

export class MetricsCollector {
  private counters = new Map<string, Map<string, CounterEntry>>();
  private gauges = new Map<string, Map<string, GaugeEntry>>();
  private histograms = new Map<string, Map<string, HistogramEntry>>();

  /** Increment a counter (monotonically increasing). */
  incrementCounter(name: string, labels?: LabelSet, value = 1): void {
    const series = this.counters.get(name) ?? new Map<string, CounterEntry>();
    const key = labelKey(labels);
    const entry = series.get(key) ?? { labels: { ...(labels ?? {}) }, value: 0 };
    entry.value += value;
    series.set(key, entry);
    this.counters.set(name, series);
  }

  /** Set a gauge (can go up or down). */
  setGauge(name: string, value: number, labels?: LabelSet): void {
    const series = this.gauges.get(name) ?? new Map<string, GaugeEntry>();
    series.set(labelKey(labels), { labels: { ...(labels ?? {}) }, value });
    this.gauges.set(name, series);
  }

  /** Adjust a gauge by a delta. */
  adjustGauge(name: string, delta: number, labels?: LabelSet): void {
    const series = this.gauges.get(name) ?? new Map<string, GaugeEntry>();
    const key = labelKey(labels);
    const entry = series.get(key) ?? { labels: { ...(labels ?? {}) }, value: 0 };
    entry.value += delta;
    series.set(key, entry);
    this.gauges.set(name, series);
  }

  /** Observe a value into a histogram. */
  observeHistogram(name: string, value: number, labels?: LabelSet, buckets?: number[]): void {
    const series = this.histograms.get(name) ?? new Map<string, HistogramEntry>();
    const key = labelKey(labels);
    let entry = series.get(key);
    if (!entry) {
      const defaultBuckets = name.includes("duration") ? DEFAULT_DURATION_BUCKETS_MS : DEFAULT_TURN_BUCKETS;
      const bucketList = (buckets ?? defaultBuckets).slice().sort((a, b) => a - b);
      entry = {
        labels: { ...(labels ?? {}) },
        buckets: bucketList,
        counts: new Array(bucketList.length).fill(0),
        sum: 0,
        count: 0,
      };
    }
    for (let i = 0; i < entry.buckets.length; i++) {
      if (value <= entry.buckets[i]!) {
        entry.counts[i] = (entry.counts[i] ?? 0) + 1;
      }
    }
    entry.sum += value;
    entry.count += 1;
    series.set(key, entry);
    this.histograms.set(name, series);
  }

  /** Snapshot of all metrics for pull-based scraping. */
  getMetrics(): MetricsSnapshot {
    const counters: Record<string, CounterEntry[]> = {};
    for (const [name, series] of this.counters) counters[name] = [...series.values()];
    const gauges: Record<string, GaugeEntry[]> = {};
    for (const [name, series] of this.gauges) gauges[name] = [...series.values()];
    const histograms: Record<string, HistogramEntry[]> = {};
    for (const [name, series] of this.histograms) histograms[name] = [...series.values()];
    return { counters, gauges, histograms, timestamp: new Date().toISOString() };
  }

  /** Export in Prometheus text exposition format. */
  toPrometheus(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      lines.push(`# TYPE ${name} counter`);
      for (const entry of series.values()) {
        lines.push(`${name}${promLabels(entry.labels)} ${entry.value}`);
      }
    }
    for (const [name, series] of this.gauges) {
      lines.push(`# TYPE ${name} gauge`);
      for (const entry of series.values()) {
        lines.push(`${name}${promLabels(entry.labels)} ${entry.value}`);
      }
    }
    for (const [name, series] of this.histograms) {
      lines.push(`# TYPE ${name} histogram`);
      for (const entry of series.values()) {
        for (let i = 0; i < entry.buckets.length; i++) {
          const labels = { ...entry.labels, le: String(entry.buckets[i]) };
          lines.push(`${name}_bucket${promLabels(labels)} ${entry.counts[i]}`);
        }
        const inf = { ...entry.labels, le: "+Inf" };
        lines.push(`${name}_bucket${promLabels(inf)} ${entry.count}`);
        lines.push(`${name}_sum${promLabels(entry.labels)} ${entry.sum}`);
        lines.push(`${name}_count${promLabels(entry.labels)} ${entry.count}`);
      }
    }
    return lines.join("\n") + (lines.length ? "\n" : "");
  }

  /** Reset all metrics (mostly for tests). */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}

// Canonical metric names used by the Runner / TurnExecutor / GuardrailEngine.
export const METRIC_NAMES = {
  runsTotal: "adk_runs_total",
  runsActive: "adk_runs_active",
  turnsPerRun: "adk_turns_per_run",
  tokensUsed: "adk_tokens_used_total",
  toolCallsTotal: "adk_tool_calls_total",
  toolCallDurationMs: "adk_tool_call_duration_ms",
  guardrailTriggers: "adk_guardrail_triggers_total",
  errorsByType: "adk_errors_total",
} as const;

/** Process-wide default collector. */
let defaultCollector: MetricsCollector | undefined;
export function getDefaultMetrics(): MetricsCollector {
  if (!defaultCollector) defaultCollector = new MetricsCollector();
  return defaultCollector;
}
export function setDefaultMetrics(collector: MetricsCollector): void {
  defaultCollector = collector;
}
