// ──────────────────────────────────────────────────────
// ADK Streaming — SSE Encoder
// ──────────────────────────────────────────────────────

import type { StreamEvent } from "../types/runner";

/** Encode a StreamEvent as an SSE data line */
export function encodeSSE(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Convert an AsyncGenerator<StreamEvent> to a ReadableStream<Uint8Array> for SSE */
export function streamToSSE(generator: AsyncGenerator<StreamEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await generator.next();
        if (done) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(encodeSSE(value)));
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      generator.return(undefined);
    },
  });
}
