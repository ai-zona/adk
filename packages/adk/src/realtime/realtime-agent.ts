// ──────────────────────────────────────────────────────
// ADK RealtimeAgent — Voice/Audio streaming
// ──────────────────────────────────────────────────────
// WebSocket-based realtime agent for voice interactions.
// Supports OpenAI Realtime API.
// ──────────────────────────────────────────────────────

import type { AgentConfig } from "../types/agent";
import type { ToolDef } from "../types/tool";

/** Voice options */
export type VoiceName = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

/** Audio format */
export type AudioFormat = "pcm16" | "opus";

/** Voice activity detection mode */
export type VADMode = "server" | "client" | "off";

/** Realtime provider */
export type RealtimeProvider = "openai";

/** Realtime agent configuration */
export interface RealtimeAgentConfig extends AgentConfig {
  /** Voice to use */
  voice?: VoiceName;
  /** Audio format */
  audioFormat?: AudioFormat;
  /** VAD mode */
  vadMode?: VADMode;
  /** Realtime provider */
  realtimeProvider?: RealtimeProvider;
  /** Provider API key */
  apiKey?: string;
  /** WebSocket URL override */
  wsUrl?: string;
}

/** Realtime connection state */
export type RealtimeState = "disconnected" | "connecting" | "connected" | "error";

/** Realtime event types */
export type RealtimeEvent =
  | { type: "state_change"; state: RealtimeState }
  | { type: "audio"; buffer: ArrayBuffer }
  | { type: "text"; content: string; final: boolean }
  | { type: "tool_call"; toolName: string; input: unknown; callId: string }
  | { type: "error"; message: string };

/**
 * RealtimeAgent — Voice-enabled agent using WebSocket realtime APIs.
 *
 * Currently supports OpenAI Realtime API.
 * Connect, send audio, and receive audio/text responses.
 */
export class RealtimeAgent {
  readonly config: RealtimeAgentConfig;
  private state: RealtimeState = "disconnected";
  private ws: WebSocket | null = null;
  private audioHandlers: Array<(buffer: ArrayBuffer) => void> = [];
  private textHandlers: Array<(text: string) => void> = [];
  private toolCallHandlers: Array<(toolName: string, input: unknown) => Promise<unknown>> = [];
  private eventHandlers: Array<(event: RealtimeEvent) => void> = [];

  constructor(config: RealtimeAgentConfig) {
    this.config = config;
  }

  /** Get current connection state */
  getState(): RealtimeState {
    return this.state;
  }

  /** Connect to the realtime provider */
  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.setState("connecting");

    const url = this.config.wsUrl ?? this.getProviderUrl();

    try {
      this.ws = new WebSocket(url, [
        "realtime",
        `openai-insecure-api-key.${this.config.apiKey ?? ""}`,
        "openai-beta.realtime-v1",
      ]);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
        }, 10000);

        this.ws!.onopen = () => {
          clearTimeout(timeout);
          this.setState("connected");
          this.sendSessionConfig();
          resolve();
        };

        this.ws!.onerror = (event) => {
          clearTimeout(timeout);
          this.setState("error");
          reject(new Error("WebSocket connection failed"));
        };

        this.ws!.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws!.onclose = () => {
          this.setState("disconnected");
        };
      });
    } catch (error) {
      this.setState("error");
      throw error;
    }
  }

  /** Disconnect from the realtime provider */
  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  /** Send an audio buffer to the realtime session */
  sendAudio(buffer: ArrayBuffer): void {
    if (this.state !== "connected" || !this.ws) {
      throw new Error("Not connected");
    }

    // Encode audio as base64 for JSON transport
    const base64 = arrayBufferToBase64(buffer);

    this.ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: base64,
      }),
    );
  }

  /** Send a text message to the realtime session */
  sendText(text: string): void {
    if (this.state !== "connected" || !this.ws) {
      throw new Error("Not connected");
    }

    this.ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      }),
    );

    // Request a response
    this.ws.send(JSON.stringify({ type: "response.create" }));
  }

  /** Register handler for audio output */
  onAudio(handler: (buffer: ArrayBuffer) => void): () => void {
    this.audioHandlers.push(handler);
    return () => {
      this.audioHandlers = this.audioHandlers.filter((h) => h !== handler);
    };
  }

  /** Register handler for text output */
  onText(handler: (text: string) => void): () => void {
    this.textHandlers.push(handler);
    return () => {
      this.textHandlers = this.textHandlers.filter((h) => h !== handler);
    };
  }

  /** Register handler for tool calls */
  onToolCall(handler: (toolName: string, input: unknown) => Promise<unknown>): () => void {
    this.toolCallHandlers.push(handler);
    return () => {
      this.toolCallHandlers = this.toolCallHandlers.filter((h) => h !== handler);
    };
  }

  /** Register handler for all events */
  onEvent(handler: (event: RealtimeEvent) => void): () => void {
    this.eventHandlers.push(handler);
    return () => {
      this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
    };
  }

  private setState(state: RealtimeState): void {
    this.state = state;
    this.emitEvent({ type: "state_change", state });
  }

  private emitEvent(event: RealtimeEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors break the realtime stream
      }
    }
  }

  private sendSessionConfig(): void {
    if (!this.ws) return;

    const tools = (this.config.tools ?? []).map((t: ToolDef) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));

    this.ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          modalities: ["text", "audio"],
          instructions:
            typeof this.config.instructions === "string"
              ? this.config.instructions
              : "You are a helpful assistant.",
          voice: this.config.voice ?? "alloy",
          input_audio_format: this.config.audioFormat ?? "pcm16",
          output_audio_format: this.config.audioFormat ?? "pcm16",
          turn_detection: this.config.vadMode === "off" ? null : { type: "server_vad" },
          tools,
        },
      }),
    );
  }

  private async handleMessage(data: unknown): Promise<void> {
    try {
      const msg = typeof data === "string" ? JSON.parse(data) : data;

      switch (msg.type) {
        case "response.audio.delta": {
          const buffer = base64ToArrayBuffer(msg.delta);
          for (const handler of this.audioHandlers) handler(buffer);
          this.emitEvent({ type: "audio", buffer });
          break;
        }

        case "response.text.delta":
        case "response.audio_transcript.delta": {
          const text = msg.delta ?? "";
          for (const handler of this.textHandlers) handler(text);
          this.emitEvent({ type: "text", content: text, final: false });
          break;
        }

        case "response.text.done":
        case "response.audio_transcript.done": {
          const text = msg.text ?? "";
          this.emitEvent({ type: "text", content: text, final: true });
          break;
        }

        case "response.function_call_arguments.done": {
          const toolName = msg.name;
          const input = JSON.parse(msg.arguments ?? "{}");
          const callId = msg.call_id;

          this.emitEvent({ type: "tool_call", toolName, input, callId });

          // Execute tool via handlers
          for (const handler of this.toolCallHandlers) {
            try {
              const result = await handler(toolName, input);
              this.sendToolResult(callId, result);
              break;
            } catch {
              // Try next handler
            }
          }
          break;
        }

        case "error": {
          const errMsg = msg.error?.message ?? "Unknown realtime error";
          this.emitEvent({ type: "error", message: errMsg });
          break;
        }
      }
    } catch {
      // Ignore unparseable messages
    }
  }

  private sendToolResult(callId: string, result: unknown): void {
    if (!this.ws) return;

    this.ws.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: typeof result === "string" ? result : JSON.stringify(result),
        },
      }),
    );

    this.ws.send(JSON.stringify({ type: "response.create" }));
  }

  private getProviderUrl(): string {
    switch (this.config.realtimeProvider ?? "openai") {
      case "openai":
        return "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview";
      default:
        throw new Error(`Unsupported realtime provider: ${this.config.realtimeProvider}`);
    }
  }
}

// ── Utility Functions ──

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
