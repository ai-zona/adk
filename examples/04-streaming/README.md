# 04 — Streaming

Stream agent output token-by-token. Renders text deltas, tool invocations, handoffs, and final usage stats inline.

## Run

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
pnpm start "What time is it? Then write a 4-line haiku about databases."
```

## What it shows

- `runner.stream(agent, { input })` — async generator of typed events.
- The five most useful event types: `turn_started`, `text_delta`, `tool_invoked`, `tool_result`, `run_complete`.
- ANSI colors to visually separate model text from tool I/O on a terminal.
- An `AbortSignal` wired in so a stuck stream cancels after 30 s.

## Wiring it into a server

Use `streamToSSE` from `@aizonaai/adk` to turn the same generator into an SSE response:

```typescript
import { streamToSSE } from "@aizonaai/adk";

app.post("/run", async (c) => {
  return streamToSSE(runner.stream(agent, { input: await c.req.text() }));
});
```

For WebSocket clients use `relayToWebSocket(socket, runner.stream(...))`.

## Backpressure

If your consumer is slow (e.g. a browser on a flaky connection) wrap the stream in `BackpressuredStream` so memory doesn't grow unbounded:

```typescript
import { BackpressuredStream } from "@aizonaai/adk";

const stream = new BackpressuredStream({ highWaterMark: 100, onDrop: "newest" });
```

## Next

→ [`05-mcp-tools`](../05-mcp-tools/) — connect to a Model Context Protocol server for thousands of pre-built tools.
