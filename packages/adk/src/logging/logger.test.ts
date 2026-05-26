import { describe, expect, it } from "vitest";
import { Logger, MemoryTransport } from "./logger";

describe("Logger", () => {
  it("writes records at or above the configured level", () => {
    const transport = new MemoryTransport();
    const log = new Logger({ level: "warn", transport });

    log.debug("hidden");
    log.info("hidden");
    log.warn("visible");
    log.error("visible");

    expect(transport.records.map((r) => r.level)).toEqual(["warn", "error"]);
  });

  it("merges base context with per-call context", () => {
    const transport = new MemoryTransport();
    const log = new Logger({
      level: "debug",
      transport,
      context: { runId: "r1", agentName: "alice" },
    });

    log.info("turn started", { turnNumber: 3 });

    expect(transport.records[0]?.context).toEqual({
      runId: "r1",
      agentName: "alice",
      turnNumber: 3,
    });
  });

  it("child() creates an extended logger without mutating the parent", () => {
    const transport = new MemoryTransport();
    const parent = new Logger({ level: "debug", transport, context: { runId: "r1" } });
    const child = parent.child({ agentName: "bob" });

    parent.info("parent");
    child.info("child");

    expect(transport.records[0]?.context).toEqual({ runId: "r1" });
    expect(transport.records[1]?.context).toEqual({ runId: "r1", agentName: "bob" });
  });

  it("captures Error objects on error()", () => {
    const transport = new MemoryTransport();
    const log = new Logger({ level: "debug", transport });
    const err = new Error("boom");

    log.error("something failed", err, { runId: "r1" });

    const record = transport.records[0];
    expect(record?.error?.name).toBe("Error");
    expect(record?.error?.message).toBe("boom");
    expect(record?.context.runId).toBe("r1");
  });

  it("treats a plain object passed as second arg as extra context", () => {
    const transport = new MemoryTransport();
    const log = new Logger({ level: "debug", transport });

    log.error("oops", { provider: "openai" });

    expect(transport.records[0]?.context.provider).toBe("openai");
    expect(transport.records[0]?.error).toBeUndefined();
  });

  it("emits valid ISO timestamps", () => {
    const transport = new MemoryTransport();
    const log = new Logger({ level: "debug", transport });
    log.info("hello");
    expect(() => new Date(transport.records[0]!.timestamp)).not.toThrow();
  });
});
