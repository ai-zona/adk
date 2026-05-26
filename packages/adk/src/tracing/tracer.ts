// ──────────────────────────────────────────────────────
// ADK Tracing — Tracer + Trace
// ──────────────────────────────────────────────────────

import { Span, type SpanData, type SpanType } from "./span";

export interface TraceData {
  id: string;
  name: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  spans: SpanData[];
  metadata: Record<string, unknown>;
}

export interface TraceExporter {
  export(trace: TraceData): Promise<void>;
}

let traceCounter = 0;

export class Trace {
  readonly id: string;
  readonly name: string;
  readonly startTime: number;
  private _endTime?: number;
  private _spans: Span[] = [];
  private _metadata: Record<string, unknown> = {};

  constructor(name: string, metadata?: Record<string, unknown>) {
    this.id = `trace-${++traceCounter}-${Date.now()}`;
    this.name = name;
    this.startTime = Date.now();
    if (metadata) this._metadata = { ...metadata };
  }

  startSpan(name: string, type: SpanType, parentSpanId?: string): Span {
    const span = new Span(this.id, name, type, parentSpanId);
    this._spans.push(span);
    return span;
  }

  setMetadata(key: string, value: unknown): void {
    this._metadata[key] = value;
  }

  end(): void {
    this._endTime = Date.now();
    // End any unclosed spans
    for (const span of this._spans) {
      if (!span.durationMs) span.end();
    }
  }

  get durationMs(): number | undefined {
    return this._endTime ? this._endTime - this.startTime : undefined;
  }

  get spans(): Span[] {
    return [...this._spans];
  }

  toJSON(): TraceData {
    return {
      id: this.id,
      name: this.name,
      startTime: this.startTime,
      endTime: this._endTime,
      durationMs: this.durationMs,
      spans: this._spans.map((s) => s.toJSON()),
      metadata: { ...this._metadata },
    };
  }
}

export class Tracer {
  private exporters: TraceExporter[] = [];
  private traces: Trace[] = [];

  addExporter(exporter: TraceExporter): void {
    this.exporters.push(exporter);
  }

  startTrace(name: string, metadata?: Record<string, unknown>): Trace {
    const trace = new Trace(name, metadata);
    this.traces.push(trace);
    return trace;
  }

  async endAndExport(trace: Trace): Promise<void> {
    trace.end();
    const data = trace.toJSON();
    await Promise.all(this.exporters.map((e) => e.export(data)));
  }

  getTraces(): Trace[] {
    return [...this.traces];
  }
}
