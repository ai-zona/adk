// ──────────────────────────────────────────────────────
// ADK Streaming — WebSocket Relay
// ──────────────────────────────────────────────────────

import type { StreamEvent } from "../types/runner";

/** Minimal WebSocket interface (works with ws, browser WebSocket, etc.) */
export interface WSLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

/** WebSocket readyState constants */
const WS_OPEN = 1;

/** Relay stream events to a WebSocket connection */
export async function relayToWebSocket(
  generator: AsyncGenerator<StreamEvent>,
  ws: WSLike,
): Promise<void> {
  try {
    for await (const event of generator) {
      if (ws.readyState !== WS_OPEN) break;
      ws.send(JSON.stringify(event));
    }
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify({ type: "done" }));
    }
  } catch (error) {
    if (ws.readyState === WS_OPEN) {
      ws.send(JSON.stringify({ type: "error", error: String(error) }));
    }
  }
}
