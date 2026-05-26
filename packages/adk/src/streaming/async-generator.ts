// ──────────────────────────────────────────────────────
// ADK Streaming — AsyncGenerator utilities
// ──────────────────────────────────────────────────────

import type { StreamEvent } from "../types/runner";

/** Create a controllable async generator from events */
export function createAsyncEventStream(): {
  push: (event: StreamEvent) => void;
  close: () => void;
  error: (err: Error) => void;
  stream: AsyncGenerator<StreamEvent>;
} {
  const queue: StreamEvent[] = [];
  let resolve: (() => void) | null = null;
  let closed = false;
  let streamError: Error | null = null;

  const push = (event: StreamEvent) => {
    if (closed) return;
    queue.push(event);
    resolve?.();
    resolve = null;
  };

  const close = () => {
    closed = true;
    resolve?.();
    resolve = null;
  };

  const error = (err: Error) => {
    streamError = err;
    closed = true;
    resolve?.();
    resolve = null;
  };

  async function* generator(): AsyncGenerator<StreamEvent> {
    while (true) {
      if (streamError) throw streamError;
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      if (closed) return;
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  }

  return { push, close, error, stream: generator() };
}
