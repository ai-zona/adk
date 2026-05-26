import { describe, expect, it, vi } from "vitest";
import { ADKEventBus } from "./event-bus";

describe("ADKEventBus", () => {
  it("emits and receives events", () => {
    const bus = new ADKEventBus();
    const handler = vi.fn();

    bus.on("run.started", handler);
    bus.emit("run.started", {
      runId: "run-1",
      agentName: "test",
      traceId: "trace-1",
      timestamp: Date.now(),
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", agentName: "test" }),
    );
  });

  it("unsubscribes via returned function", () => {
    const bus = new ADKEventBus();
    const handler = vi.fn();

    const unsubscribe = bus.on("run.started", handler);
    unsubscribe();

    bus.emit("run.started", {
      runId: "run-1",
      agentName: "test",
      traceId: "trace-1",
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("once() fires only once", () => {
    const bus = new ADKEventBus();
    const handler = vi.fn();

    bus.once("run.completed", handler);

    const event = {
      runId: "run-1",
      agentName: "test",
      totalTurns: 1,
      totalCostUsd: 0,
      totalLatencyMs: 100,
      traceId: "trace-1",
      timestamp: Date.now(),
    };

    bus.emit("run.completed", event);
    bus.emit("run.completed", event);

    expect(handler).toHaveBeenCalledOnce();
  });

  it("off() removes a specific listener", () => {
    const bus = new ADKEventBus();
    const handler = vi.fn();

    bus.on("handoff", handler);
    bus.off("handoff", handler);

    bus.emit("handoff", {
      runId: "run-1",
      fromAgent: "a",
      toAgent: "b",
      reason: "test",
      turnNumber: 1,
      timestamp: Date.now(),
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("supports multiple listeners for the same event", () => {
    const bus = new ADKEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus.on("run.started", handler1);
    bus.on("run.started", handler2);

    bus.emit("run.started", {
      runId: "run-1",
      agentName: "test",
      traceId: "trace-1",
      timestamp: Date.now(),
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("isolates different event types", () => {
    const bus = new ADKEventBus();
    const startHandler = vi.fn();
    const completeHandler = vi.fn();

    bus.on("run.started", startHandler);
    bus.on("run.completed", completeHandler);

    bus.emit("run.started", {
      runId: "run-1",
      agentName: "test",
      traceId: "trace-1",
      timestamp: Date.now(),
    });

    expect(startHandler).toHaveBeenCalledOnce();
    expect(completeHandler).not.toHaveBeenCalled();
  });

  it("listenerCount() returns correct count", () => {
    const bus = new ADKEventBus();

    expect(bus.listenerCount("run.started")).toBe(0);

    bus.on("run.started", () => {});
    bus.on("run.started", () => {});

    expect(bus.listenerCount("run.started")).toBe(2);
  });

  it("activeEvents() returns events with listeners", () => {
    const bus = new ADKEventBus();

    bus.on("run.started", () => {});
    bus.on("handoff", () => {});

    const active = bus.activeEvents();
    expect(active).toContain("run.started");
    expect(active).toContain("handoff");
    expect(active).toHaveLength(2);
  });

  it("removeAllListeners() clears everything", () => {
    const bus = new ADKEventBus();
    const handler = vi.fn();

    bus.on("run.started", handler);
    bus.on("run.completed", handler);
    bus.removeAllListeners();

    expect(bus.activeEvents()).toHaveLength(0);
  });

  it("listener errors don't break other listeners", () => {
    const bus = new ADKEventBus();
    const badHandler = vi.fn(() => {
      throw new Error("boom");
    });
    const goodHandler = vi.fn();

    bus.on("run.started", badHandler);
    bus.on("run.started", goodHandler);

    bus.emit("run.started", {
      runId: "run-1",
      agentName: "test",
      traceId: "trace-1",
      timestamp: Date.now(),
    });

    expect(badHandler).toHaveBeenCalledOnce();
    expect(goodHandler).toHaveBeenCalledOnce();
  });

  it("each instance is isolated (not a singleton)", () => {
    const bus1 = new ADKEventBus();
    const bus2 = new ADKEventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    bus1.on("run.started", handler1);
    bus2.on("run.started", handler2);

    bus1.emit("run.started", {
      runId: "run-1",
      agentName: "test",
      traceId: "trace-1",
      timestamp: Date.now(),
    });

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).not.toHaveBeenCalled();
  });
});
