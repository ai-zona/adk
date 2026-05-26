// ──────────────────────────────────────────────────────
// ADK LLM Types
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/runtime/llm-types.ts
// Extended with tool_use, streaming, and structured output
// ──────────────────────────────────────────────────────

import type { Content } from "./content";

/** Chat message role */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Tool call within a message */
export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** Tool result within a message */
export interface ToolResult {
  toolCallId: string;
  name: string;
  output: unknown;
  isError?: boolean;
}

/** Anthropic-style cache control marker for prompt caching */
export interface CacheControl {
  type: "ephemeral";
}

/** Anthropic-style extended thinking configuration */
export interface ThinkingConfig {
  type: "enabled";
  budgetTokens: number;
}

/** Chat message — extends platform version with tool support */
export interface ChatMessage {
  role: ChatRole;
  content: Content;
  name?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  /** Mark this message for prompt caching (Anthropic-specific; ignored by other providers). */
  cacheControl?: CacheControl;
}

/** Chat completion parameters */
export interface ChatParams {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  /** Enable extended thinking (Anthropic-specific; ignored by other providers). */
  thinking?: ThinkingConfig;
}

/** Chat completion parameters with tool support */
export interface ChatParamsWithTools extends ChatParams {
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "required" | "none" | { name: string };
  responseFormat?: ResponseFormat;
}

/** Tool definition for LLM providers */
export interface LLMToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Response format for structured output */
export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; schema: Record<string, unknown>; name?: string };

/** Chat response */
export interface ChatResponse {
  content: string;
  model: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  ttfbMs?: number;
  costUsd: number;
  finishReason: string;
  /** Tokens written to the prompt cache on this call (Anthropic). */
  cacheCreationInputTokens?: number;
  /** Tokens read from the prompt cache on this call (Anthropic). */
  cacheReadInputTokens?: number;
  /** Aggregated extended-thinking content, when the model was run with thinking enabled. */
  thinking?: string;
}

/** Chat response with tool calls */
export interface ChatResponseWithToolCalls extends ChatResponse {
  toolCalls?: ToolCall[];
}

/** Text completion parameters */
export interface CompleteParams {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
}

/** Text completion response */
export interface CompleteResponse {
  text: string;
  model: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
  finishReason: string;
}

/** Embedding parameters */
export interface EmbedParams {
  input: string | string[];
  model?: string;
}

/** Embedding response */
export interface EmbedResponse {
  embeddings: number[][];
  model: string;
  providerId: string;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
}

/** Stream chunk types from LLM providers */
export type StreamChunk =
  | { type: "text_delta"; content: string }
  | { type: "thinking_delta"; content: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; inputJson: string }
  | { type: "tool_use_end"; id: string }
  | {
      type: "message_end";
      usage: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
      };
    };

/** Base LLM provider interface (from platform-agents) */
export interface LLMProvider {
  readonly providerId: string;
  readonly displayName: string;
  readonly isLocal: boolean;
  chat(params: ChatParams): Promise<ChatResponse>;
  complete(params: CompleteParams): Promise<CompleteResponse>;
  embed?(params: EmbedParams): Promise<EmbedResponse>;
  isAvailable(): boolean;
  getModels(): string[];
  estimateCost(inputTokens: number, outputTokens: number, model?: string): number;
}

/** Extended ADK provider interface with tool calling + streaming */
export interface ADKLLMProvider extends LLMProvider {
  chatWithTools(params: ChatParamsWithTools): Promise<ChatResponseWithToolCalls>;
  chatStream(params: ChatParamsWithTools): AsyncGenerator<StreamChunk>;
}

/** Routing strategy (5 strategies from LLMRouter) */
export type RoutingStrategy =
  | "cost-optimized"
  | "latency-optimized"
  | "quality-optimized"
  | "balanced"
  | "fallback-chain";

/** Budget period for cost tracking */
export type BudgetPeriod = "day" | "week" | "month";

/** Agent LLM configuration */
export interface AgentLLMConfig {
  agentSlug: string;
  enabledProviders: string[];
  strategy: RoutingStrategy;
  budgetLimitUsd?: number;
  budgetPeriod?: BudgetPeriod;
  maxLatencyMs?: number;
  fallbackChain?: string[];
  preferredModel?: string;
}

/** Circuit breaker state per provider */
export interface CircuitBreakerState {
  providerId: string;
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  openedAt: number | null;
}

/** Provider metrics */
export interface ProviderMetrics {
  providerId: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  lastCallAt: number | null;
}

/** Provider initialization configuration */
export interface ProviderInitConfig {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  modelCosts?: Map<string, { input: number; output: number }>;
  knownModels?: string[];
}

/** Model catalog entry */
export interface CatalogModel {
  modelId: string;
  providerId: string;
  displayName: string;
  description: string;
  modality: "chat" | "completion" | "embedding" | "image" | "video" | "audio" | "multimodal";
  capabilities: ModelCapability[];
  costPerMTInput: number;
  costPerMTOutput: number;
  contextWindowInput: number;
  contextWindowOutput: number;
  releaseDate?: string;
  deprecatedAt?: string;
  isPreview?: boolean;
  aliases?: string[];
}

/** Model capability tags */
export type ModelCapability =
  | "text"
  | "code"
  | "vision"
  | "image-generation"
  | "video-generation"
  | "audio"
  | "embeddings"
  | "function-calling"
  | "thinking"
  | "streaming"
  | "json-mode";
