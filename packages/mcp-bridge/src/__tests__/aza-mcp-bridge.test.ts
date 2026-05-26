import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MCPAuditLogger } from "../audit/audit-logger";
import { AZAMCPBridge, type AZAToolRequest } from "../bridge/aza-mcp-bridge";
import type { MCPClientPool } from "../client/mcp-client-pool";
import type { ApprovalQueue } from "../grants/approval-queue";
import type { SkillGrantManager } from "../grants/skill-grants";
import type { CircuitBreaker } from "../safety/circuit-breaker";
import type { InputValidator } from "../safety/input-validator";
import type { OutputSanitizer } from "../safety/output-sanitizer";
import type { RateLimiter } from "../safety/rate-limiter";
import type { MCPServerConfig } from "../types";

// ──────────────────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────────────────

const validRequest: AZAToolRequest = {
  agentDid: "did:aza:testnet:agent-001",
  agentId: "agent-001",
  toolId: "tool-001",
  serverId: "server-001",
  toolName: "echo",
  arguments: { message: "hello" },
  correlationId: "corr-001",
};

const mockServerConfig: MCPServerConfig = {
  id: "server-001",
  name: "Test MCP Server",
  url: "http://localhost:3000",
  transport: "streamable-http",
  auth: { type: "none" },
};

function makeBridge(overrides?: {
  grants?: Partial<SkillGrantManager>;
  approvalQueue?: Partial<ApprovalQueue>;
  inputValidator?: Partial<InputValidator>;
  outputSanitizer?: Partial<OutputSanitizer>;
  rateLimiter?: Partial<RateLimiter>;
  circuitBreaker?: Partial<CircuitBreaker>;
  clientPool?: Partial<MCPClientPool>;
  auditLogger?: Partial<MCPAuditLogger>;
  serverConfigResolver?: (serverId: string) => Promise<MCPServerConfig | null>;
  onSafetyTelemetry?: ConstructorParameters<typeof AZAMCPBridge>[0]["onSafetyTelemetry"];
}) {
  const grants = {
    validateGrant: vi.fn().mockResolvedValue({ valid: true }),
    ...overrides?.grants,
  } as unknown as SkillGrantManager;

  const approvalQueue = {
    enqueue: vi.fn().mockResolvedValue({ id: "approval-001" }),
    waitForDecision: vi.fn().mockResolvedValue({ approved: true }),
    ...overrides?.approvalQueue,
  } as unknown as ApprovalQueue;

  const inputValidator = {
    validateInput: vi
      .fn()
      .mockReturnValue({ valid: true, errors: [], sanitizedInput: validRequest.arguments }),
    ...overrides?.inputValidator,
  } as unknown as InputValidator;

  const outputSanitizer = {
    sanitize: vi.fn().mockImplementation((data: unknown) => ({ sanitized: data, redactions: [] })),
    ...overrides?.outputSanitizer,
  } as unknown as OutputSanitizer;

  const rateLimiter = {
    checkAgentLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetMs: 1000 }),
    ...overrides?.rateLimiter,
  } as unknown as RateLimiter;

  const circuitBreaker = {
    canExecute: vi.fn().mockResolvedValue(true),
    recordSuccess: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    ...overrides?.circuitBreaker,
  } as unknown as CircuitBreaker;

  const mockClient = {
    callTool: vi.fn().mockResolvedValue({ success: true, data: { ok: true }, latencyMs: 5 }),
  };

  const clientPool = {
    acquire: vi.fn().mockResolvedValue(mockClient),
    release: vi.fn().mockResolvedValue(undefined),
    ...overrides?.clientPool,
  } as unknown as MCPClientPool;

  const auditLogger = {
    logInvocation: vi.fn().mockResolvedValue("audit-log-001"),
    ...overrides?.auditLogger,
  } as unknown as MCPAuditLogger;

  const bridge = new AZAMCPBridge({
    grants,
    approvalQueue,
    inputValidator,
    outputSanitizer,
    rateLimiter,
    circuitBreaker,
    clientPool,
    auditLogger,
    serverConfigResolver: overrides?.serverConfigResolver ?? (async () => mockServerConfig),
    onSafetyTelemetry: overrides?.onSafetyTelemetry,
  });

  return {
    bridge,
    mocks: {
      grants,
      approvalQueue,
      inputValidator,
      outputSanitizer,
      rateLimiter,
      circuitBreaker,
      clientPool,
      auditLogger,
      mockClient,
    },
  };
}

describe("AZAMCPBridge.invokeTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Test 1: Grant denial short-circuits pipeline ──────

  it("returns GRANT_DENIED without calling tool when grant check fails", async () => {
    const { bridge, mocks } = makeBridge({
      grants: {
        validateGrant: vi
          .fn()
          .mockResolvedValue({ valid: false, reason: "No grant for agent/tool pair" }),
      },
    });

    const result = await bridge.invokeTool(validRequest);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("GRANT_DENIED");
    expect(result.error?.message).toContain("No grant for agent/tool pair");
    // Downstream stages must NOT run when grant fails
    expect(mocks.circuitBreaker.canExecute).not.toHaveBeenCalled();
    expect(mocks.rateLimiter.checkAgentLimit).not.toHaveBeenCalled();
    expect(mocks.inputValidator.validateInput).not.toHaveBeenCalled();
    expect(mocks.mockClient.callTool).not.toHaveBeenCalled();
    // Audit log still records the denial
    expect(mocks.auditLogger.logInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PERMISSION_DENIED" }),
    );
  });

  // ── Test 2: Open circuit short-circuits ──────────────

  it("returns CIRCUIT_OPEN without calling tool when breaker is open", async () => {
    const { bridge, mocks } = makeBridge({
      circuitBreaker: {
        canExecute: vi.fn().mockResolvedValue(false),
        recordSuccess: vi.fn(),
        recordFailure: vi.fn(),
      },
    });

    const result = await bridge.invokeTool(validRequest);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("CIRCUIT_OPEN");
    expect(mocks.rateLimiter.checkAgentLimit).not.toHaveBeenCalled();
    expect(mocks.mockClient.callTool).not.toHaveBeenCalled();
    expect(mocks.auditLogger.logInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    );
  });

  // ── Test 3: Rate limit exceeded ──────────────────────

  it("returns RATE_LIMITED with retry-after hint when limiter denies", async () => {
    const { bridge, mocks } = makeBridge({
      rateLimiter: {
        checkAgentLimit: vi.fn().mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetMs: 1000,
          retryAfterMs: 750,
        }),
      },
    });

    const result = await bridge.invokeTool(validRequest);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("RATE_LIMITED");
    expect(result.error?.message).toContain("750ms");
    expect(mocks.inputValidator.validateInput).not.toHaveBeenCalled();
    expect(mocks.mockClient.callTool).not.toHaveBeenCalled();
    expect(mocks.auditLogger.logInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "RATE_LIMITED" }),
    );
  });

  // ── Test 4: Input validation failure ─────────────────

  it("returns VALIDATION_FAILED and never invokes tool when input is invalid", async () => {
    const { bridge, mocks } = makeBridge({
      inputValidator: {
        validateInput: vi.fn().mockReturnValue({
          valid: false,
          errors: ["arguments.message contains SQL injection pattern"],
        }),
      },
    });

    const result = await bridge.invokeTool(validRequest);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("SQL injection pattern");
    expect(mocks.mockClient.callTool).not.toHaveBeenCalled();
    expect(mocks.auditLogger.logInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED" }),
    );
  });

  // ── Test 5: Explicit consent denial ─────────────────

  it("returns APPROVAL_DENIED when explicit consent is rejected", async () => {
    const { bridge, mocks } = makeBridge({
      approvalQueue: {
        enqueue: vi.fn().mockResolvedValue({ id: "approval-002" }),
        waitForDecision: vi.fn().mockResolvedValue({ approved: false, reason: "user denied" }),
      },
    });

    const result = await bridge.invokeTool({ ...validRequest, consentTier: "explicit" });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_DENIED");
    // enqueue + waitForDecision both called exactly once
    expect(mocks.approvalQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(mocks.approvalQueue.waitForDecision).toHaveBeenCalledWith("approval-002");
    // The tool must NOT be invoked when approval is denied
    expect(mocks.mockClient.callTool).not.toHaveBeenCalled();
  });

  // ── Test 6: Happy path runs full pipeline in order ───

  it("executes all pipeline stages in strict order on successful invocation", async () => {
    const callOrder: string[] = [];

    const grants = {
      validateGrant: vi.fn().mockImplementation(async () => {
        callOrder.push("grant");
        return { valid: true };
      }),
    };
    const circuitBreaker = {
      canExecute: vi.fn().mockImplementation(async () => {
        callOrder.push("circuit");
        return true;
      }),
      recordSuccess: vi.fn().mockImplementation(async () => {
        callOrder.push("record-success");
      }),
      recordFailure: vi.fn(),
    };
    const rateLimiter = {
      checkAgentLimit: vi.fn().mockImplementation(async () => {
        callOrder.push("rate-limit");
        return { allowed: true, remaining: 10, resetMs: 1000 };
      }),
    };
    const inputValidator = {
      validateInput: vi.fn().mockImplementation(() => {
        callOrder.push("validate");
        return { valid: true, errors: [], sanitizedInput: validRequest.arguments };
      }),
    };
    const mockClient = {
      callTool: vi.fn().mockImplementation(async () => {
        callOrder.push("invoke");
        return { success: true, data: { echoed: "hello" }, latencyMs: 3 };
      }),
    };
    const clientPool = {
      acquire: vi.fn().mockResolvedValue(mockClient),
      release: vi.fn(),
    };
    const outputSanitizer = {
      sanitize: vi.fn().mockImplementation((d) => {
        callOrder.push("sanitize");
        return { sanitized: d, redactions: [] };
      }),
    };
    const auditLogger = {
      logInvocation: vi.fn().mockImplementation(async () => {
        callOrder.push("audit");
        return "audit-log-001";
      }),
    };

    const { bridge } = makeBridge({
      grants,
      circuitBreaker,
      rateLimiter,
      inputValidator,
      clientPool,
      outputSanitizer,
      auditLogger,
    });

    const result = await bridge.invokeTool(validRequest);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ echoed: "hello" });
    expect(result.auditLogId).toBe("audit-log-001");

    // Enforce strict ordering of the safety/execution pipeline:
    // grant -> circuit -> rate-limit -> validate -> invoke -> sanitize -> audit -> record-success
    expect(callOrder).toEqual([
      "grant",
      "circuit",
      "rate-limit",
      "validate",
      "invoke",
      "sanitize",
      "audit",
      "record-success",
    ]);
  });

  // ── Test: Phase 1.0 telemetry callback ────────────────

  it("invokes onSafetyTelemetry once per validator + once per sanitizer call (Rust-pilot decision-gate data)", async () => {
    const telemetryEvents: Array<{
      source: "input_validator" | "output_sanitizer";
      latencyMs: number;
      toolName?: string;
    }> = [];

    const { bridge } = makeBridge({
      inputValidator: {
        validateInput: vi.fn().mockReturnValue({
          valid: true,
          errors: [],
          sanitizedInput: validRequest.arguments,
          latencyMs: 0.42,
          inputSize: 17,
          injectionHits: 0,
        }),
      },
      outputSanitizer: {
        sanitize: vi.fn().mockReturnValue({
          sanitized: { ok: true },
          redactions: [],
          truncated: false,
          originalSize: 11,
          latencyMs: 0.31,
        }),
      },
      onSafetyTelemetry: (event) => {
        telemetryEvents.push({
          source: event.source,
          latencyMs: event.latencyMs,
          toolName: event.toolName,
        });
      },
    });

    const result = await bridge.invokeTool(validRequest);

    expect(result.success).toBe(true);
    // Both stages reported exactly once
    expect(telemetryEvents).toHaveLength(2);
    expect(telemetryEvents[0]).toEqual({
      source: "input_validator",
      latencyMs: 0.42,
      toolName: "echo",
    });
    expect(telemetryEvents[1]).toEqual({
      source: "output_sanitizer",
      latencyMs: 0.31,
      toolName: "echo",
    });
  });

  it("swallows errors thrown by onSafetyTelemetry without failing the pipeline", async () => {
    const { bridge } = makeBridge({
      inputValidator: {
        validateInput: vi.fn().mockReturnValue({
          valid: true,
          errors: [],
          sanitizedInput: validRequest.arguments,
          latencyMs: 1,
          inputSize: 17,
          injectionHits: 0,
        }),
      },
      outputSanitizer: {
        sanitize: vi.fn().mockReturnValue({
          sanitized: { ok: true },
          redactions: [],
          truncated: false,
          originalSize: 11,
          latencyMs: 1,
        }),
      },
      onSafetyTelemetry: () => {
        throw new Error("telemetry sink blew up");
      },
    });

    const result = await bridge.invokeTool(validRequest);

    // The pipeline must complete successfully even though telemetry threw.
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ok: true });
  });
});
