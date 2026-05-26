// ──────────────────────────────────────────────────────
// ADK Tracing — Span
// ──────────────────────────────────────────────────────

export type SpanType = "agent" | "llm" | "tool" | "guardrail" | "handoff" | "session" | "pipeline";

export interface SpanEvent {
  name: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export interface SpanData {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  type: SpanType;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
  status: "ok" | "error";
  error?: string;
}

let spanCounter = 0;

export class Span {
  readonly id: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly type: SpanType;
  readonly startTime: number;
  private _endTime?: number;
  private _attributes: Record<string, unknown> = {};
  private _events: SpanEvent[] = [];
  private _status: "ok" | "error" = "ok";
  private _error?: string;

  constructor(traceId: string, name: string, type: SpanType, parentSpanId?: string) {
    this.id = `span-${++spanCounter}-${Date.now()}`;
    this.traceId = traceId;
    this.parentSpanId = parentSpanId;
    this.name = name;
    this.type = type;
    this.startTime = Date.now();
  }

  setAttributes(attrs: Record<string, unknown>): void {
    Object.assign(this._attributes, attrs);
  }

  setAttribute(key: string, value: unknown): void {
    this._attributes[key] = value;
  }

  addEvent(name: string, data?: Record<string, unknown>): void {
    this._events.push({ name, timestamp: Date.now(), data });
  }

  setError(error: string): void {
    this._status = "error";
    this._error = error;
  }

  end(): void {
    this._endTime = Date.now();
  }

  get durationMs(): number | undefined {
    return this._endTime ? this._endTime - this.startTime : undefined;
  }

  toJSON(): SpanData {
    return {
      id: this.id,
      traceId: this.traceId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      type: this.type,
      startTime: this.startTime,
      endTime: this._endTime,
      durationMs: this.durationMs,
      attributes: { ...this._attributes },
      events: [...this._events],
      status: this._status,
      error: this._error,
    };
  }
}
