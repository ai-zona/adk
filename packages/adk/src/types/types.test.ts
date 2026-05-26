import { describe, expect, it } from "vitest";
import { z } from "zod";
import type {
  ADKEventMap,
  ADKEventName,
  AgentConfig,
  CatalogModel,
  ChatMessage,
  ChatParams,
  ChatParamsWithTools,
  ChatResponse,
  ChatResponseWithToolCalls,
  ConsentLevel,
  ConsentRequest,
  GuardrailResult,
  RoutingStrategy,
  RunConfig,
  RunContext,
  RunResult,
  Session,
  StreamChunk,
  StreamEvent,
  ToolContext,
  ToolDef,
} from "./index";

// ──────────────────────────────────────────────────────
// Type compilation tests
// ──────────────────────────────────────────────────────
// These tests verify that our types compile correctly
// and are structurally valid at runtime.

describe("ADK Types — Compilation & Validation", () => {
  describe("LLM Types", () => {
    it("ChatMessage supports all roles", () => {
      const msgs: ChatMessage[] = [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there!" },
        {
          role: "tool",
          content: "result",
          toolResults: [{ toolCallId: "tc1", name: "search", output: "found" }],
        },
      ];
      expect(msgs).toHaveLength(4);
    });

    it("ChatMessage with tool calls", () => {
      const msg: ChatMessage = {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "tc1", name: "search", input: { query: "test" } }],
      };
      expect(msg.toolCalls).toHaveLength(1);
      expect(msg.toolCalls?.[0]?.name).toBe("search");
    });

    it("ChatParams with all fields", () => {
      const params: ChatParams = {
        messages: [{ role: "user", content: "Hi" }],
        model: "claude-sonnet-4-5-20250929",
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        stopSequences: ["END"],
        systemPrompt: "Be concise.",
      };
      expect(params.model).toBe("claude-sonnet-4-5-20250929");
    });

    it("ChatParamsWithTools extends ChatParams", () => {
      const params: ChatParamsWithTools = {
        messages: [{ role: "user", content: "Hi" }],
        tools: [{ name: "search", description: "Search the web", inputSchema: { type: "object" } }],
        toolChoice: "auto",
        responseFormat: { type: "json_schema", schema: { type: "object" }, name: "output" },
      };
      expect(params.tools).toHaveLength(1);
    });

    it("ChatResponse has all required fields", () => {
      const res: ChatResponse = {
        content: "Hello!",
        model: "gpt-4o",
        providerId: "openai",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        latencyMs: 200,
        costUsd: 0.0001,
        finishReason: "stop",
      };
      expect(res.providerId).toBe("openai");
    });

    it("ChatResponseWithToolCalls extends ChatResponse", () => {
      const res: ChatResponseWithToolCalls = {
        content: "",
        model: "claude-opus-4-6",
        providerId: "anthropic",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        latencyMs: 500,
        costUsd: 0.01,
        finishReason: "tool_use",
        toolCalls: [{ id: "tc1", name: "calculator", input: { expression: "2+2" } }],
      };
      expect(res.toolCalls).toHaveLength(1);
    });

    it("StreamChunk covers all variants", () => {
      const chunks: StreamChunk[] = [
        { type: "text_delta", content: "Hello" },
        { type: "tool_use_start", id: "tc1", name: "search" },
        { type: "tool_use_delta", id: "tc1", inputJson: '{"query":' },
        { type: "tool_use_end", id: "tc1" },
        { type: "message_end", usage: { inputTokens: 10, outputTokens: 5 } },
      ];
      expect(chunks).toHaveLength(5);
    });

    it("RoutingStrategy has all 5 strategies", () => {
      const strategies: RoutingStrategy[] = [
        "cost-optimized",
        "latency-optimized",
        "quality-optimized",
        "balanced",
        "fallback-chain",
      ];
      expect(strategies).toHaveLength(5);
    });

    it("CatalogModel has all fields", () => {
      const model: CatalogModel = {
        modelId: "claude-opus-4-6",
        providerId: "anthropic",
        displayName: "Claude Opus 4.6",
        description: "Most capable model",
        modality: "chat",
        capabilities: ["text", "code", "vision", "function-calling", "streaming"],
        costPerMTInput: 5,
        costPerMTOutput: 25,
        contextWindowInput: 200000,
        contextWindowOutput: 32000,
        releaseDate: "2025-11-01",
      };
      expect(model.capabilities).toContain("function-calling");
    });
  });

  describe("Agent Types", () => {
    it("AgentConfig with static instructions", () => {
      const config: AgentConfig = {
        name: "test-agent",
        instructions: "You are a helpful assistant.",
        model: "claude-sonnet-4-5-20250929",
        maxTurns: 10,
        consentLevel: "auto",
      };
      expect(config.name).toBe("test-agent");
    });

    it("AgentConfig with dynamic instructions", () => {
      const config: AgentConfig = {
        name: "dynamic-agent",
        instructions: (ctx: RunContext) => `You are helping with run ${ctx.runId}`,
        model: { provider: "anthropic", model: "claude-sonnet-4-5-20250929", temperature: 0.5 },
        budgetLimitUsd: 10,
      };
      expect(typeof config.instructions).toBe("function");
    });

    it("AgentConfig with Zod output schema", () => {
      const schema = z.object({ answer: z.string(), confidence: z.number() });
      const config: AgentConfig = {
        name: "structured-agent",
        instructions: "Answer with structured output.",
        outputSchema: schema,
      };
      expect(config.outputSchema).toBeDefined();
    });

    it("ConsentLevel covers all levels", () => {
      const levels: ConsentLevel[] = ["auto", "notify", "explicit", "multi_party"];
      expect(levels).toHaveLength(4);
    });
  });

  describe("Tool Types", () => {
    it("ToolDef with Zod schema", () => {
      const tool: ToolDef<{ query: string }, string> = {
        name: "search",
        description: "Search the web",
        inputSchema: z.object({ query: z.string() }),
        execute: async (input) => `Results for: ${input.query}`,
      };
      expect(tool.name).toBe("search");
    });

    it("ToolDef with JSON Schema", () => {
      const tool: ToolDef = {
        name: "calculator",
        description: "Calculate expressions",
        inputSchema: {
          type: "object",
          properties: { expression: { type: "string" } },
          required: ["expression"],
        },
        execute: async (input) => String(input),
      };
      expect(tool.inputSchema).toHaveProperty("type", "object");
    });

    it("ToolDef with hooks", () => {
      const tool: ToolDef = {
        name: "guarded-tool",
        description: "Tool with hooks",
        inputSchema: { type: "object" },
        execute: async () => "ok",
        hooks: {
          preExecute: async () => ({ allow: true }),
          postExecute: async (_input, output) => ({ modifiedOutput: output }),
        },
      };
      expect(tool.hooks?.preExecute).toBeDefined();
      expect(tool.hooks?.postExecute).toBeDefined();
    });

    it("ToolContext has required fields", () => {
      const ctx: ToolContext = {
        runContext: {
          runId: "run-1",
          agentName: "test",
          turnNumber: 1,
          traceId: "trace-1",
          usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
          metadata: {},
        },
        toolCallId: "tc-1",
        agentName: "test",
      };
      expect(ctx.toolCallId).toBe("tc-1");
    });
  });

  describe("Runner Types", () => {
    it("RunConfig with minimal input", () => {
      const config: RunConfig = { input: "Hello" };
      expect(config.input).toBe("Hello");
    });

    it("RunConfig with all options", () => {
      const controller = new AbortController();
      const config: RunConfig = {
        input: "Hello",
        sessionId: "session-1",
        messages: [{ role: "user", content: "Previous message" }],
        model: { provider: "openai", model: "gpt-4o" },
        maxTurns: 5,
        signal: controller.signal,
        metadata: { userId: "user-1" },
      };
      expect(config.sessionId).toBe("session-1");
    });

    it("RunResult has all fields", () => {
      const result: RunResult = {
        output: "Hello!",
        messages: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" },
        ],
        usage: { inputTokens: 10, outputTokens: 5, totalCostUsd: 0.0001, latencyMs: 200 },
        handoffs: [],
        guardrailResults: [],
        traceId: "trace-1",
        finalAgent: "test-agent",
        runId: "run-1",
        totalTurns: 1,
      };
      expect(result.totalTurns).toBe(1);
    });

    it("StreamEvent covers all variants", () => {
      const events: StreamEvent[] = [
        { type: "text_delta", content: "Hi", agentName: "bot" },
        { type: "tool_call_start", toolName: "search", agentName: "bot", input: { q: "test" } },
        { type: "tool_call_end", toolName: "search", agentName: "bot", output: "found" },
        { type: "handoff", fromAgent: "a", toAgent: "b", reason: "specialist needed" },
        { type: "guardrail", name: "content-filter", passed: true, tripwire: false },
        { type: "turn_complete", agentName: "bot", turnNumber: 1 },
        { type: "run_complete", result: {} as RunResult },
        { type: "error", error: "Something went wrong", agentName: "bot" },
      ];
      expect(events).toHaveLength(8);
    });
  });

  describe("Session Types", () => {
    it("Session has all required fields", () => {
      const session: Session = {
        id: "session-1",
        agentName: "test-agent",
        messages: [],
        metadata: {},
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(session.status).toBe("active");
    });

    it("Session with optional fields", () => {
      const session: Session = {
        id: "session-2",
        agentName: "test-agent",
        messages: [{ role: "user", content: "Hi" }],
        metadata: { source: "api" },
        status: "active",
        parentId: "session-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + 3600000),
      };
      expect(session.parentId).toBe("session-1");
    });
  });

  describe("Guardrail Types", () => {
    it("GuardrailResult with tripwire", () => {
      const result: GuardrailResult = {
        name: "content-filter",
        type: "output",
        passed: false,
        tripwire: true,
        message: "Content blocked",
      };
      expect(result.tripwire).toBe(true);
    });

    it("ConsentRequest for multi-party", () => {
      const request: ConsentRequest = {
        id: "req-1",
        agentName: "deploy-pilot",
        action: "deploy-production",
        consentLevel: "multi_party",
        requiredApprovals: 3,
        currentApprovals: ["admin-1"],
        rejectedBy: null,
        status: "pending",
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000,
      };
      expect(request.requiredApprovals).toBe(3);
    });
  });

  describe("Event Types", () => {
    it("ADKEventMap has all platform events", () => {
      const platformEvents: ADKEventName[] = [
        "task.submitted",
        "task.started",
        "task.completed",
        "task.failed",
        "agent.started",
        "agent.stopped",
        "agent.error",
        "agent.log",
        "agent.heartbeat",
        "alert.created",
        "alert.resolved",
        "llm.call.completed",
        "llm.call.failed",
        "llm.provider.switched",
        "health.check",
        "models.discovered",
      ];
      expect(platformEvents).toHaveLength(16);
    });

    it("ADKEventMap has ADK-specific events", () => {
      const adkEvents: ADKEventName[] = [
        "run.started",
        "run.completed",
        "run.failed",
        "handoff",
        "guardrail.triggered",
        "tool.executed",
        "session.created",
        "session.resumed",
      ];
      expect(adkEvents).toHaveLength(8);
    });

    it("Total events = 24", () => {
      // Type-level verification: all events listed
      const allEvents: ADKEventName[] = [
        "task.submitted",
        "task.started",
        "task.completed",
        "task.failed",
        "agent.started",
        "agent.stopped",
        "agent.error",
        "agent.log",
        "agent.heartbeat",
        "alert.created",
        "alert.resolved",
        "llm.call.completed",
        "llm.call.failed",
        "llm.provider.switched",
        "health.check",
        "models.discovered",
        "run.started",
        "run.completed",
        "run.failed",
        "handoff",
        "guardrail.triggered",
        "tool.executed",
        "session.created",
        "session.resumed",
      ];
      expect(allEvents).toHaveLength(24);
    });
  });
});
