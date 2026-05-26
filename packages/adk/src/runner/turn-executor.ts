// ──────────────────────────────────────────────────────
// ADK Turn Executor
// ──────────────────────────────────────────────────────
// Executes a single turn: LLM call → process tool calls → return result
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import { extractText } from "../content/helpers";
import type { ADKEventBus } from "../events/event-bus";
import { GuardrailEngine } from "../guardrails/engine";
import { ensureJsonSchema } from "../output/structured-output";
import type { ToolRegistry } from "../tools/tool-registry";
import type { ToolSelector } from "../tools/tool-selector";
import type { Trace } from "../tracing/tracer";
import type { GuardrailConfig } from "../types/guardrail";
import type {
  ADKLLMProvider,
  ChatMessage,
  ChatParamsWithTools,
  ChatResponseWithToolCalls,
  LLMToolDefinition,
} from "../types/llm";
import type { RunContext, StreamEvent } from "../types/runner";
import type { ToolContext, ToolDef } from "../types/tool";
import { addUsage } from "./context";

/** Result of a single turn */
export interface TurnResult {
  /** New messages produced this turn (assistant response + tool results) */
  newMessages: ChatMessage[];
  /** Whether the agent has finished (no tool calls, text response) */
  finished: boolean;
  /** Text output (if finished) */
  output?: string;
  /** Handoff target (if handoff tool was called) */
  handoffTarget?: string;
  /** Handoff reason */
  handoffReason?: string;
  /** Guardrail results from this turn */
  guardrailResults: import("../types/guardrail").GuardrailResult[];
}

/** Handoff tool prefix */
const HANDOFF_PREFIX = "transfer_to_";

export class TurnExecutor {
  private guardrailEngine = new GuardrailEngine();
  private toolSelector?: ToolSelector;
  private eventBus?: ADKEventBus;
  private toolRegistry?: ToolRegistry;
  private currentTrace?: Trace;

  /** Set a tool selector for dynamic per-turn tool filtering */
  setToolSelector(selector: ToolSelector): void {
    this.toolSelector = selector;
  }

  /** Set event bus for observability */
  setEventBus(eventBus: ADKEventBus): void {
    this.eventBus = eventBus;
  }

  /** Set tool registry for deferred tool loading */
  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /** Set trace for span-based tracing */
  setTrace(trace?: Trace): void {
    this.currentTrace = trace;
  }

  /**
   * Execute a single turn.
   * @param agent The current agent
   * @param messages All messages so far (including system)
   * @param provider The LLM provider to use
   * @param ctx The run context
   * @param onEvent Optional stream event callback
   */
  async executeTurn(
    agent: Agent,
    messages: ChatMessage[],
    provider: ADKLLMProvider,
    ctx: RunContext,
    guardrails: GuardrailConfig[],
    handoffToolDefs?: LLMToolDefinition[],
    onEvent?: (event: StreamEvent) => void,
  ): Promise<TurnResult> {
    const allGuardrailResults: import("../types/guardrail").GuardrailResult[] = [];

    // Build tool definitions for LLM (with optional per-turn filtering)
    const tools = this.buildToolDefs(agent, messages, ctx, handoffToolDefs);

    // Build params
    const systemMsg = messages.find((m) => m.role === "system");
    const params: ChatParamsWithTools = {
      messages: messages.filter((m) => m.role !== "system"),
      systemPrompt: systemMsg ? extractText(systemMsg.content) : undefined,
      tools: tools.length > 0 ? tools : undefined,
    };

    // Add model config
    const modelConfig = agent.config.model;
    if (typeof modelConfig === "string") {
      params.model = modelConfig;
    } else if (modelConfig && typeof modelConfig === "object") {
      params.model = modelConfig.model;
      params.temperature = modelConfig.temperature;
      params.maxTokens = modelConfig.maxTokens;
    }

    // Call LLM with tracing
    const llmSpan = this.currentTrace?.startSpan("llm", "llm");
    llmSpan?.setAttribute("model", params.model ?? "default");

    const llmStart = Date.now();
    const response = await provider.chatWithTools(params);
    const llmLatencyMs = Date.now() - llmStart;

    llmSpan?.setAttributes({
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.costUsd,
      latencyMs: llmLatencyMs,
    });
    llmSpan?.end();

    // Track usage
    addUsage(ctx.usage, {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.costUsd,
      latencyMs: response.latencyMs,
    });

    // Emit cost event for observability and budget tracking
    this.eventBus?.emit("llm.call.completed", {
      callId: `${ctx.runId}-turn-${ctx.turnNumber}`,
      providerId: response.providerId ?? "unknown",
      model: response.model ?? params.model ?? "unknown",
      agentSlug: ctx.agentName,
      taskId: (ctx.metadata?.taskId as string) ?? undefined,
      inputTokens: response.inputTokens ?? 0,
      outputTokens: response.outputTokens ?? 0,
      costUsd: response.costUsd ?? 0,
      latencyMs: llmLatencyMs,
      ttfbMs: response.ttfbMs,
      timestamp: Date.now(),
    });

    // Process response
    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: response.content,
      toolCalls: response.toolCalls,
    };

    // No tool calls → agent is done
    if (!response.toolCalls || response.toolCalls.length === 0) {
      // Run output guardrails with tracing
      const guardrailSpan =
        guardrails.length > 0
          ? this.currentTrace?.startSpan("output-guardrails", "guardrail")
          : undefined;

      const outputResults = await this.guardrailEngine.runOutputGuardrails(
        response.content,
        [...messages, assistantMessage],
        ctx,
        guardrails,
      );
      allGuardrailResults.push(...outputResults);

      if (guardrailSpan) {
        const allPassed = outputResults.every((r) => r.passed);
        guardrailSpan.setAttribute("guardrailCount", outputResults.length);
        guardrailSpan.setAttribute("passed", allPassed);
        for (const r of outputResults) {
          guardrailSpan.addEvent(r.name, { passed: r.passed, severity: r.severity });
        }
        guardrailSpan.end();
      }

      onEvent?.({ type: "text_delta", content: response.content, agentName: ctx.agentName });

      return {
        newMessages: [assistantMessage],
        finished: true,
        output: response.content,
        guardrailResults: allGuardrailResults,
      };
    }

    // Check for handoff first (handoffs take priority)
    for (const toolCall of response.toolCalls) {
      if (toolCall.name.startsWith(HANDOFF_PREFIX)) {
        const targetAgent = toolCall.name.slice(HANDOFF_PREFIX.length);
        const reason =
          typeof toolCall.input === "object" && toolCall.input !== null
            ? (((toolCall.input as Record<string, unknown>).reason as string) ?? "Agent handoff")
            : "Agent handoff";

        onEvent?.({
          type: "handoff",
          fromAgent: ctx.agentName,
          toAgent: targetAgent,
          reason,
        });

        return {
          newMessages: [assistantMessage],
          finished: false,
          handoffTarget: targetAgent,
          handoffReason: reason,
          guardrailResults: allGuardrailResults,
        };
      }
    }

    // Execute all non-handoff tool calls in parallel
    const toolResultMessages: ChatMessage[] = [];
    const nonHandoffCalls = response.toolCalls.filter((tc) => !tc.name.startsWith(HANDOFF_PREFIX));

    const toolCallResults = await Promise.all(
      nonHandoffCalls.map((toolCall) =>
        this.executeToolCall(agent, toolCall, ctx, guardrails, onEvent),
      ),
    );

    for (const result of toolCallResults) {
      allGuardrailResults.push(...result.guardrailResults);
      toolResultMessages.push(result.message);
    }

    return {
      newMessages: [assistantMessage, ...toolResultMessages],
      finished: false,
      guardrailResults: allGuardrailResults,
    };
  }

  /** Execute a single tool call with timeout and retry support */
  private async executeToolCall(
    agent: Agent,
    toolCall: { id: string; name: string; input: unknown },
    ctx: RunContext,
    guardrails: GuardrailConfig[],
    onEvent?: (event: StreamEvent) => void,
  ): Promise<{
    message: ChatMessage;
    guardrailResults: import("../types/guardrail").GuardrailResult[];
  }> {
    const guardrailResults: import("../types/guardrail").GuardrailResult[] = [];

    // Find tool — check agent tools first, then registry for deferred tools
    let toolDef: ToolDef | undefined = agent.getTools().find((t) => t.name === toolCall.name);
    if (!toolDef && this.toolRegistry) {
      const deferred = this.toolRegistry.load(toolCall.name);
      if (deferred) toolDef = deferred;
    }
    if (!toolDef) {
      return {
        message: {
          role: "tool",
          content: `Error: Unknown tool "${toolCall.name}"`,
          toolResults: [
            {
              toolCallId: toolCall.id,
              name: toolCall.name,
              output: `Error: Unknown tool "${toolCall.name}"`,
              isError: true,
            },
          ],
        },
        guardrailResults,
      };
    }

    // Run tool guardrails with tracing
    const toolGuardrailSpan =
      guardrails.length > 0
        ? this.currentTrace?.startSpan(`tool-guardrails:${toolCall.name}`, "guardrail")
        : undefined;

    const gResults = await this.guardrailEngine.runToolGuardrails(
      toolCall.name,
      toolCall.input,
      ctx,
      guardrails,
    );
    guardrailResults.push(...gResults);

    if (toolGuardrailSpan) {
      const allPassed = gResults.every((r) => r.passed);
      toolGuardrailSpan.setAttribute("guardrailName", `tool-guardrails:${toolCall.name}`);
      toolGuardrailSpan.setAttribute("passed", allPassed);
      for (const r of gResults) {
        toolGuardrailSpan.addEvent(r.name, { passed: r.passed, severity: r.severity });
      }
      toolGuardrailSpan.end();
    }

    onEvent?.({
      type: "tool_call_start",
      toolName: toolCall.name,
      agentName: ctx.agentName,
      input: toolCall.input,
    });

    // Create tool span for tracing
    const toolSpan = this.currentTrace?.startSpan(`tool:${toolCall.name}`, "tool");
    toolSpan?.setAttribute("toolName", toolCall.name);

    const maxAttempts = (toolDef.retries ?? 0) + 1;
    const timeoutMs = toolDef.timeoutMs ?? 30_000;
    let lastError: string | undefined;
    const toolStart = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const toolCtx: ToolContext = {
          runContext: ctx,
          toolCallId: toolCall.id,
          agentName: ctx.agentName,
        };

        // Run pre-hook
        let currentInput = toolCall.input;
        if (toolDef.hooks?.preExecute) {
          const hookResult = await toolDef.hooks.preExecute(currentInput, toolCtx);
          if (!hookResult.allow) {
            toolSpan?.setAttribute("success", false);
            toolSpan?.setAttribute("blocked", true);
            toolSpan?.setAttribute("latencyMs", Date.now() - toolStart);
            toolSpan?.end();
            return {
              message: {
                role: "tool",
                content: `Tool blocked: ${hookResult.reason ?? "pre-hook rejected"}`,
                toolResults: [
                  {
                    toolCallId: toolCall.id,
                    name: toolCall.name,
                    output: `Tool blocked: ${hookResult.reason ?? "pre-hook rejected"}`,
                    isError: true,
                  },
                ],
              },
              guardrailResults,
            };
          }
          if (hookResult.modifiedInput !== undefined) {
            currentInput = hookResult.modifiedInput;
          }
        }

        // Execute with timeout
        let output = await this.withTimeout(
          toolDef.execute(currentInput as never, toolCtx),
          timeoutMs,
          toolCall.name,
        );

        // Run post-hook
        if (toolDef.hooks?.postExecute) {
          const hookResult = await toolDef.hooks.postExecute(currentInput, output, toolCtx);
          if (hookResult.modifiedOutput !== undefined) {
            output = hookResult.modifiedOutput as typeof output;
          }
        }

        const outputStr = typeof output === "string" ? output : JSON.stringify(output);

        toolSpan?.setAttribute("success", true);
        toolSpan?.setAttribute("latencyMs", Date.now() - toolStart);
        toolSpan?.end();

        onEvent?.({
          type: "tool_call_end",
          toolName: toolCall.name,
          agentName: ctx.agentName,
          output,
        });

        return {
          message: {
            role: "tool",
            content: outputStr,
            toolResults: [{ toolCallId: toolCall.id, name: toolCall.name, output }],
          },
          guardrailResults,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt < maxAttempts - 1) {
          // Exponential backoff before retry
          await new Promise((r) => setTimeout(r, 2 ** attempt * 100));
        }
      }
    }

    // All attempts failed
    toolSpan?.setAttribute("success", false);
    toolSpan?.setAttribute("latencyMs", Date.now() - toolStart);
    toolSpan?.setError(lastError ?? "Unknown error");
    toolSpan?.end();

    return {
      message: {
        role: "tool",
        content: `Error: ${lastError}`,
        toolResults: [
          {
            toolCallId: toolCall.id,
            name: toolCall.name,
            output: lastError ?? "Unknown error",
            isError: true,
          },
        ],
      },
      guardrailResults,
    };
  }

  /** Run a promise with a timeout */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      promise.then(
        (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }

  private buildToolDefs(
    agent: Agent,
    messages: ChatMessage[],
    ctx: RunContext,
    handoffToolDefs?: LLMToolDefinition[],
  ): LLMToolDefinition[] {
    let agentTools = agent.getTools();

    // Apply dynamic tool selection if configured
    const totalToolCount = agentTools.length;
    if (this.toolSelector) {
      const recentToolCalls = this.extractRecentToolCalls(messages);
      agentTools = this.toolSelector.selectTools(
        agentTools,
        messages,
        ctx.turnNumber,
        recentToolCalls,
      );

      this.eventBus?.emit("tools.selected", {
        runId: ctx.runId,
        agentName: ctx.agentName,
        totalTools: totalToolCount,
        selectedTools: agentTools.length,
        selectedNames: agentTools.map((t) => t.name),
        strategy: "keyword",
        turnNumber: ctx.turnNumber,
        timestamp: Date.now(),
      });
    }

    const tools: LLMToolDefinition[] = [];

    // Agent tools (potentially filtered)
    for (const tool of agentTools) {
      const def: LLMToolDefinition = {
        name: tool.name,
        description: tool.description,
        inputSchema: ensureJsonSchema(tool.inputSchema) as Record<string, unknown>,
      };
      // Include examples if present (helps LLM accuracy)
      if (tool.examples && tool.examples.length > 0) {
        (def as any).examples = tool.examples.map((ex) => ({
          input: ex.input,
          ...(ex.description ? { description: ex.description } : {}),
        }));
      }
      tools.push(def);
    }

    // Handoff tools are NEVER filtered — always appended
    if (handoffToolDefs) {
      tools.push(...handoffToolDefs);
    }

    return tools;
  }

  /** Extract tool names from recent tool call messages */
  private extractRecentToolCalls(messages: ChatMessage[]): string[] {
    const toolNames: string[] = [];
    // Look at recent messages for tool calls
    const recent = messages.slice(-10);
    for (const msg of recent) {
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (!tc.name.startsWith("transfer_to_")) {
            toolNames.push(tc.name);
          }
        }
      }
    }
    return [...new Set(toolNames)];
  }
}
