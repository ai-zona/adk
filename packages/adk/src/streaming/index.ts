export { createAsyncEventStream } from "./async-generator";
export { encodeSSE, streamToSSE } from "./sse-encoder";
export { relayToWebSocket } from "./ws-relay";
export type { WSLike } from "./ws-relay";
export { BackpressuredStream } from "./backpressure";
export type { BackpressureOptions } from "./backpressure";

import type { StreamEvent } from "../types/runner";
import { streamToSSE } from "./sse-encoder";
import { type WSLike, relayToWebSocket } from "./ws-relay";

/** Create a stream adapter from an AsyncGenerator<StreamEvent> */
export function createStreamAdapter(generator: AsyncGenerator<StreamEvent>): {
  toSSE(): ReadableStream<Uint8Array>;
  toWebSocket(ws: WSLike): Promise<void>;
  toAsyncIterable(): AsyncIterable<StreamEvent>;
} {
  // We need to tee the generator for multiple consumers
  // For simplicity, each consumer gets the same generator (use one at a time)
  return {
    toSSE: () => streamToSSE(generator),
    toWebSocket: (ws: WSLike) => relayToWebSocket(generator, ws),
    toAsyncIterable: () => ({ [Symbol.asyncIterator]: () => generator }),
  };
}
