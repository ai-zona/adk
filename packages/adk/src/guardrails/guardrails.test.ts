import { describe, expect, it, vi } from "vitest";
import type { GuardrailResult } from "../types/guardrail";
import type { RunContext } from "../types/runner";
import { budgetLimit } from "./built-in/budget-limit";
import { consentGate } from "./built-in/consent-gate";
import { contentFilter } from "./built-in/content-filter";
import { piiFilter } from "./built-in/pii-filter";
import { tokenLimit } from "./built-in/token-limit";
import { GuardrailEngine, GuardrailTripwireError } from "./engine";

const mockCtx: RunContext = {
  runId: "run-1",
  agentName: "test",
  turnNumber: 1,
  traceId: "trace-1",
  usage: { inputTokens: 100, outputTokens: 50, totalCostUsd: 0.01, latencyMs: 200 },
  metadata: {},
};

describe("GuardrailEngine", () => {
  const engine = new GuardrailEngine();

  it("runs input guardrails and returns results", async () => {
    const guardrail = contentFilter();
    const results = await engine.runInputGuardrails("Hello world", [], mockCtx, [{ guardrail }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
  });

  it("throws GuardrailTripwireError on tripwire failure", async () => {
    const guardrail = contentFilter({ blockedKeywords: ["hack"], tripwire: true });
    await expect(
      engine.runInputGuardrails("Let me hack this", [], mockCtx, [{ guardrail }]),
    ).rejects.toThrow(GuardrailTripwireError);
  });

  it("non-tripwire failures don't throw", async () => {
    const guardrail = contentFilter({ blockedKeywords: ["test"], tripwire: false });
    const results = await engine.runInputGuardrails("This is a test", [], mockCtx, [{ guardrail }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
  });

  it("config-level tripwire override", async () => {
    const guardrail = contentFilter({ blockedKeywords: ["test"], tripwire: true });
    // Override tripwire to false at config level
    const results = await engine.runInputGuardrails("This is a test", [], mockCtx, [
      { guardrail, tripwire: false },
    ]);
    expect(results[0]?.passed).toBe(false);
    // Should not throw because config overrides to non-tripwire
  });

  it("runs output guardrails", async () => {
    const guardrail = budgetLimit(0.1);
    const results = await engine.runOutputGuardrails("Output text", [], mockCtx, [{ guardrail }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
  });

  it("runs concurrent guardrails", async () => {
    const g1 = contentFilter();
    const g2 = contentFilter({ maxLength: 1000 });
    const results = await engine.runInputGuardrails("Hello", [], mockCtx, [
      { guardrail: g1 },
      { guardrail: g2 },
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

describe("contentFilter", () => {
  it("passes clean content", async () => {
    const guardrail = contentFilter();
    const result = await guardrail.execute("Hello world", [], mockCtx);
    expect(result.passed).toBe(true);
  });

  it("blocks by keyword", async () => {
    const guardrail = contentFilter({ blockedKeywords: ["forbidden"] });
    const result = await guardrail.execute("This is forbidden content", [], mockCtx);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("forbidden");
  });

  it("blocks by pattern", async () => {
    const guardrail = contentFilter({ blockedPatterns: [/\d{4}-\d{4}/] });
    const result = await guardrail.execute("Card: 1234-5678", [], mockCtx);
    expect(result.passed).toBe(false);
  });

  it("blocks by length", async () => {
    const guardrail = contentFilter({ maxLength: 10 });
    const result = await guardrail.execute("This is a long string", [], mockCtx);
    expect(result.passed).toBe(false);
  });
});

describe("consentGate", () => {
  it("auto consent always passes", async () => {
    const guardrail = consentGate("auto");
    const result = await guardrail.execute("input", [], mockCtx);
    expect(result.passed).toBe(true);
  });

  it("notify consent passes with message", async () => {
    const guardrail = consentGate("notify");
    const result = await guardrail.execute("input", [], mockCtx);
    expect(result.passed).toBe(true);
    expect(result.message).toContain("notification");
  });

  it("explicit without handler fails", async () => {
    const guardrail = consentGate("explicit");
    const result = await guardrail.execute("input", [], mockCtx);
    expect(result.passed).toBe(false);
  });

  it("explicit with approving handler passes", async () => {
    const handler = vi.fn().mockResolvedValue({ allowed: true, status: "approved" });
    const guardrail = consentGate("explicit", handler);
    const result = await guardrail.execute("input", [], mockCtx);
    expect(result.passed).toBe(true);
    expect(handler).toHaveBeenCalled();
  });

  it("explicit with rejecting handler fails", async () => {
    const handler = vi
      .fn()
      .mockResolvedValue({ allowed: false, status: "rejected", reason: "denied" });
    const guardrail = consentGate("explicit", handler);
    const result = await guardrail.execute("input", [], mockCtx);
    expect(result.passed).toBe(false);
  });
});

describe("budgetLimit", () => {
  it("passes under budget", async () => {
    const guardrail = budgetLimit(1.0);
    const result = await guardrail.execute("output", [], mockCtx);
    expect(result.passed).toBe(true);
  });

  it("fails over budget", async () => {
    const guardrail = budgetLimit(0.005);
    const result = await guardrail.execute("output", [], mockCtx);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("exceeded");
  });

  it("warns at 80% budget", async () => {
    const ctx = { ...mockCtx, usage: { ...mockCtx.usage, totalCostUsd: 0.085 } };
    const guardrail = budgetLimit(0.1);
    const result = await guardrail.execute("output", [], ctx);
    expect(result.passed).toBe(true);
    expect(result.message).toContain("warning");
  });
});

describe("GuardrailEngine severity levels", () => {
  const engine = new GuardrailEngine();

  it("info severity logs but does not block", async () => {
    const guardrail = {
      name: "info-guardrail",
      type: "input" as const,
      tripwire: true, // tripwire is true, but info severity should override
      execute: async (): Promise<GuardrailResult> => ({
        name: "info-guardrail",
        type: "input",
        passed: false,
        tripwire: true,
        severity: "info",
        message: "Info only",
      }),
    };
    const results = await engine.runInputGuardrails("test", [], mockCtx, [{ guardrail }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.severity).toBe("info");
    // Should NOT throw despite tripwire=true
  });

  it("warning severity logs but does not block", async () => {
    const guardrail = {
      name: "warn-guardrail",
      type: "input" as const,
      tripwire: true,
      execute: async (): Promise<GuardrailResult> => ({
        name: "warn-guardrail",
        type: "input",
        passed: false,
        tripwire: true,
        severity: "warning",
        message: "Warning only",
      }),
    };
    const results = await engine.runInputGuardrails("test", [], mockCtx, [{ guardrail }]);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.severity).toBe("warning");
  });

  it("critical severity always blocks regardless of tripwire setting", async () => {
    const guardrail = {
      name: "critical-guardrail",
      type: "input" as const,
      tripwire: false, // tripwire is false, but critical should override
      execute: async (): Promise<GuardrailResult> => ({
        name: "critical-guardrail",
        type: "input",
        passed: false,
        tripwire: false,
        severity: "critical",
        message: "Critical violation",
      }),
    };
    await expect(engine.runInputGuardrails("test", [], mockCtx, [{ guardrail }])).rejects.toThrow(
      GuardrailTripwireError,
    );
  });

  it("backward compat — guardrails without severity default to error behavior", async () => {
    // No severity field → defaults to "error" → respects tripwire
    const guardrail = contentFilter({ blockedKeywords: ["hack"], tripwire: true });
    await expect(
      engine.runInputGuardrails("Let me hack this", [], mockCtx, [{ guardrail }]),
    ).rejects.toThrow(GuardrailTripwireError);

    // No severity + tripwire=false → should not block
    const guardrail2 = contentFilter({ blockedKeywords: ["hack"], tripwire: false });
    const results = await engine.runInputGuardrails("Let me hack this", [], mockCtx, [
      { guardrail: guardrail2 },
    ]);
    expect(results[0]?.passed).toBe(false);
  });
});

describe("tokenLimit", () => {
  it("warns on exceeded tokens", async () => {
    const guardrail = tokenLimit({ maxTotalTokens: 100 });
    const ctx = {
      ...mockCtx,
      usage: { inputTokens: 80, outputTokens: 50, totalCostUsd: 0.01, latencyMs: 200 },
    };
    const result = await guardrail.execute("output", [], ctx);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("tokens 130 > 100");
    expect(result.score).toBeGreaterThan(0);
  });

  it("passes when within limits", async () => {
    const guardrail = tokenLimit({ maxTotalTokens: 500 });
    const result = await guardrail.execute("output", [], mockCtx);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("info");
  });

  it("detects cost exceeded", async () => {
    const guardrail = tokenLimit({ maxCostUsd: 0.005 });
    const result = await guardrail.execute("output", [], mockCtx);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("cost");
  });
});

describe("piiFilter", () => {
  it("detects email addresses", async () => {
    const guardrail = piiFilter();
    const result = await guardrail.execute("Contact john@example.com for details", [], mockCtx);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("warning");
    expect(result.message).toContain("email");
    expect(result.metadata?.detections).toEqual([{ type: "email", count: 1 }]);
  });

  it("passes clean text", async () => {
    const guardrail = piiFilter();
    const result = await guardrail.execute("Hello, this is a clean message.", [], mockCtx);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe("info");
    expect(result.message).toBe("No PII detected");
  });

  it("detects multiple PII types", async () => {
    const guardrail = piiFilter({ detect: ["email", "phone"] });
    const result = await guardrail.execute("Email: test@test.com Phone: 555-123-4567", [], mockCtx);
    expect(result.passed).toBe(false);
    expect(result.metadata?.detections).toHaveLength(2);
  });

  it("respects severity config", async () => {
    const guardrail = piiFilter({ severity: "critical" });
    const result = await guardrail.execute("SSN: 123-45-6789", [], mockCtx);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe("critical");
    expect(result.tripwire).toBe(true);
  });
});
