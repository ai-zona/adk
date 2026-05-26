// ──────────────────────────────────────────────────────
// ADK Tracing — Console Exporter
// ──────────────────────────────────────────────────────

import type { TraceData, TraceExporter } from "../tracer";

export class ConsoleExporter implements TraceExporter {
  async export(trace: TraceData): Promise<void> {
    console.log(`[ADK Trace] ${trace.name} (${trace.id})`);
    console.log(`  Duration: ${trace.durationMs ?? "?"}ms`);
    console.log(`  Spans: ${trace.spans.length}`);
    for (const span of trace.spans) {
      const status = span.status === "error" ? " [ERROR]" : "";
      console.log(`    [${span.type}] ${span.name}: ${span.durationMs ?? "?"}ms${status}`);
    }
  }
}
