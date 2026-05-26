// ──────────────────────────────────────────────────────
// @aizonaai/adk — AIZona Agent Development Kit
// ──────────────────────────────────────────────────────

// Types
export type * from "./types/index";

// Events
export { ADKEventBus } from "./events/index";

// Agent
export { Agent, defineAgent } from "./agent/index";

// Tools
export { defineTool, ToolRegistry, createToolSearchTool } from "./tools/index";
export type { ToolSearchResult } from "./tools/index";

// Structured Output
export {
  zodToJsonSchema,
  isZodSchema,
  ensureJsonSchema,
  validateOutput,
  toAnthropicToolSchema,
  toOpenAIResponseFormat,
  toGoogleSchemaFormat,
  schemaToToolInput,
} from "./output/index";

// Guardrails
export { GuardrailEngine, GuardrailTripwireError } from "./guardrails/engine";
export { contentFilter } from "./guardrails/built-in/content-filter";
export { consentGate } from "./guardrails/built-in/consent-gate";
export { budgetLimit } from "./guardrails/built-in/budget-limit";
export { budgetGateGuardrail } from "./guardrails/built-in/budget-gate";
export type { BudgetCheckData } from "./guardrails/built-in/budget-gate";
export { tokenLimit } from "./guardrails/built-in/token-limit";
export { piiFilter } from "./guardrails/built-in/pii-filter";

// Runner
export { Runner } from "./runner/runner";
export { TurnExecutor } from "./runner/turn-executor";
export { createRunContext, createRunId, createTraceId } from "./runner/context";
export { CodeExecutor } from "./runner/code-executor";
export type { CodeExecutorConfig, CodeExecutionResult } from "./runner/code-executor";
export { createExecuteCodeTool } from "./tools/built-in/execute-code";

// Observability — Logging, Metrics, Errors, Audit
export {
  Logger,
  ConsoleTransport,
  MemoryTransport,
  getDefaultLogger,
  setDefaultLogger,
} from "./logging/logger";
export type {
  LogLevel,
  LogContext,
  LogRecord,
  LogTransport,
  LoggerOptions,
} from "./logging/logger";
export {
  MetricsCollector,
  METRIC_NAMES,
  getDefaultMetrics,
  setDefaultMetrics,
} from "./metrics/collector";
export type { MetricsSnapshot } from "./metrics/collector";
export { classifyError } from "./errors/classify";
export type { ClassifiedError, ErrorCategory } from "./errors/classify";
export type {
  RunAudit,
  RunAuditStatus,
  RunAuditTurn,
  RunAuditToolCall,
} from "./types/audit";

// Providers
export { BaseProvider } from "./providers/base-provider";
export { AnthropicProvider } from "./providers/anthropic";
export { OpenAIProvider } from "./providers/openai";
export { GoogleProvider } from "./providers/google";
export { XAIProvider } from "./providers/xai";
export { OllamaProvider } from "./providers/ollama";
export { LMStudioProvider } from "./providers/lmstudio";
export { createProvider } from "./providers/factory";
export { ADKProviderError } from "./providers/errors";
export type { ADKProviderErrorCode } from "./providers/errors";

// Utils
export { redact } from "./utils/index";
export type { RedactOptions } from "./utils/index";

// Routing
export { ADKLLMAdapter } from "./routing/llm-adapter";
export { ADKRouter } from "./routing/llm-router";

// Streaming
export { createAsyncEventStream } from "./streaming/async-generator";
export { encodeSSE, streamToSSE } from "./streaming/sse-encoder";
export { relayToWebSocket, createStreamAdapter } from "./streaming/index";
export { BackpressuredStream } from "./streaming/backpressure";
export type { BackpressureOptions } from "./streaming/backpressure";

// Auth / API Key
export { generateApiKey, hashApiKey, parseApiKey, validateApiKeyFormat } from "./auth/api-key";
export { ProxyRouter } from "./auth/proxy-router";

// Sessions
export { MemorySessionBackend } from "./sessions/memory-backend";
export { PrismaSessionBackend } from "./sessions/prisma-backend";
export { ContextManager } from "./sessions/context-manager";
export { compactMessages } from "./sessions/compaction";
export type { CompactionOptions } from "./sessions/compaction";
export type { ContextManagerConfig } from "./sessions/context-manager";
export { TokenCounter } from "./sessions/token-counter";
export type { TokenCounterStrategy, TokenCounterConfig } from "./sessions/token-counter";
export { ContextSummarizer } from "./sessions/context-summarizer";
export type { SummarizationConfig } from "./sessions/context-summarizer";
export { AgenticMemory, InMemoryBackend } from "./sessions/agentic-memory";
export type { AgenticMemoryBackend } from "./sessions/agentic-memory";
export {
  createMemoryWriteTool,
  createMemoryReadTool,
  createMemorySearchTool,
} from "./tools/built-in/memory-tools";

// Tracing
export { Tracer, Trace } from "./tracing/tracer";
export { Span } from "./tracing/span";
export { ConsoleExporter } from "./tracing/exporters/console";
export { EventBusExporter } from "./tracing/exporters/eventbus";
export { LangfuseExporter } from "./tracing/exporters/langfuse";

// Multi-Agent
export { HandoffManager, HANDOFF_PREFIX } from "./multi-agent/handoff";
export { agentAsTool } from "./multi-agent/agent-tool";
export { ParallelRunner } from "./multi-agent/parallel-runner";
export { Team } from "./multi-agent/team";

// Pipeline
export { ADKPipeline } from "./pipeline/pipeline-executor";
export { ADKReviewPipeline } from "./pipeline/review-pipeline";

// Tool Selection
export { ToolSelector } from "./tools/tool-selector";
export type {
  ToolSelectionConfig,
  ToolSelectionStrategy,
  ToolRelevanceScore,
} from "./tools/tool-selector";

// MCP Tools
export {
  mcpServerTools,
  MCPServerConnector,
  discoverMCPTools,
  mcpSelectTools,
} from "./tools/mcp/index";

// Realtime / Voice
export { RealtimeAgent } from "./realtime/realtime-agent";
export {
  AudioStreamBuffer,
  pcm16FromArrayBuffer,
  pcm16ToArrayBuffer,
  calculateVolume,
} from "./realtime/audio-stream";

// Skills
export {
  defineSkill,
  SkillManifestSchema,
  loadSkill,
  mergeSkillTools,
} from "./skills/index";
export type { SkillManifest, SkillToolEntry, LoadedSkill } from "./skills/index";

// Content (Multi-modal)
export {
  isMultiModalContent,
  isTextPart,
  isImagePart,
  isAudioPart,
  isVideoPart,
  isUIArtifactPart,
  contentToString,
  extractText,
  contentToParts,
  countMediaParts,
} from "./content/index";

// Artifacts (A2UI)
export { ArtifactStore, createArtifactTool } from "./artifacts/index";
export type { Artifact } from "./artifacts/index";

// Harness (Progress Protocol + Structured Notes)
export { ProgressTracker, NotesStore } from "./harness/index";
export type { ProgressFeature, FeatureStatus, NoteEntry, NoteSection } from "./harness/index";
export { createProgressTool } from "./tools/built-in/progress-tool";
export { createWriteNoteTool, createReadNotesTool } from "./tools/built-in/notes-tool";

// Memory (Vector Memory System)
export {
  EmbeddingService,
  MemoryManager,
  PgVectorMemoryBackend,
  InMemorySharedStore,
  MemoryDecayManager,
} from "./memory/index";
export type {
  MemoryType,
  MemoryEntry,
  MemorySearchResult,
  MemoryBackend,
  EmbeddingConfig,
  EmbedApiResponse,
  MemoryManagerConfig,
  PgVectorDatabaseClient,
  SharedMemoryScope,
  SharedMemoryNamespace,
  SharedMemoryEntry,
  SharedMemoryStore,
  DecayPolicy,
} from "./memory/index";

// Eval Harness
export { defineEvalSuite, runEval } from "./eval/index";
export type { EvalCase, EvalResult, EvalSuite } from "./eval/index";

// Plugins
export { definePlugin, PluginRegistry } from "./plugins/index";
export type {
  PluginDefinition,
  PluginManifest,
  PluginContext,
  PluginCapability,
  PluginLifecycle,
  PluginStatus,
  UIExtensionSlot,
} from "./plugins/index";
