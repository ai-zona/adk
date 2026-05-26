import { describe, expect, it } from "vitest";
import type { StreamEvent } from "../types/runner";
import { createAsyncEventStream } from "./async-generator";
import { encodeSSE } from "./sse-encoder";

describe("createAsyncEventStream", () => {
  it("pushes and receives events", async () => {
    const { push, close, stream } = createAsyncEventStream();
    const events: StreamEvent[] = [];

    push({ type: "text_delta", content: "Hello", agentName: "bot" });
    push({ type: "text_delta", content: " World", agentName: "bot" });
    close();

    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("text_delta");
  });

  it("handles close before read", async () => {
    const { close, stream } = createAsyncEventStream();
    close();

    const events: StreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events).toHaveLength(0);
  });

  it("propagates errors", async () => {
    const { error, stream } = createAsyncEventStream();
    error(new Error("Stream broke"));

    await expect(async () => {
      for await (const _ of stream) {
        // Should throw
      }
    }).rejects.toThrow("Stream broke");
  });
});

describe("encodeSSE", () => {
  it("encodes a StreamEvent as SSE", () => {
    const event: StreamEvent = { type: "text_delta", content: "Hi", agentName: "bot" };
    const encoded = encodeSSE(event);
    expect(encoded).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("handles complex events", () => {
    const event: StreamEvent = {
      type: "tool_call_start",
      toolName: "search",
      agentName: "agent",
      input: { query: "test" },
    };
    const encoded = encodeSSE(event);
    expect(encoded).toContain('"type":"tool_call_start"');
    expect(encoded.endsWith("\n\n")).toBe(true);
  });
});
