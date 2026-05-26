import { describe, expect, it, vi } from "vitest";
import { defineAgent } from "../agent/define-agent";
import type { ADKLLMProvider, ChatResponseWithToolCalls } from "../types/llm";
import { ADKPipeline } from "./pipeline-executor";
import { ADKReviewPipeline } from "./review-pipeline";

// ── Helpers ──

function createMockProvider(responses: Array<Partial<ChatResponseWithToolCalls>>): ADKLLMProvider {
  let callIndex = 0;
  return {
    id: "mock",
    name: "Mock",
    isLocal: false,
    isAvailable: () => true,
    chat: vi.fn().mockResolvedValue({
      content: "mock",
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0,
      latencyMs: 10,
    }),
    complete: vi.fn().mockResolvedValue({
      content: "mock",
      inputTokens: 5,
      outputTokens: 5,
      costUsd: 0,
      latencyMs: 10,
    }),
    chatWithTools: vi.fn().mockImplementation(async () => {
      const idx = Math.min(callIndex++, responses.length - 1);
      return {
        content: responses[idx]?.content ?? "ok",
        inputTokens: responses[idx]?.inputTokens ?? 5,
        outputTokens: responses[idx]?.outputTokens ?? 5,
        costUsd: responses[idx]?.costUsd ?? 0,
        latencyMs: responses[idx]?.latencyMs ?? 10,
        toolCalls: responses[idx]?.toolCalls ?? undefined,
      };
    }),
    chatStream: vi.fn(),
  };
}

const testAgent = defineAgent({
  name: "pipeline-agent",
  instructions: "Process the task and provide results",
});

// ── ADKPipeline ──

describe("ADKPipeline", () => {
  it("executes a simple pipeline (agent only)", async () => {
    const provider = createMockProvider([{ content: "Task completed successfully" }]);

    const pipeline = new ADKPipeline({ provider });
    const result = await pipeline.execute(testAgent, {
      id: "task-1",
      description: "Fix the bug in login",
    });

    expect(result.taskId).toBe("task-1");
    expect(result.success).toBe(true);
    expect(result.output).toBe("Task completed successfully");
    expect(result.steps.length).toBeGreaterThanOrEqual(1);
  });

  it("runs workspace setup step", async () => {
    const provider = createMockProvider([{ content: "Done with workspace context" }]);
    const workspaceSetup = vi.fn().mockResolvedValue("workspace at /tmp/test");

    const pipeline = new ADKPipeline({ provider, workspaceSetup });
    const result = await pipeline.execute(testAgent, {
      id: "task-2",
      description: "Build feature",
    });

    expect(workspaceSetup).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.steps.find((s) => s.step === "workspace")?.success).toBe(true);
  });

  it("handles workspace setup failure", async () => {
    const provider = createMockProvider([{ content: "Never reached" }]);
    const workspaceSetup = vi.fn().mockRejectedValue(new Error("Disk full"));

    const pipeline = new ADKPipeline({ provider, workspaceSetup });
    const result = await pipeline.execute(testAgent, {
      id: "task-3",
      description: "Build feature",
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain("Workspace setup failed");
  });

  it("runs validation step", async () => {
    const provider = createMockProvider([{ content: "function fix() { return true; }" }]);
    const validator = vi.fn().mockResolvedValue({ valid: true, errors: [] });

    const pipeline = new ADKPipeline({ provider, validator });
    const result = await pipeline.execute(testAgent, {
      id: "task-4",
      description: "Fix bug",
    });

    expect(validator).toHaveBeenCalledOnce();
    expect(result.steps.find((s) => s.step === "validate")?.success).toBe(true);
  });

  it("handles validation failure", async () => {
    const provider = createMockProvider([{ content: "bad code" }]);
    const validator = vi.fn().mockResolvedValue({ valid: false, errors: ["Syntax error"] });

    const pipeline = new ADKPipeline({ provider, validator });
    const result = await pipeline.execute(testAgent, {
      id: "task-5",
      description: "Fix bug",
    });

    expect(result.success).toBe(false);
    expect(result.steps.find((s) => s.step === "validate")?.success).toBe(false);
  });

  it("runs reporter step", async () => {
    const provider = createMockProvider([{ content: "Fixed the bug" }]);
    const reporter = vi.fn().mockResolvedValue("Report: Bug fixed successfully. 1 file changed.");

    const pipeline = new ADKPipeline({ provider, reporter });
    const result = await pipeline.execute(testAgent, {
      id: "task-6",
      description: "Fix bug",
    });

    expect(reporter).toHaveBeenCalledOnce();
    expect(result.output).toContain("Report:");
    expect(result.steps.find((s) => s.step === "report")?.success).toBe(true);
  });

  it("runs full pipeline (workspace + agent + validate + report)", async () => {
    const provider = createMockProvider([{ content: "Implementation complete" }]);

    const pipeline = new ADKPipeline({
      provider,
      workspaceSetup: async () => "workspace ready",
      validator: async () => ({ valid: true, errors: [] }),
      reporter: async () => "All steps passed",
    });

    const result = await pipeline.execute(testAgent, {
      id: "task-7",
      description: "Full pipeline test",
      context: "Some file context",
    });

    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(4);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes task context in agent input", async () => {
    const provider = createMockProvider([{ content: "ok" }]);

    const pipeline = new ADKPipeline({ provider });
    await pipeline.execute(testAgent, {
      id: "task-8",
      description: "Fix login",
      context: "File: auth.ts\nLine: 42",
    });

    // Verify chatWithTools was called with input containing context
    const calls = (provider.chatWithTools as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const messages = calls[0]?.[0].messages;
    const userMsg = messages.find((m: { role: string }) => m.role === "user");
    expect(userMsg.content).toContain("auth.ts");
  });
});

// ── ADKReviewPipeline ──

describe("ADKReviewPipeline", () => {
  it("requires at least one reviewer", async () => {
    const provider = createMockProvider([]);
    const reviewPipeline = new ADKReviewPipeline({ provider });

    await expect(reviewPipeline.review("diff here", [])).rejects.toThrow("at least one reviewer");
  });

  it("runs single reviewer", async () => {
    const provider = createMockProvider([
      {
        content: JSON.stringify({
          verdict: "approve",
          comments: [{ severity: "info", message: "Looks good" }],
          summary: "Code looks clean",
          confidence: 0.9,
        }),
      },
    ]);

    const reviewer = defineAgent({
      name: "reviewer-1",
      instructions: "Review the code carefully",
    });

    const reviewPipeline = new ADKReviewPipeline({ provider });
    const result = await reviewPipeline.review("+ function foo() {}", [reviewer]);

    expect(result.verdict).toBe("approve");
    expect(result.reviewers).toHaveLength(1);
    expect(result.reviewers[0]?.verdict).toBe("approve");
    expect(result.comments).toHaveLength(1);
  });

  it("aggregates multiple reviewers", async () => {
    const provider = createMockProvider([
      {
        content: JSON.stringify({
          verdict: "approve",
          comments: [],
          summary: "LGTM",
          confidence: 0.8,
        }),
      },
      {
        content: JSON.stringify({
          verdict: "request_changes",
          comments: [{ severity: "error", message: "Missing null check" }],
          summary: "Needs fixes",
          confidence: 0.7,
        }),
      },
    ]);

    const reviewers = [
      defineAgent({ name: "reviewer-a", instructions: "Review" }),
      defineAgent({ name: "reviewer-b", instructions: "Review" }),
    ];

    const reviewPipeline = new ADKReviewPipeline({ provider, approvalThreshold: 1.0 });
    const result = await reviewPipeline.review("diff", reviewers);

    expect(result.reviewers).toHaveLength(2);
    expect(result.verdict).toBe("request_changes");
    expect(result.comments).toHaveLength(1);
  });

  it("handles non-JSON reviewer output gracefully", async () => {
    const provider = createMockProvider([
      {
        content: "This code looks fine. No issues found.",
      },
    ]);

    const reviewer = defineAgent({
      name: "reviewer-plain",
      instructions: "Review",
    });

    const reviewPipeline = new ADKReviewPipeline({ provider });
    const result = await reviewPipeline.review("diff", [reviewer]);

    expect(result.reviewers).toHaveLength(1);
    expect(result.reviewers[0]?.verdict).toBe("comment");
    expect(result.reviewers[0]?.summary).toContain("looks fine");
  });

  it("uses approval threshold", async () => {
    const provider = createMockProvider([
      {
        content: JSON.stringify({ verdict: "approve", comments: [], summary: "ok", confidence: 1 }),
      },
      {
        content: JSON.stringify({ verdict: "approve", comments: [], summary: "ok", confidence: 1 }),
      },
      {
        content: JSON.stringify({
          verdict: "request_changes",
          comments: [{ severity: "warning", message: "minor" }],
          summary: "fix",
          confidence: 0.5,
        }),
      },
    ]);

    const reviewers = [
      defineAgent({ name: "r1", instructions: "Review" }),
      defineAgent({ name: "r2", instructions: "Review" }),
      defineAgent({ name: "r3", instructions: "Review" }),
    ];

    // 2/3 approve = 66.7%, threshold 50% → approve
    const pipeline1 = new ADKReviewPipeline({
      provider: createMockProvider([
        {
          content: JSON.stringify({
            verdict: "approve",
            comments: [],
            summary: "ok",
            confidence: 1,
          }),
        },
        {
          content: JSON.stringify({
            verdict: "approve",
            comments: [],
            summary: "ok",
            confidence: 1,
          }),
        },
        {
          content: JSON.stringify({
            verdict: "request_changes",
            comments: [],
            summary: "fix",
            confidence: 0.5,
          }),
        },
      ]),
      approvalThreshold: 0.5,
    });
    const result1 = await pipeline1.review("diff", reviewers);
    expect(result1.verdict).toBe("approve");
  });

  it("calculates total duration", async () => {
    const provider = createMockProvider([
      {
        content: JSON.stringify({ verdict: "approve", comments: [], summary: "ok", confidence: 1 }),
      },
    ]);

    const reviewer = defineAgent({ name: "rev", instructions: "Review" });
    const reviewPipeline = new ADKReviewPipeline({ provider });

    const result = await reviewPipeline.review("diff", [reviewer]);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });
});
