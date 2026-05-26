// ──────────────────────────────────────────────────────
// ADK Guardrail Engine
// ──────────────────────────────────────────────────────

import type { ADKEventBus } from "../events/event-bus";
import type {
  GuardrailConfig,
  GuardrailResult,
  GuardrailType,
  InputGuardrail,
  OutputGuardrail,
  ToolGuardrail,
} from "../types/guardrail";
import type { ChatMessage } from "../types/llm";
import type { RunContext } from "../types/runner";

/** Error thrown when a tripwire guardrail fails */
export class GuardrailTripwireError extends Error {
  constructor(
    public readonly guardrailName: string,
    public readonly result: GuardrailResult,
  ) {
    super(`Guardrail tripwire: ${guardrailName} — ${result.message ?? "blocked"}`);
    this.name = "GuardrailTripwireError";
  }
}

export class GuardrailEngine {
  private eventBus?: ADKEventBus;

  /** Attach an ADKEventBus for guardrail audit events */
  setEventBus(bus: ADKEventBus): void {
    this.eventBus = bus;
  }

  /**
   * Determine whether a guardrail result should block execution.
   * - info/warning: never block (soft constraints)
   * - critical: always block regardless of tripwire
   * - error (default): block only if tripwire is true (backward compatible)
   */
  private shouldBlock(result: GuardrailResult): boolean {
    if (result.passed) return false;
    const severity = result.severity ?? "error";
    if (severity === "info" || severity === "warning") return false;
    if (severity === "critical") return true;
    return result.tripwire; // "error" severity: respect tripwire setting
  }

  /** Emit guardrail.triggered events for each result */
  private emitGuardrailEvents(
    results: GuardrailResult[],
    guardrailType: GuardrailType,
    ctx: RunContext,
  ): void {
    if (!this.eventBus) return;
    for (const result of results) {
      this.eventBus.emit("guardrail.triggered", {
        runId: ctx.runId,
        guardrailName: result.name,
        type: guardrailType,
        passed: result.passed,
        tripwire: result.tripwire,
        agentName: ctx.agentName,
        severity: result.severity,
        message: result.message,
        timestamp: Date.now(),
      });
    }
  }

  /** Run all input guardrails. Throws GuardrailTripwireError if a tripwire fails. */
  async runInputGuardrails(
    input: string,
    messages: ChatMessage[],
    ctx: RunContext,
    guardrails: GuardrailConfig[],
  ): Promise<GuardrailResult[]> {
    const inputGuardrails = guardrails.filter((g) => g.guardrail.type === "input");
    if (inputGuardrails.length === 0) return [];

    const results = await Promise.all(
      inputGuardrails.map(async (config) => {
        const guardrail = config.guardrail as InputGuardrail;
        const result = await guardrail.execute(input, messages, ctx);
        // Allow config-level tripwire override
        if (config.tripwire !== undefined) {
          result.tripwire = config.tripwire;
        }
        return result;
      }),
    );

    // Emit audit events for all results
    this.emitGuardrailEvents(results, "input", ctx);

    // Check for blocking failures (severity-aware)
    for (const result of results) {
      if (this.shouldBlock(result)) {
        throw new GuardrailTripwireError(result.name, result);
      }
    }

    return results;
  }

  /** Run all output guardrails. Throws GuardrailTripwireError if a tripwire fails. */
  async runOutputGuardrails(
    output: string,
    messages: ChatMessage[],
    ctx: RunContext,
    guardrails: GuardrailConfig[],
  ): Promise<GuardrailResult[]> {
    const outputGuardrails = guardrails.filter((g) => g.guardrail.type === "output");
    if (outputGuardrails.length === 0) return [];

    const results = await Promise.all(
      outputGuardrails.map(async (config) => {
        const guardrail = config.guardrail as OutputGuardrail;
        const result = await guardrail.execute(output, messages, ctx);
        if (config.tripwire !== undefined) {
          result.tripwire = config.tripwire;
        }
        return result;
      }),
    );

    // Emit audit events for all results
    this.emitGuardrailEvents(results, "output", ctx);

    for (const result of results) {
      if (this.shouldBlock(result)) {
        throw new GuardrailTripwireError(result.name, result);
      }
    }

    return results;
  }

  /** Run tool guardrails before tool execution. Throws on tripwire failure. */
  async runToolGuardrails(
    toolName: string,
    input: unknown,
    ctx: RunContext,
    guardrails: GuardrailConfig[],
  ): Promise<GuardrailResult[]> {
    const toolGuardrails = guardrails.filter((g) => g.guardrail.type === "tool");
    if (toolGuardrails.length === 0) return [];

    const results = await Promise.all(
      toolGuardrails.map(async (config) => {
        const guardrail = config.guardrail as ToolGuardrail;
        const result = await guardrail.execute(toolName, input, ctx);
        if (config.tripwire !== undefined) {
          result.tripwire = config.tripwire;
        }
        return result;
      }),
    );

    // Emit audit events for all results
    this.emitGuardrailEvents(results, "tool", ctx);

    for (const result of results) {
      if (this.shouldBlock(result)) {
        throw new GuardrailTripwireError(result.name, result);
      }
    }

    return results;
  }
}
