// ──────────────────────────────────────────────────────
// ADK Tracing — Langfuse Exporter (placeholder)
// ──────────────────────────────────────────────────────
// Sends traces to Langfuse for observability
// Requires langfuse SDK to be installed by the user

import type { TraceData, TraceExporter } from "../tracer";

export interface LangfuseConfig {
  publicKey: string;
  secretKey: string;
  baseUrl?: string;
}

export class LangfuseExporter implements TraceExporter {
  private config: LangfuseConfig;

  constructor(config: LangfuseConfig) {
    this.config = config;
  }

  async export(trace: TraceData): Promise<void> {
    // POST to Langfuse API
    const url = `${this.config.baseUrl ?? "https://cloud.langfuse.com"}/api/public/ingestion`;

    const events = trace.spans.map((span) => ({
      type: span.type === "llm" ? "generation" : "span",
      body: {
        traceId: trace.id,
        id: span.id,
        parentObservationId: span.parentSpanId,
        name: span.name,
        startTime: new Date(span.startTime).toISOString(),
        endTime: span.endTime ? new Date(span.endTime).toISOString() : undefined,
        metadata: span.attributes,
        level: span.status === "error" ? "ERROR" : "DEFAULT",
        statusMessage: span.error,
      },
    }));

    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${this.config.publicKey}:${this.config.secretKey}`)}`,
        },
        body: JSON.stringify({ batch: events }),
      });
    } catch {
      // Non-critical — don't break the application
    }
  }
}
