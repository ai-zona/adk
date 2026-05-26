// ──────────────────────────────────────────────────────
// ADK Event Types
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/observability/types.ts
// Extended with ADK-specific events (run, handoff, guardrail, session)
// ──────────────────────────────────────────────────────

// ── Platform Events (extracted) ──

export interface TaskSubmittedEvent {
  taskId: string;
  agentSlug: string;
  skill: string;
  title: string;
  timestamp: number;
}

export interface TaskStartedEvent {
  taskId: string;
  agentSlug: string;
  skill: string;
  timestamp: number;
}

export interface TaskCompletedEvent {
  taskId: string;
  agentSlug: string;
  skill: string;
  durationMs: number;
  output?: string;
  timestamp: number;
}

export interface TaskFailedEvent {
  taskId: string;
  agentSlug: string;
  skill: string;
  error: string;
  durationMs: number;
  timestamp: number;
}

export interface AgentStartedEvent {
  agentSlug: string;
  mode: "deterministic" | "llm";
  timestamp: number;
}

export interface AgentStoppedEvent {
  agentSlug: string;
  reason?: string;
  timestamp: number;
}

export interface AgentErrorEvent {
  agentSlug: string;
  error: string;
  taskId?: string;
  timestamp: number;
}

export interface AgentLogEvent {
  agentSlug: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
  taskId?: string;
  timestamp: number;
}

export interface AgentHeartbeatEvent {
  agentSlug: string;
  queueDepth: number;
  activeTaskId?: string;
  memoryMb?: number;
  timestamp: number;
}

export interface AlertCreatedEvent {
  alertId: string;
  agentSlug?: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  timestamp: number;
}

export interface AlertResolvedEvent {
  alertId: string;
  resolvedBy: string;
  timestamp: number;
}

export interface LLMCallCompletedEvent {
  callId: string;
  providerId: string;
  model: string;
  agentSlug?: string;
  taskId?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  ttfbMs?: number;
  timestamp: number;
}

export interface LLMCallFailedEvent {
  callId: string;
  providerId: string;
  model: string;
  agentSlug?: string;
  taskId?: string;
  error: string;
  errorCode?: string;
  latencyMs: number;
  timestamp: number;
}

export interface LLMProviderSwitchedEvent {
  agentSlug: string;
  fromProviderId: string;
  toProviderId: string;
  reason: string;
  timestamp: number;
}

export interface HealthCheckEvent {
  healthy: string[];
  unhealthy: string[];
  restarted: string[];
  staleTasks: string[];
  timestamp: number;
}

export interface ModelsDiscoveredEvent {
  providerId: string;
  modelsFound: number;
  catalogMatches: number;
  errors: string[];
  timestamp: number;
}

// ── ADK-Specific Events ──

export interface RunStartedEvent {
  runId: string;
  agentName: string;
  sessionId?: string;
  traceId: string;
  timestamp: number;
}

export interface RunCompletedEvent {
  runId: string;
  agentName: string;
  totalTurns: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  sessionId?: string;
  traceId: string;
  timestamp: number;
}

export interface RunFailedEvent {
  runId: string;
  agentName: string;
  error: string;
  turnNumber: number;
  sessionId?: string;
  traceId: string;
  timestamp: number;
}

export interface HandoffEvent {
  runId: string;
  fromAgent: string;
  toAgent: string;
  reason: string;
  turnNumber: number;
  timestamp: number;
}

export interface GuardrailTriggeredEvent {
  runId: string;
  guardrailName: string;
  type: "input" | "output" | "tool";
  passed: boolean;
  tripwire: boolean;
  agentName: string;
  severity?: string;
  message?: string;
  timestamp: number;
}

export interface ToolExecutedEvent {
  runId: string;
  toolName: string;
  agentName: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface SessionCreatedEvent {
  sessionId: string;
  agentName: string;
  timestamp: number;
}

export interface SessionResumedEvent {
  sessionId: string;
  agentName: string;
  messageCount: number;
  timestamp: number;
}

export interface ContextTrimmedEvent {
  runId: string;
  agentName: string;
  strategy: "sliding-window" | "smart-summary" | "jit";
  originalTokens: number;
  trimmedTokens: number;
  messagesRemoved: number;
  turnNumber: number;
  timestamp: number;
}

export interface ToolsSelectedEvent {
  runId: string;
  agentName: string;
  totalTools: number;
  selectedTools: number;
  selectedNames: string[];
  strategy: "all" | "keyword" | "deferred";
  turnNumber: number;
  timestamp: number;
}

export interface ArtifactCreatedEvent {
  runId: string;
  agentName: string;
  artifactId: string;
  title: string;
  kind: "html" | "react" | "svg" | "markdown" | "code";
  version: number;
  timestamp: number;
}

// ── Event Map ──

/** Full ADK event map — type-safe pub/sub */
export interface ADKEventMap {
  // Platform events (backward-compatible)
  "task.submitted": TaskSubmittedEvent;
  "task.started": TaskStartedEvent;
  "task.completed": TaskCompletedEvent;
  "task.failed": TaskFailedEvent;
  "agent.started": AgentStartedEvent;
  "agent.stopped": AgentStoppedEvent;
  "agent.error": AgentErrorEvent;
  "agent.log": AgentLogEvent;
  "agent.heartbeat": AgentHeartbeatEvent;
  "alert.created": AlertCreatedEvent;
  "alert.resolved": AlertResolvedEvent;
  "llm.call.completed": LLMCallCompletedEvent;
  "llm.call.failed": LLMCallFailedEvent;
  "llm.provider.switched": LLMProviderSwitchedEvent;
  "health.check": HealthCheckEvent;
  "models.discovered": ModelsDiscoveredEvent;

  // ADK-specific events
  "run.started": RunStartedEvent;
  "run.completed": RunCompletedEvent;
  "run.failed": RunFailedEvent;
  handoff: HandoffEvent;
  "guardrail.triggered": GuardrailTriggeredEvent;
  "tool.executed": ToolExecutedEvent;
  "session.created": SessionCreatedEvent;
  "session.resumed": SessionResumedEvent;
  "context.trimmed": ContextTrimmedEvent;
  "tools.selected": ToolsSelectedEvent;
  "artifact.created": ArtifactCreatedEvent;
}

/** Event name type */
export type ADKEventName = keyof ADKEventMap;

/** Event listener type */
export type ADKEventListener<K extends ADKEventName> = (data: ADKEventMap[K]) => void;
