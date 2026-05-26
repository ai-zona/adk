// ──────────────────────────────────────────────────────
// ADK Runner Types
// ──────────────────────────────────────────────────────

import type { Artifact, ArtifactStore } from "../artifacts/artifact-store";
import type { ModelConfig } from "./agent";
import type { AudioPart, ContentPart, ImagePart, UIArtifactPart, VideoPart } from "./content";
import type { GuardrailResult } from "./guardrail";
import type { CatalogModel, ChatMessage } from "./llm";
import type { SessionBackend } from "./session";

/** Feature definition for harness progress tracking */
export interface ProgressFeatureConfig {
  id: string;
  name: string;
}

/** Harness configuration for long-running agent sessions */
export interface HarnessConfig {
  /** Enable progress tracking tools */
  enableProgress?: boolean;
  /** Enable note-taking tools */
  enableNotes?: boolean;
  /** Initial features to track (if enableProgress) */
  features?: ProgressFeatureConfig[];
}

/** Run configuration — input to Runner.run() */
export interface RunConfig {
  /** User input message (string or multi-modal ContentPart[]) */
  input: string | ContentPart[];

  /** Session ID to resume (optional) */
  sessionId?: string;

  /** Previous messages to include (if no sessionId) */
  messages?: ChatMessage[];

  /** Model override for this run */
  model?: string | ModelConfig;

  /** Max turns override */
  maxTurns?: number;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Run metadata */
  metadata?: Record<string, unknown>;

  /** Harness tools for long-running sessions */
  harness?: HarnessConfig;
}

/** Run result — output from Runner.run() */
export interface RunResult {
  /** Text output from the agent */
  output: string;

  /** Multi-modal output parts (if response contains non-text content) */
  outputParts?: ContentPart[];

  /** Structured output (if agent has outputSchema) */
  structuredOutput?: unknown;

  /** Full message history */
  messages: ChatMessage[];

  /** Usage statistics */
  usage: RunUsage;

  /** Handoff chain (if multi-agent) */
  handoffs: HandoffRecord[];

  /** Guardrail results */
  guardrailResults: GuardrailResult[];

  /** Trace ID for observability */
  traceId: string;

  /** Session ID (if sessions enabled) */
  sessionId?: string;

  /** Name of the agent that produced final output */
  finalAgent: string;

  /** Run ID */
  runId: string;

  /** Total turns executed */
  totalTurns: number;

  /** Artifacts created during the run */
  artifacts?: Artifact[];
}

/** Usage statistics for a run */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  latencyMs: number;
}

/** Record of a handoff during a run */
export interface HandoffRecord {
  fromAgent: string;
  toAgent: string;
  reason: string;
  turnNumber: number;
}

/** Stream events emitted during execution */
export type StreamEvent =
  | { type: "text_delta"; content: string; agentName: string }
  | { type: "image_output"; image: ImagePart; agentName: string }
  | { type: "audio_output"; audio: AudioPart; agentName: string }
  | { type: "video_output"; video: VideoPart; agentName: string }
  | { type: "ui_artifact"; artifact: UIArtifactPart; agentName: string }
  | { type: "tool_call_start"; toolName: string; agentName: string; input: unknown }
  | { type: "tool_call_end"; toolName: string; agentName: string; output: unknown }
  | { type: "handoff"; fromAgent: string; toAgent: string; reason: string }
  | {
      type: "guardrail";
      name: string;
      passed: boolean;
      tripwire: boolean;
      message?: string;
    }
  | { type: "turn_complete"; agentName: string; turnNumber: number }
  | { type: "run_complete"; result: RunResult }
  | { type: "error"; error: string; agentName: string };

/** Runner configuration */
export interface RunnerConfig {
  /** Default model for all agents */
  defaultModel?: string | ModelConfig;

  /** Default max turns */
  defaultMaxTurns?: number;

  /** Session backend */
  sessionBackend?: SessionBackend;

  /** Tracing configuration */
  tracing?: TracingConfig;

  /** Tracer instance for structured span-based tracing */
  tracer?: import("../tracing/tracer").Tracer;

  /** Model context window size override (auto-detected from model catalog if not set) */
  modelContextWindow?: number;

  /** Model catalog for context window lookups (optional, for auto-detection) */
  modelCatalog?: CatalogModel[];

  /** Artifact store for A2UI artifact persistence (optional) */
  artifactStore?: ArtifactStore;

  /** Enable code execution mode (programmatic tool calling) */
  enableCodeExecution?: boolean;
}

/** Tracing configuration */
export interface TracingConfig {
  enabled?: boolean;
  exporter?: "console" | "langfuse" | "eventbus";
  exporterConfig?: Record<string, unknown>;
}

/** Run context — available to agents, tools, and guardrails during execution */
export interface RunContext {
  /** Current run ID */
  runId: string;

  /** Current agent name */
  agentName: string;

  /** Current turn number */
  turnNumber: number;

  /** Session ID (if sessions enabled) */
  sessionId?: string;

  /** Trace ID */
  traceId: string;

  /** Accumulated usage */
  usage: RunUsage;

  /** Abort signal */
  signal?: AbortSignal;

  /** Run metadata */
  metadata: Record<string, unknown>;
}
