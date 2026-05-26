// ──────────────────────────────────────────────────────
// ADK Runner — Main execution engine
// ──────────────────────────────────────────────────────
// Generalized from @aizona/platform-agents/intelligence/agent-brain.ts
// Turn loop: build messages → LLM call → tool execution → guardrails → handoff → repeat
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import { contentToParts, extractText, isMultiModalContent } from "../content/helpers";
import { classifyError, type ClassifiedError } from "../errors/classify";
import type { ADKEventBus } from "../events/event-bus";
import { NotesStore } from "../harness/notes-store";
import { ProgressTracker } from "../harness/progress-tracker";
import { getDefaultLogger, type Logger } from "../logging/logger";
import { getDefaultMetrics, METRIC_NAMES, type MetricsCollector } from "../metrics/collector";
import { ContextManager } from "../sessions/context-manager";
import { TokenCounter } from "../sessions/token-counter";
import { createExecuteCodeTool } from "../tools/built-in/execute-code";
import { createReadNotesTool, createWriteNoteTool } from "../tools/built-in/notes-tool";
import { createProgressTool } from "../tools/built-in/progress-tool";
import { ToolSelector } from "../tools/tool-selector";
import type { Trace, Tracer } from "../tracing/tracer";
import type { ContextConfig } from "../types/agent";
import type { RunAudit, RunAuditStatus } from "../types/audit";
import type { ContentPart } from "../types/content";
import type { GuardrailResult } from "../types/guardrail";
import type { ADKLLMProvider, CatalogModel, ChatMessage, LLMToolDefinition } from "../types/llm";
import type {
  HandoffRecord,
  HarnessConfig,
  RunConfig,
  RunContext,
  RunResult,
  RunUsage,
  RunnerConfig,
  StreamEvent,
} from "../types/runner";
import type { ToolDef } from "../types/tool";
import { RunAuditBuilder } from "./audit-builder";
import { createRunContext, createRunId, createTraceId } from "./context";
import { TurnExecutor } from "./turn-executor";

const HANDOFF_PREFIX = "transfer_to_";

export class Runner {
  private config: RunnerConfig;
  private turnExecutor = new TurnExecutor();
  private provider?: ADKLLMProvider;
  private eventBus?: ADKEventBus;
  private tracer?: Tracer;
  private agents = new Map<string, Agent>();
  private contextManager?: ContextManager;
  private modelContextWindow?: number;
  private modelCatalog?: CatalogModel[];
  private tokenCounter = new TokenCounter();
  private logger: Logger;
  private metrics: MetricsCollector;

  constructor(config?: RunnerConfig & { provider?: ADKLLMProvider; eventBus?: ADKEventBus }) {
    this.config = config ?? {};
    this.provider = config?.provider;
    this.eventBus = config?.eventBus;
    this.tracer = config?.tracer;
    this.modelContextWindow = config?.modelContextWindow;
    this.modelCatalog = config?.modelCatalog;
    this.logger = config?.logger ?? getDefaultLogger();
    this.metrics = config?.metrics ?? getDefaultMetrics();

    // Wire eventBus to turn executor
    if (this.eventBus) {
      this.turnExecutor.setEventBus(this.eventBus);
    }
    this.turnExecutor.setLogger(this.logger);
    this.turnExecutor.setMetrics(this.metrics);
  }

  /** Register an agent (for handoff resolution) */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.name, agent);
  }

  /** Set the LLM provider */
  setProvider(provider: ADKLLMProvider): void {
    this.provider = provider;
  }

  /** Run an agent to completion */
  async run(agent: Agent, input: RunConfig): Promise<RunResult> {
    const provider = this.provider;
    if (!provider) {
      throw new Error(
        "No LLM provider configured. Call setProvider() or pass provider in constructor.",
      );
    }

    // Register agent for handoff lookup
    this.agents.set(agent.name, agent);

    const runId = createRunId();
    const traceId = createTraceId();
    const maxTurns = input.maxTurns ?? agent.getMaxTurns() ?? this.config.defaultMaxTurns ?? 25;

    const ctx = createRunContext({
      runId,
      agentName: agent.name,
      sessionId: input.sessionId,
      traceId,
      signal: input.signal,
      metadata: input.metadata,
    });

    const runLogger = this.logger.child({
      runId,
      agentName: agent.name,
      sessionId: input.sessionId,
      traceId,
    });
    const auditBuilder = new RunAuditBuilder(runId, traceId, input.sessionId);
    this.metrics.incrementCounter(METRIC_NAMES.runsTotal, { agent: agent.name, status: "started" });
    this.metrics.adjustGauge(METRIC_NAMES.runsActive, 1, { agent: agent.name });

    runLogger.info("run started");

    this.eventBus?.emit("run.started", {
      runId,
      agentName: agent.name,
      sessionId: input.sessionId,
      traceId,
      timestamp: Date.now(),
    });

    // Start trace if tracer is configured
    const trace = this.tracer?.startTrace(agent.name, {
      runId: ctx.runId,
      sessionId: ctx.sessionId,
    });
    const runSpan = trace?.startSpan("run", "agent");
    runSpan?.setAttribute("agentName", agent.name);
    runSpan?.setAttribute("runId", runId);

    // Pass trace to turn executor for per-turn span creation
    this.turnExecutor.setTrace(trace);

    // Configure tool selection
    this.configureToolSelection(agent);

    // Build initial messages
    const messages: ChatMessage[] = [];

    // System prompt
    const instructions = await agent.getInstructions(ctx);
    messages.push({ role: "system", content: instructions });

    // Previous messages
    if (input.messages) {
      messages.push(...input.messages);
    }

    // User input (string or ContentPart[])
    messages.push({ role: "user", content: input.input });

    // Inject harness tools if configured
    const harnessTools = this.buildHarnessTools(input.harness);
    if (harnessTools.length > 0) {
      for (const tool of harnessTools) {
        agent.addTool(tool);
      }
    }

    // Inject execute_code tool if code execution enabled
    if (this.config.enableCodeExecution) {
      agent.addTool(createExecuteCodeTool(agent.getTools()));
    }

    // Turn loop
    let currentAgent = agent;
    const handoffs: HandoffRecord[] = [];
    const allGuardrailResults: GuardrailResult[] = [];

    const startTime = Date.now();

    // Resolve context management
    const ctxManager = this.resolveContextManager(currentAgent);
    const contextBudget = this.resolveContextBudget(
      currentAgent,
      currentAgent.config.contextConfig,
    );
    const contextStrategy = currentAgent.config.contextConfig?.strategy ?? "sliding-window";

    const finalize = async (
      status: RunAuditStatus,
      finalAgentName: string,
      totalTurns: number,
      usage: RunUsage,
      error?: ClassifiedError,
    ): Promise<RunAudit> => {
      this.metrics.adjustGauge(METRIC_NAMES.runsActive, -1, { agent: agent.name });
      this.metrics.incrementCounter(METRIC_NAMES.runsTotal, {
        agent: agent.name,
        status,
      });
      this.metrics.observeHistogram(METRIC_NAMES.turnsPerRun, totalTurns, {
        agent: agent.name,
      });
      const audit = auditBuilder.finish({
        status,
        finalAgent: finalAgentName,
        totalTurns,
        usage,
        handoffs,
        guardrailResults: allGuardrailResults,
        error,
      });
      this.eventBus?.emit("run.audit", audit);
      if (this.config.onRunComplete) {
        try {
          await this.config.onRunComplete(audit);
        } catch (cbErr) {
          runLogger.error("onRunComplete callback threw", cbErr);
        }
      }
      return audit;
    };

    for (let turn = 0; turn < maxTurns; turn++) {
      // Check abort signal
      if (input.signal?.aborted) {
        runSpan?.setError("Run aborted");
        runSpan?.end();
        if (trace) await this.tracer?.endAndExport(trace);
        const abortClassified = classifyError(new Error("Run aborted"));
        this.metrics.incrementCounter(METRIC_NAMES.errorsByType, {
          category: abortClassified.category,
          code: abortClassified.errorName,
          provider: abortClassified.providerId,
        });
        await finalize("aborted", currentAgent.name, turn, ctx.usage, abortClassified);
        if (this.config.onError) {
          try {
            await this.config.onError(abortClassified, ctx);
          } catch (cbErr) {
            runLogger.error("onError callback threw", cbErr);
          }
        }
        runLogger.warn("run aborted");
        throw new Error("Run aborted");
      }

      ctx.turnNumber = turn + 1;
      ctx.agentName = currentAgent.name;

      // Trim context before LLM call
      if (ctxManager && contextBudget > 0) {
        const originalCount = messages.length;
        const originalTokens = ctxManager.getTokenCount(messages);
        const toolTokens = this.estimateToolTokens(currentAgent);
        const availableForMessages = contextBudget - toolTokens;
        if (availableForMessages > 0) {
          const trimmed = await ctxManager.trimToFit(
            messages,
            availableForMessages,
            contextStrategy,
          );
          if (trimmed !== messages) {
            if (trimmed.length < originalCount) {
              const trimmedTokens = ctxManager.getTokenCount(trimmed);
              this.eventBus?.emit("context.trimmed", {
                runId,
                agentName: currentAgent.name,
                strategy: contextStrategy,
                originalTokens,
                trimmedTokens,
                messagesRemoved: originalCount - trimmed.length,
                turnNumber: ctx.turnNumber,
                timestamp: Date.now(),
              });
            }
            messages.length = 0;
            messages.push(...trimmed);
          }
        }
      }

      // Build handoff tools
      const handoffToolDefs = this.buildHandoffTools(currentAgent);

      const guardrails = currentAgent.config.guardrails ?? [];

      // Create turn span under the run span
      const turnSpan = trace?.startSpan(`turn-${turn + 1}`, "agent", runSpan?.id);
      turnSpan?.setAttribute("turnNumber", turn + 1);
      turnSpan?.setAttribute("agentName", currentAgent.name);

      let turnResult: Awaited<ReturnType<TurnExecutor["executeTurn"]>>;
      try {
        turnResult = await this.turnExecutor.executeTurn(
          currentAgent,
          messages,
          provider,
          ctx,
          guardrails,
          handoffToolDefs,
        );
      } catch (err) {
        const classified = classifyError(err);
        turnSpan?.setError(classified.message);
        turnSpan?.end();
        runSpan?.setError(classified.message);
        runSpan?.end();
        if (trace) await this.tracer?.endAndExport(trace);
        this.metrics.incrementCounter(METRIC_NAMES.errorsByType, {
          category: classified.category,
          code: classified.code ?? classified.errorName,
          provider: classified.providerId,
        });
        await finalize("errored", currentAgent.name, turn, ctx.usage, classified);
        if (this.config.onError) {
          try {
            await this.config.onError(classified, ctx);
          } catch (cbErr) {
            runLogger.error("onError callback threw", cbErr);
          }
        }
        runLogger.error("turn failed", err, {
          turnNumber: turn + 1,
          category: classified.category,
          fingerprint: classified.fingerprint,
        });
        throw err;
      }

      // End turn span
      turnSpan?.end();

      // Append messages
      messages.push(...turnResult.newMessages);
      allGuardrailResults.push(...turnResult.guardrailResults);

      // Record per-turn audit info
      auditBuilder.recordTurn({
        turnNumber: turn + 1,
        agentName: currentAgent.name,
        inputTokens: turnResult.telemetry.inputTokens,
        outputTokens: turnResult.telemetry.outputTokens,
        costUsd: turnResult.telemetry.costUsd,
        durationMs: turnResult.telemetry.durationMs,
        toolCalls: turnResult.telemetry.toolCalls,
        providerId: turnResult.telemetry.providerId,
        model: turnResult.telemetry.model,
      });
      for (const t of turnResult.telemetry.toolTimings) {
        auditBuilder.recordTool({ name: t.name, durationMs: t.durationMs, isError: t.isError });
      }

      // Guardrail metric: count blocked results
      for (const g of turnResult.guardrailResults) {
        if (!g.passed) {
          this.metrics.incrementCounter(METRIC_NAMES.guardrailTriggers, {
            guardrail: g.name,
            severity: g.severity ?? "error",
          });
        }
      }

      this.eventBus?.emit("tool.executed", {
        runId,
        toolName: "turn",
        agentName: currentAgent.name,
        latencyMs: 0,
        success: true,
        timestamp: Date.now(),
      });

      // Handoff
      if (turnResult.handoffTarget) {
        const targetAgent = this.agents.get(turnResult.handoffTarget);
        if (!targetAgent) {
          throw new Error(`Handoff target "${turnResult.handoffTarget}" not registered`);
        }

        handoffs.push({
          fromAgent: currentAgent.name,
          toAgent: turnResult.handoffTarget,
          reason: turnResult.handoffReason ?? "Agent handoff",
          turnNumber: turn + 1,
        });

        this.eventBus?.emit("handoff", {
          runId,
          fromAgent: currentAgent.name,
          toAgent: turnResult.handoffTarget,
          reason: turnResult.handoffReason ?? "Agent handoff",
          turnNumber: turn + 1,
          timestamp: Date.now(),
        });

        // Switch agent — rebuild system prompt
        currentAgent = targetAgent;
        const newInstructions = await currentAgent.getInstructions(ctx);
        messages[0] = { role: "system", content: newInstructions };
        continue;
      }

      // Finished
      if (turnResult.finished) {
        const totalLatencyMs = Date.now() - startTime;
        ctx.usage.latencyMs = totalLatencyMs;

        // Finalize tracing
        runSpan?.setAttribute("totalTurns", turn + 1);
        runSpan?.setAttribute("totalCostUsd", ctx.usage.totalCostUsd);
        runSpan?.setAttribute("totalLatencyMs", totalLatencyMs);
        runSpan?.end();
        if (trace) await this.tracer?.endAndExport(trace);

        const outputParts = this.extractOutputParts(turnResult.newMessages);

        const result: RunResult = {
          output: turnResult.output ?? "",
          outputParts: outputParts.length > 0 ? outputParts : undefined,
          messages,
          usage: { ...ctx.usage },
          handoffs,
          guardrailResults: allGuardrailResults,
          traceId,
          sessionId: input.sessionId,
          finalAgent: currentAgent.name,
          runId,
          totalTurns: turn + 1,
        };

        await finalize("completed", currentAgent.name, turn + 1, ctx.usage);

        runLogger.info("run completed", {
          totalTurns: turn + 1,
          duration: totalLatencyMs,
          costUsd: ctx.usage.totalCostUsd,
        });

        this.eventBus?.emit("run.completed", {
          runId,
          agentName: currentAgent.name,
          totalTurns: turn + 1,
          totalCostUsd: ctx.usage.totalCostUsd,
          totalLatencyMs,
          sessionId: input.sessionId,
          traceId,
          timestamp: Date.now(),
        });

        return result;
      }
    }

    // Max turns reached — finalize tracing
    const lastMessage = messages[messages.length - 1];
    const totalLatencyMs = Date.now() - startTime;
    ctx.usage.latencyMs = totalLatencyMs;

    runSpan?.setAttribute("totalTurns", maxTurns);
    runSpan?.setAttribute("totalCostUsd", ctx.usage.totalCostUsd);
    runSpan?.setAttribute("totalLatencyMs", totalLatencyMs);
    runSpan?.addEvent("max_turns_reached");
    runSpan?.end();
    if (trace) await this.tracer?.endAndExport(trace);

    const result: RunResult = {
      output: extractText(lastMessage?.content ?? ""),
      messages,
      usage: { ...ctx.usage },
      handoffs,
      guardrailResults: allGuardrailResults,
      traceId,
      sessionId: input.sessionId,
      finalAgent: currentAgent.name,
      runId,
      totalTurns: maxTurns,
    };

    await finalize("max_turns", currentAgent.name, maxTurns, ctx.usage);

    runLogger.warn("run hit max turns", { maxTurns, duration: totalLatencyMs });

    this.eventBus?.emit("run.completed", {
      runId,
      agentName: currentAgent.name,
      totalTurns: maxTurns,
      totalCostUsd: ctx.usage.totalCostUsd,
      totalLatencyMs,
      sessionId: input.sessionId,
      traceId,
      timestamp: Date.now(),
    });

    return result;
  }

  /** Stream events from an agent run — yields events during the turn loop */
  async *stream(agent: Agent, input: RunConfig): AsyncGenerator<StreamEvent> {
    const provider = this.provider;
    if (!provider) {
      throw new Error(
        "No LLM provider configured. Call setProvider() or pass provider in constructor.",
      );
    }

    this.agents.set(agent.name, agent);

    const runId = createRunId();
    const traceId = createTraceId();
    const maxTurns = input.maxTurns ?? agent.getMaxTurns() ?? this.config.defaultMaxTurns ?? 25;

    const ctx = createRunContext({
      runId,
      agentName: agent.name,
      sessionId: input.sessionId,
      traceId,
      signal: input.signal,
      metadata: input.metadata,
    });

    // Configure tool selection
    this.configureToolSelection(agent);

    const messages: ChatMessage[] = [];
    const instructions = await agent.getInstructions(ctx);
    messages.push({ role: "system", content: instructions });
    if (input.messages) messages.push(...input.messages);
    messages.push({ role: "user", content: input.input });

    // Inject harness tools if configured
    const streamHarnessTools = this.buildHarnessTools(input.harness);
    if (streamHarnessTools.length > 0) {
      for (const tool of streamHarnessTools) {
        agent.addTool(tool);
      }
    }

    // Inject execute_code tool if code execution enabled
    if (this.config.enableCodeExecution) {
      agent.addTool(createExecuteCodeTool(agent.getTools()));
    }

    let currentAgent = agent;
    const handoffs: HandoffRecord[] = [];
    const allGuardrailResults: GuardrailResult[] = [];
    const startTime = Date.now();

    // Resolve context management
    const streamCtxManager = this.resolveContextManager(currentAgent);
    const streamContextBudget = this.resolveContextBudget(
      currentAgent,
      currentAgent.config.contextConfig,
    );
    const streamContextStrategy = currentAgent.config.contextConfig?.strategy ?? "sliding-window";

    for (let turn = 0; turn < maxTurns; turn++) {
      if (input.signal?.aborted) throw new Error("Run aborted");

      ctx.turnNumber = turn + 1;
      ctx.agentName = currentAgent.name;

      // Trim context before LLM call
      if (streamCtxManager && streamContextBudget > 0) {
        const originalCount = messages.length;
        const originalTokens = streamCtxManager.getTokenCount(messages);
        const toolTokens = this.estimateToolTokens(currentAgent);
        const availableForMessages = streamContextBudget - toolTokens;
        if (availableForMessages > 0) {
          const trimmed = await streamCtxManager.trimToFit(
            messages,
            availableForMessages,
            streamContextStrategy,
          );
          if (trimmed !== messages) {
            if (trimmed.length < originalCount) {
              this.eventBus?.emit("context.trimmed", {
                runId,
                agentName: currentAgent.name,
                strategy: streamContextStrategy,
                originalTokens,
                trimmedTokens: streamCtxManager.getTokenCount(trimmed),
                messagesRemoved: originalCount - trimmed.length,
                turnNumber: ctx.turnNumber,
                timestamp: Date.now(),
              });
            }
            messages.length = 0;
            messages.push(...trimmed);
          }
        }
      }

      const handoffToolDefs = this.buildHandoffTools(currentAgent);
      const guardrails = currentAgent.config.guardrails ?? [];

      const turnResult = await this.turnExecutor.executeTurn(
        currentAgent,
        messages,
        provider,
        ctx,
        guardrails,
        handoffToolDefs,
      );

      messages.push(...turnResult.newMessages);
      allGuardrailResults.push(...turnResult.guardrailResults);

      // Yield tool call start events from assistant message
      for (const msg of turnResult.newMessages) {
        if (msg.role === "assistant" && msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            yield {
              type: "tool_call_start" as const,
              toolName: tc.name,
              agentName: currentAgent.name,
              input: tc.input,
            };
          }
        }
      }

      // Yield tool call end events from tool result messages
      for (const msg of turnResult.newMessages) {
        if (msg.role === "tool" && msg.toolResults) {
          for (const tr of msg.toolResults) {
            yield {
              type: "tool_call_end" as const,
              toolName: tr.name,
              agentName: currentAgent.name,
              output: tr.output,
            };
          }
        }
      }

      // Fallback: tool messages without toolResults
      for (const msg of turnResult.newMessages) {
        if (msg.role === "tool" && !msg.toolResults) {
          yield {
            type: "tool_call_end" as const,
            toolName: "tool",
            agentName: currentAgent.name,
            output: extractText(msg.content),
          };
        }
      }

      // Yield turn complete
      yield { type: "turn_complete" as const, agentName: currentAgent.name, turnNumber: turn + 1 };

      // Handoff
      if (turnResult.handoffTarget) {
        const targetAgent = this.agents.get(turnResult.handoffTarget);
        if (!targetAgent)
          throw new Error(`Handoff target "${turnResult.handoffTarget}" not registered`);

        const handoffReason = turnResult.handoffReason ?? "Agent handoff";

        handoffs.push({
          fromAgent: currentAgent.name,
          toAgent: turnResult.handoffTarget,
          reason: handoffReason,
          turnNumber: turn + 1,
        });

        yield {
          type: "handoff" as const,
          fromAgent: currentAgent.name,
          toAgent: turnResult.handoffTarget,
          reason: handoffReason,
        };

        currentAgent = targetAgent;
        const newInstructions = await currentAgent.getInstructions(ctx);
        messages[0] = { role: "system", content: newInstructions };
        continue;
      }

      // Yield text content
      if (turnResult.output) {
        yield { type: "text_delta", content: turnResult.output, agentName: currentAgent.name };
      }

      // Yield multi-modal content parts from assistant messages
      for (const msg of turnResult.newMessages) {
        if (msg.role === "assistant" && isMultiModalContent(msg.content)) {
          for (const part of msg.content) {
            if (part.type === "image") {
              yield { type: "image_output", image: part, agentName: currentAgent.name };
            } else if (part.type === "audio") {
              yield { type: "audio_output", audio: part, agentName: currentAgent.name };
            } else if (part.type === "video") {
              yield { type: "video_output", video: part, agentName: currentAgent.name };
            } else if (part.type === "ui_artifact") {
              yield { type: "ui_artifact", artifact: part, agentName: currentAgent.name };
            }
          }
        }
      }

      // Finished
      if (turnResult.finished) {
        const totalLatencyMs = Date.now() - startTime;
        ctx.usage.latencyMs = totalLatencyMs;

        const streamOutputParts = this.extractOutputParts(turnResult.newMessages);

        const result: RunResult = {
          output: turnResult.output ?? "",
          outputParts: streamOutputParts.length > 0 ? streamOutputParts : undefined,
          messages,
          usage: { ...ctx.usage },
          handoffs,
          guardrailResults: allGuardrailResults,
          traceId,
          sessionId: input.sessionId,
          finalAgent: currentAgent.name,
          runId,
          totalTurns: turn + 1,
        };

        yield { type: "run_complete", result };
        return;
      }
    }

    // Max turns reached
    const lastMessage = messages[messages.length - 1];
    const totalLatencyMs = Date.now() - startTime;
    ctx.usage.latencyMs = totalLatencyMs;

    const result: RunResult = {
      output: extractText(lastMessage?.content ?? ""),
      messages,
      usage: { ...ctx.usage },
      handoffs,
      guardrailResults: allGuardrailResults,
      traceId,
      sessionId: input.sessionId,
      finalAgent: currentAgent.name,
      runId,
      totalTurns: maxTurns,
    };

    yield { type: "run_complete", result };
  }

  /** Resolve context manager from agent config or runner config */
  private resolveContextManager(agent: Agent): ContextManager | undefined {
    if (this.contextManager) return this.contextManager;

    const contextConfig = agent.config.contextConfig;
    if (!contextConfig) return undefined;

    return new ContextManager({
      tokenCounterStrategy: contextConfig.tokenCounterStrategy,
      summarization:
        contextConfig.strategy === "smart-summary"
          ? {
              provider: this.provider,
              model: contextConfig.summaryModel,
            }
          : undefined,
      keepRecentTurns: contextConfig.keepRecentTurns,
    });
  }

  /** Resolve context budget from agent config, model catalog, or defaults */
  private resolveContextBudget(agent: Agent, contextConfig?: ContextConfig): number {
    if (!contextConfig) return 0;

    // 1. Explicit fixed budget (highest priority)
    if (contextConfig.maxContextTokens) return contextConfig.maxContextTokens;

    // 2. Determine model's context window
    let modelWindow = this.modelContextWindow;

    // 3. If not set, try to look up from model catalog
    if (!modelWindow) {
      const modelId =
        typeof agent.config.model === "string" ? agent.config.model : agent.config.model?.model;
      if (modelId) {
        modelWindow = this.lookupModelContextWindow(modelId);
      }
    }

    // 4. Fallback: 128K (safe for modern models)
    modelWindow ??= 128_000;

    const ratio = contextConfig.contextBudgetRatio ?? 0.85;
    return Math.floor(modelWindow * ratio);
  }

  /** Look up model context window from catalog */
  private lookupModelContextWindow(modelId: string): number | undefined {
    if (!this.modelCatalog) return undefined;
    const model = this.modelCatalog.find(
      (m) => m.modelId === modelId || m.aliases?.includes(modelId),
    );
    return model?.contextWindowInput;
  }

  /** Estimate total tokens for all tool definitions */
  private estimateToolTokens(agent: Agent): number {
    const tools = agent.getTools();
    if (tools.length === 0) return 0;

    let total = 0;
    for (const tool of tools) {
      total += this.tokenCounter.countText(tool.name);
      total += this.tokenCounter.countText(tool.description);
      total += this.tokenCounter.countText(JSON.stringify(tool.inputSchema ?? {}));
      total += 10; // framing overhead
    }
    return total;
  }

  /** Configure tool selection for an agent's turn executor */
  private configureToolSelection(agent: Agent): void {
    const toolSelectionConfig = agent.config.toolSelection;
    if (toolSelectionConfig && toolSelectionConfig.strategy !== "all") {
      this.turnExecutor.setToolSelector(new ToolSelector(toolSelectionConfig));
    }
  }

  /** Extract non-text content parts from the final assistant message */
  private extractOutputParts(messages: ChatMessage[]): ContentPart[] {
    const parts: ContentPart[] = [];
    for (const msg of messages) {
      if (msg.role === "assistant" && isMultiModalContent(msg.content)) {
        for (const part of msg.content) {
          if (part.type !== "text") {
            parts.push(part);
          }
        }
      }
    }
    return parts;
  }

  /** Build harness tools (progress + notes) if configured */
  // biome-ignore lint/suspicious/noExplicitAny: typed tools need widening
  private buildHarnessTools(harness?: HarnessConfig): ToolDef<any, any>[] {
    if (!harness) return [];
    // biome-ignore lint/suspicious/noExplicitAny: typed tools need widening
    const tools: ToolDef<any, any>[] = [];

    if (harness.enableProgress) {
      const tracker = new ProgressTracker();
      if (harness.features) {
        tracker.addFeatures(harness.features);
      }
      tools.push(createProgressTool(tracker));
    }

    if (harness.enableNotes) {
      const store = new NotesStore();
      tools.push(createWriteNoteTool(store));
      tools.push(createReadNotesTool(store));
    }

    return tools;
  }

  private buildHandoffTools(agent: Agent): LLMToolDefinition[] {
    const handoffs = agent.getHandoffs();
    if (handoffs.length === 0) return [];

    return handoffs.map((h) => {
      const targetName = typeof h.agent === "string" ? h.agent : h.agent.name;
      return {
        name: `${HANDOFF_PREFIX}${targetName}`,
        description: h.description,
        inputSchema: {
          type: "object",
          properties: {
            reason: {
              type: "string",
              description: "Reason for the handoff",
            },
          },
        },
      };
    });
  }
}
