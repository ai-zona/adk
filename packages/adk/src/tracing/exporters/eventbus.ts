// ──────────────────────────────────────────────────────
// ADK Tracing — EventBus Exporter
// ──────────────────────────────────────────────────────

import type { ADKEventBus } from "../../events/event-bus";
import type { TraceData, TraceExporter } from "../tracer";

export class EventBusExporter implements TraceExporter {
  constructor(private eventBus: ADKEventBus) {}

  async export(trace: TraceData): Promise<void> {
    // Emit as agent.log events for platform observability
    this.eventBus.emit("agent.log", {
      agentSlug: (trace.metadata.agentName as string) ?? "adk",
      level: "info",
      message: `Trace completed: ${trace.name} (${trace.spans.length} spans, ${trace.durationMs}ms)`,
      metadata: {
        traceId: trace.id,
        spans: trace.spans.length,
        durationMs: trace.durationMs,
      },
      timestamp: Date.now(),
    });
  }
}
