import { describe, expect, it } from "vitest";
import { type IpcMessage, ipcMessageSchema } from "../protocol";

describe("ipcMessageSchema", () => {
  it("accepts a valid execute message", () => {
    const msg: IpcMessage = {
      kind: "execute",
      requestId: "req_1",
      workspaceId: "ws_abc12345abcdef123456",
      skillRef: "manuscript-ingest",
      input: { manuscriptId: "ms_1" },
      caps: { memoryLimitMb: 128, cpuLimitMs: 5000 },
    };
    expect(ipcMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("accepts a valid result message", () => {
    const msg: IpcMessage = {
      kind: "result",
      requestId: "req_1",
      ok: true,
      output: { chapters: 12, words: 80000 },
      durationMs: 240,
    };
    expect(ipcMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("accepts a valid error message", () => {
    const msg: IpcMessage = {
      kind: "result",
      requestId: "req_1",
      ok: false,
      errorMessage: "OOM",
      errorKind: "MEMORY_EXCEEDED",
    };
    expect(ipcMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("accepts a valid hostFnCall message", () => {
    const msg: IpcMessage = {
      kind: "hostFnCall",
      requestId: "req_1",
      callId: "call_1",
      hostFn: "kb.read",
      args: { kbId: "kb_1", query: "scifi" },
    };
    expect(ipcMessageSchema.safeParse(msg).success).toBe(true);
  });

  it("rejects execute with no skillRef", () => {
    const bad = {
      kind: "execute",
      requestId: "x",
      workspaceId: "y",
      input: {},
      caps: { memoryLimitMb: 128, cpuLimitMs: 5000 },
    };
    expect(ipcMessageSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown hostFn", () => {
    const bad = { kind: "hostFnCall", requestId: "x", callId: "y", hostFn: "fs.unlink", args: {} };
    expect(ipcMessageSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects negative durationMs in result", () => {
    const bad = { kind: "result", requestId: "x", ok: true, output: {}, durationMs: -1 };
    expect(ipcMessageSchema.safeParse(bad).success).toBe(false);
  });
});
