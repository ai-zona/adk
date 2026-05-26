import { describe, expect, it, vi } from "vitest";
import { ADKEventBus } from "../events/event-bus";
import { ConsoleExporter } from "./exporters/console";
import { EventBusExporter } from "./exporters/eventbus";
import { Span } from "./span";
import { Trace, Tracer } from "./tracer";

describe("Span", () => {
  it("creates with correct properties", () => {
    const span = new Span("trace-1", "llm-call", "llm");
    expect(span.traceId).toBe("trace-1");
    expect(span.name).toBe("llm-call");
    expect(span.type).toBe("llm");
    expect(span.startTime).toBeGreaterThan(0);
  });

  it("sets and reads attributes", () => {
    const span = new Span("t1", "s1", "tool");
    span.setAttributes({ model: "gpt-4o", tokens: 100 });
    span.setAttribute("cost", 0.01);

    const data = span.toJSON();
    expect(data.attributes.model).toBe("gpt-4o");
    expect(data.attributes.cost).toBe(0.01);
  });

  it("adds events", () => {
    const span = new Span("t1", "s1", "agent");
    span.addEvent("tool_called", { name: "search" });

    const data = span.toJSON();
    expect(data.events).toHaveLength(1);
    expect(data.events[0]?.name).toBe("tool_called");
  });

  it("calculates duration on end()", () => {
    const span = new Span("t1", "s1", "llm");
    expect(span.durationMs).toBeUndefined();

    span.end();
    expect(span.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records errors", () => {
    const span = new Span("t1", "s1", "tool");
    span.setError("Connection failed");
    span.end();

    const data = span.toJSON();
    expect(data.status).toBe("error");
    expect(data.error).toBe("Connection failed");
  });

  it("serializes to JSON", () => {
    const span = new Span("t1", "s1", "guardrail", "parent-1");
    span.end();

    const data = span.toJSON();
    expect(data.id).toContain("span-");
    expect(data.traceId).toBe("t1");
    expect(data.parentSpanId).toBe("parent-1");
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("Trace", () => {
  it("creates with correct properties", () => {
    const trace = new Trace("test-trace", { agent: "test" });
    expect(trace.name).toBe("test-trace");
    expect(trace.id).toContain("trace-");
  });

  it("creates spans", () => {
    const trace = new Trace("test");
    const span1 = trace.startSpan("llm-call", "llm");
    const span2 = trace.startSpan("tool-exec", "tool", span1.id);

    expect(trace.spans).toHaveLength(2);
    expect(span2.parentSpanId).toBe(span1.id);
  });

  it("end() closes all spans", () => {
    const trace = new Trace("test");
    trace.startSpan("s1", "agent");
    trace.startSpan("s2", "llm");

    trace.end();

    const data = trace.toJSON();
    expect(data.durationMs).toBeGreaterThanOrEqual(0);
    for (const span of data.spans) {
      expect(span.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("serializes to JSON", () => {
    const trace = new Trace("test", { runId: "r1" });
    trace.startSpan("s1", "agent");
    trace.end();

    const data = trace.toJSON();
    expect(data.name).toBe("test");
    expect(data.spans).toHaveLength(1);
    expect(data.metadata.runId).toBe("r1");
  });
});

describe("Tracer", () => {
  it("creates and tracks traces", () => {
    const tracer = new Tracer();
    tracer.startTrace("trace-1");
    tracer.startTrace("trace-2");

    expect(tracer.getTraces()).toHaveLength(2);
  });

  it("exports via console exporter", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const tracer = new Tracer();
    tracer.addExporter(new ConsoleExporter());

    const trace = tracer.startTrace("test-trace");
    trace.startSpan("s1", "llm");
    await tracer.endAndExport(trace);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("exports via eventbus exporter", async () => {
    const bus = new ADKEventBus();
    const handler = vi.fn();
    bus.on("agent.log", handler);

    const tracer = new Tracer();
    tracer.addExporter(new EventBusExporter(bus));

    const trace = tracer.startTrace("test", { agentName: "bot" });
    trace.startSpan("s1", "tool");
    await tracer.endAndExport(trace);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0].message).toContain("Trace completed");
  });

  it("supports multiple exporters", async () => {
    const exporter1 = { export: vi.fn().mockResolvedValue(undefined) };
    const exporter2 = { export: vi.fn().mockResolvedValue(undefined) };

    const tracer = new Tracer();
    tracer.addExporter(exporter1);
    tracer.addExporter(exporter2);

    const trace = tracer.startTrace("multi");
    await tracer.endAndExport(trace);

    expect(exporter1.export).toHaveBeenCalledOnce();
    expect(exporter2.export).toHaveBeenCalledOnce();
  });
});

describe("SpanType", () => {
  it("covers all expected types", () => {
    const trace = new Trace("test");
    const types = ["agent", "llm", "tool", "guardrail", "handoff", "session", "pipeline"] as const;

    for (const type of types) {
      const span = trace.startSpan(`test-${type}`, type);
      expect(span.type).toBe(type);
    }
  });
});
