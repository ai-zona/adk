import type { InvocationStatus, MCPAuditLogger } from "../audit/audit-logger";
import type { MCPClientPool } from "../client/mcp-client-pool";
import type { ApprovalQueue } from "../grants/approval-queue";
import type { SkillGrantManager } from "../grants/skill-grants";
import type { CircuitBreaker } from "../safety/circuit-breaker";
import type { InputValidator, ValidationResult } from "../safety/input-validator";
import type { OutputSanitizer } from "../safety/output-sanitizer";
import type { RateLimiter } from "../safety/rate-limiter";
import type { MCPServerConfig } from "../types";

// ──────────────────────────────────────────────────────
// Types (interface-based to avoid direct aza-protocol dep)
// ──────────────────────────────────────────────────────

/**
 * A tool invocation request originating from an AZA Protocol agent.
 *
 * This is the primary input to the AZA-MCP bridge pipeline.
 */
export interface AZAToolRequest {
  /** The agent's DID (decentralized identifier). */
  agentDid: string;
  /** The agent's database ID. */
  agentId: string;
  /** The tool's database ID. */
  toolId: string;
  /** The MCP server ID hosting the tool. */
  serverId: string;
  /** The tool name as registered in the MCP server. */
  toolName: string;
  /** Arguments to pass to the tool. */
  arguments: Record<string, unknown>;
  /** Correlation ID for tracing across the request lifecycle. */
  correlationId: string;
  /**
   * Consent tier controlling human-in-the-loop behavior:
   * - `auto`:     Execute immediately (default)
   * - `notify`:   Execute and notify the user afterward
   * - `explicit`: Require explicit user approval before execution
   */
  consentTier?: "auto" | "notify" | "explicit";
}

/**
 * The response returned by the AZA-MCP bridge after a tool invocation.
 */
export interface AZAToolResponse {
  /** Whether the tool invocation succeeded. */
  success: boolean;
  /** Tool output data (present on success). */
  data?: unknown;
  /** Error details (present on failure). */
  error?: { code: string; message: string };
  /** Total latency in milliseconds (including all pipeline stages). */
  latencyMs: number;
  /** The audit log entry ID for this invocation. */
  auditLogId: string;
}

/**
 * Telemetry sink for the safety pipeline. Decoupled from any specific
 * observability backend so this package stays free of an
 * `@aizona/platform-agents` dependency (which would be circular). The
 * caller (api/routers/mcp.ts) wires a sink that forwards to EventBus.
 *
 * Each invocation reports a single stage's measurement.
 */
export type SafetyTelemetrySink = (event: {
  source: "input_validator" | "output_sanitizer";
  latencyMs: number;
  inputSize: number;
  outputSize?: number;
  redactionCount?: number;
  truncated?: boolean;
  injectionHits?: number;
  toolName?: string;
}) => void;

// ──────────────────────────────────────────────────────
// Error codes
// ──────────────────────────────────────────────────────

const ErrorCode = {
  GRANT_DENIED: "GRANT_DENIED",
  CIRCUIT_OPEN: "CIRCUIT_OPEN",
  RATE_LIMITED: "RATE_LIMITED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  APPROVAL_DENIED: "APPROVAL_DENIED",
  APPROVAL_TIMEOUT: "APPROVAL_TIMEOUT",
  INVOCATION_ERROR: "INVOCATION_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

// ──────────────────────────────────────────────────────
// AZAMCPBridge
// ──────────────────────────────────────────────────────

/**
 * The main bridge that connects AZA Protocol agents to MCP tools.
 *
 * Every tool invocation flows through a strict pipeline:
 *
 * 1. **Grant check** - Verify the agent has an active skill grant
 * 2. **Circuit breaker** - Ensure the tool's circuit is not open
 * 3. **Rate limit** - Enforce per-agent, per-tool rate limits
 * 4. **Input validation** - Sanitize and validate tool arguments
 * 5. **Consent gate** - For "explicit" tier, queue for human approval
 * 6. **Tool invocation** - Call the tool via the MCP client pool
 * 7. **Output sanitization** - Redact PII/credentials from output
 * 8. **Audit log** - Record the invocation for compliance
 * 9. **Circuit update** - Record success/failure for the circuit breaker
 *
 * Each stage can short-circuit the pipeline with an appropriate error.
 */
export class AZAMCPBridge {
  private grants: SkillGrantManager;
  private approvalQueue: ApprovalQueue;
  private inputValidator: InputValidator;
  private outputSanitizer: OutputSanitizer;
  private rateLimiter: RateLimiter;
  private circuitBreaker: CircuitBreaker;
  private clientPool: MCPClientPool;
  private auditLogger: MCPAuditLogger;

  /**
   * Server config lookup function. The bridge needs to resolve
   * server IDs to their full config for the client pool.
   */
  private serverConfigResolver?: (serverId: string) => Promise<MCPServerConfig | null>;
  private onSafetyTelemetry?: SafetyTelemetrySink;

  constructor(deps: {
    grants: SkillGrantManager;
    approvalQueue: ApprovalQueue;
    inputValidator: InputValidator;
    outputSanitizer: OutputSanitizer;
    rateLimiter: RateLimiter;
    circuitBreaker: CircuitBreaker;
    clientPool: MCPClientPool;
    auditLogger: MCPAuditLogger;
    serverConfigResolver?: (serverId: string) => Promise<MCPServerConfig | null>;
    /**
     * Optional sink invoked once per validateInput / sanitize call. The
     * caller decides where to forward — EventBus, Prometheus, Sentry, etc.
     * Errors thrown by the sink are swallowed so observability never
     * fails the pipeline.
     */
    onSafetyTelemetry?: SafetyTelemetrySink;
  }) {
    this.grants = deps.grants;
    this.approvalQueue = deps.approvalQueue;
    this.inputValidator = deps.inputValidator;
    this.outputSanitizer = deps.outputSanitizer;
    this.rateLimiter = deps.rateLimiter;
    this.circuitBreaker = deps.circuitBreaker;
    this.clientPool = deps.clientPool;
    this.auditLogger = deps.auditLogger;
    this.serverConfigResolver = deps.serverConfigResolver;
    this.onSafetyTelemetry = deps.onSafetyTelemetry;
  }

  private reportSafetyTelemetry(event: Parameters<SafetyTelemetrySink>[0]): void {
    if (!this.onSafetyTelemetry) return;
    try {
      this.onSafetyTelemetry(event);
    } catch {
      // Telemetry must never break the pipeline.
    }
  }

  // ── Public API ────────────────────────────────────

  /**
   * Invokes an MCP tool on behalf of an AZA agent.
   *
   * Runs the full pipeline (grant -> validate -> rate limit -> invoke
   * -> sanitize -> audit) and returns a unified response.
   *
   * @param request - The tool invocation request from the AZA agent
   * @returns A unified response with result, latency, and audit log ID
   */
  async invokeTool(request: AZAToolRequest): Promise<AZAToolResponse> {
    const startTime = Date.now();
    const circuitKey = `mcp:circuit:tool:${request.toolId}`;

    try {
      // ── Step 1: Validate skill grant ─────────
      const grantResult = await this.grants.validateGrant(request.agentId, request.toolId);

      if (!grantResult.valid) {
        return this.buildErrorResponse(
          request,
          ErrorCode.GRANT_DENIED,
          grantResult.reason ?? "Skill grant denied",
          startTime,
          "PERMISSION_DENIED",
        );
      }

      // ── Step 2: Check circuit breaker ─────────────
      const canExecute = await this.circuitBreaker.canExecute(circuitKey);

      if (!canExecute) {
        return this.buildErrorResponse(
          request,
          ErrorCode.CIRCUIT_OPEN,
          `Circuit breaker is open for tool "${request.toolName}". The tool is temporarily unavailable.`,
          startTime,
          "FAILED",
        );
      }

      // ── Step 3: Check rate limit ──────────────────
      const rateResult = await this.rateLimiter.checkAgentLimit(request.agentId, request.toolId);

      if (!rateResult.allowed) {
        // Record rate limit as a failure for audit but not for circuit breaker
        return this.buildErrorResponse(
          request,
          ErrorCode.RATE_LIMITED,
          `Rate limit exceeded for agent "${request.agentId}" on tool "${request.toolName}". ` +
            `Retry after ${rateResult.retryAfterMs ?? 0}ms.`,
          startTime,
          "RATE_LIMITED",
        );
      }

      // ── Step 4: Validate input ────────────────────
      const validation: ValidationResult = this.inputValidator.validateInput(
        request.toolName,
        request.arguments,
      );

      this.reportSafetyTelemetry({
        source: "input_validator",
        latencyMs: validation.latencyMs,
        inputSize: validation.inputSize,
        injectionHits: validation.injectionHits,
        toolName: request.toolName,
      });

      if (!validation.valid) {
        return this.buildErrorResponse(
          request,
          ErrorCode.VALIDATION_FAILED,
          `Input validation failed: ${validation.errors.join("; ")}`,
          startTime,
          "FAILED",
        );
      }

      // Use sanitized input from this point forward
      const sanitizedInput = validation.sanitizedInput ?? request.arguments;

      // ── Step 5: Consent gate (explicit tier) ──────
      if (request.consentTier === "explicit") {
        const approved = await this.handleExplicitConsent(request, sanitizedInput);

        if (!approved) {
          return this.buildErrorResponse(
            request,
            ErrorCode.APPROVAL_DENIED,
            "Tool invocation was denied or timed out during human approval",
            startTime,
            "PERMISSION_DENIED",
          );
        }
      }

      // ── Step 6: Invoke tool via MCP client pool ───
      const serverConfig = await this.resolveServerConfig(request.serverId);

      if (!serverConfig) {
        return this.buildErrorResponse(
          request,
          ErrorCode.INVOCATION_ERROR,
          `MCP server "${request.serverId}" not found or unavailable`,
          startTime,
          "FAILED",
        );
      }

      const client = await this.clientPool.acquire(serverConfig);
      let toolResult;

      try {
        toolResult = await client.callTool(request.toolName, sanitizedInput);
      } finally {
        await this.clientPool.release(request.serverId, client);
      }

      // ── Step 7: Sanitize output ───────────────────
      const sanitized = this.outputSanitizer.sanitize(toolResult.data);

      this.reportSafetyTelemetry({
        source: "output_sanitizer",
        latencyMs: sanitized.latencyMs,
        inputSize: sanitized.originalSize,
        redactionCount: sanitized.redactions.length,
        truncated: sanitized.truncated,
        toolName: request.toolName,
      });

      // ── Step 8: Audit log ─────────────────────────
      const latencyMs = Math.round(Date.now() - startTime);
      const status: InvocationStatus = toolResult.success ? "SUCCESS" : "FAILED";

      const auditLogId = await this.auditLogger.logInvocation({
        agentId: request.agentId,
        toolId: request.toolId,
        input: sanitizedInput,
        output: sanitized.sanitized,
        status,
        latencyMs,
        errorMessage: toolResult.error?.message,
        correlationId: request.correlationId,
      });

      // ── Step 9: Update circuit breaker ────────────
      if (toolResult.success) {
        await this.circuitBreaker.recordSuccess(circuitKey);
      } else {
        await this.circuitBreaker.recordFailure(circuitKey);
      }

      // ── Step 10: Return response ──────────────────
      if (toolResult.success) {
        return {
          success: true,
          data: sanitized.sanitized,
          latencyMs,
          auditLogId,
        };
      }

      return {
        success: false,
        error: toolResult.error ?? {
          code: ErrorCode.INVOCATION_ERROR,
          message: "Tool invocation failed without error details",
        },
        latencyMs,
        auditLogId,
      };
    } catch (error) {
      // Unexpected error: log and return a safe error response
      const latencyMs = Math.round(Date.now() - startTime);
      const message = error instanceof Error ? error.message : "Unknown internal error";

      // Best-effort circuit breaker update
      try {
        await this.circuitBreaker.recordFailure(circuitKey);
      } catch {
        // Ignore circuit breaker errors during error handling
      }

      // Best-effort audit log
      let auditLogId = "unknown";
      try {
        auditLogId = await this.auditLogger.logInvocation({
          agentId: request.agentId,
          toolId: request.toolId,
          input: request.arguments,
          output: null,
          status: "FAILED",
          latencyMs,
          errorMessage: message,
          correlationId: request.correlationId,
        });
      } catch {
        // Ignore audit logging errors during error handling
      }

      return {
        success: false,
        error: {
          code: ErrorCode.INTERNAL_ERROR,
          message,
        },
        latencyMs,
        auditLogId,
      };
    }
  }

  // ── Private helpers ───────────────────────────────

  /**
   * Handles the "explicit" consent tier by enqueuing an approval
   * request and waiting for a human decision.
   *
   * @returns true if approved, false if denied or timed out
   */
  private async handleExplicitConsent(
    request: AZAToolRequest,
    sanitizedInput: Record<string, unknown>,
  ): Promise<boolean> {
    const approvalRequest = await this.approvalQueue.enqueue({
      agentId: request.agentId,
      toolId: request.toolId,
      toolName: request.toolName,
      action: "tools/call",
      input: sanitizedInput,
      correlationId: request.correlationId,
    });

    const decision = await this.approvalQueue.waitForDecision(approvalRequest.id);

    return decision.approved;
  }

  /**
   * Resolves a server ID to its full MCPServerConfig.
   *
   * Uses the injected resolver if available, otherwise constructs
   * a minimal config from the server ID (useful for testing).
   */
  private async resolveServerConfig(serverId: string): Promise<MCPServerConfig | null> {
    if (this.serverConfigResolver) {
      return this.serverConfigResolver(serverId);
    }

    // Without a resolver, we cannot map serverId to a config
    return null;
  }

  /**
   * Builds an error response with audit logging.
   */
  private async buildErrorResponse(
    request: AZAToolRequest,
    errorCode: string,
    errorMessage: string,
    startTime: number,
    auditStatus: InvocationStatus,
  ): Promise<AZAToolResponse> {
    const latencyMs = Math.round(Date.now() - startTime);

    // Best-effort audit log
    let auditLogId = "unknown";
    try {
      auditLogId = await this.auditLogger.logInvocation({
        agentId: request.agentId,
        toolId: request.toolId,
        input: request.arguments,
        output: null,
        status: auditStatus,
        latencyMs,
        errorMessage,
        correlationId: request.correlationId,
      });
    } catch {
      // Ignore audit logging errors in error path
    }

    return {
      success: false,
      error: { code: errorCode, message: errorMessage },
      latencyMs,
      auditLogId,
    };
  }
}
