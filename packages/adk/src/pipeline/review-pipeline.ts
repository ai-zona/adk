// ──────────────────────────────────────────────────────
// ADK Review Pipeline — Multi-agent code review
// ──────────────────────────────────────────────────────
// Extracted from @aizona/platform-agents/pipeline/review-pipeline.ts
// Generalized — no Prisma, no DB, no platform-specific types.
// ──────────────────────────────────────────────────────

import type { Agent } from "../agent/define-agent";
import type { ADKEventBus } from "../events/event-bus";
import { Runner } from "../runner/runner";
import type { ADKLLMProvider } from "../types/llm";
import type { RunResult } from "../types/runner";

/** Review severity levels */
export type ReviewSeverity = "info" | "warning" | "error" | "critical";

/** Single review comment */
export interface ReviewComment {
  file?: string;
  line?: number;
  severity: ReviewSeverity;
  message: string;
  suggestion?: string;
  reviewer: string;
}

/** Individual reviewer's result */
export interface ReviewerResult {
  reviewer: string;
  verdict: "approve" | "request_changes" | "comment";
  comments: ReviewComment[];
  summary: string;
  confidence: number;
  runResult: RunResult;
}

/** Aggregated review result */
export interface ReviewResult {
  verdict: "approve" | "request_changes" | "comment";
  reviewers: ReviewerResult[];
  comments: ReviewComment[];
  summary: string;
  totalDurationMs: number;
}

/** Review configuration */
export interface ReviewConfig {
  /** LLM provider */
  provider: ADKLLMProvider;
  /** Event bus (optional) */
  eventBus?: ADKEventBus;
  /** Approval threshold (fraction of reviewers that must approve: 0.0 - 1.0) */
  approvalThreshold?: number;
  /** Max turns per reviewer */
  maxTurns?: number;
}

export class ADKReviewPipeline {
  private config: ReviewConfig;

  constructor(config: ReviewConfig) {
    this.config = config;
  }

  /** Run a multi-agent code review */
  async review(diff: string, reviewers: Agent[], context?: string): Promise<ReviewResult> {
    if (reviewers.length === 0) {
      throw new Error("Review requires at least one reviewer agent");
    }

    const startTime = Date.now();
    const threshold = this.config.approvalThreshold ?? 0.5;

    // Run all reviewers in parallel
    const reviewerResults = await Promise.all(
      reviewers.map((reviewer) => this.runReviewer(reviewer, diff, context)),
    );

    // Aggregate comments
    const allComments = reviewerResults.flatMap((r) => r.comments);

    // Determine aggregate verdict
    const approveCount = reviewerResults.filter((r) => r.verdict === "approve").length;
    const approvalRate = approveCount / reviewers.length;

    let verdict: ReviewResult["verdict"];
    if (approvalRate >= threshold) {
      verdict = "approve";
    } else if (reviewerResults.some((r) => r.verdict === "request_changes")) {
      verdict = "request_changes";
    } else {
      verdict = "comment";
    }

    // Build summary
    const summaryParts = reviewerResults.map((r) => `${r.reviewer}: ${r.verdict} — ${r.summary}`);

    return {
      verdict,
      reviewers: reviewerResults,
      comments: allComments,
      summary: summaryParts.join("\n"),
      totalDurationMs: Date.now() - startTime,
    };
  }

  private async runReviewer(
    reviewer: Agent,
    diff: string,
    context?: string,
  ): Promise<ReviewerResult> {
    const runner = new Runner({
      provider: this.config.provider,
      eventBus: this.config.eventBus,
    });

    const inputParts = [`Please review the following code changes:\n\n${diff}`];
    if (context) {
      inputParts.push(`\nAdditional context:\n${context}`);
    }
    inputParts.push(
      "\nRespond with a JSON object: { verdict, comments: [{ file?, line?, severity, message, suggestion? }], summary, confidence }",
    );

    const runResult = await runner.run(reviewer, {
      input: inputParts.join("\n"),
      maxTurns: this.config.maxTurns ?? 5,
    });

    // Parse reviewer output
    return this.parseReviewerOutput(reviewer.name, runResult);
  }

  private parseReviewerOutput(reviewerName: string, runResult: RunResult): ReviewerResult {
    const defaultResult: ReviewerResult = {
      reviewer: reviewerName,
      verdict: "comment",
      comments: [],
      summary: runResult.output,
      confidence: 0.5,
      runResult,
    };

    // Try to parse JSON from output
    try {
      const jsonMatch = runResult.output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return defaultResult;

      const parsed = JSON.parse(jsonMatch[0]);

      const verdict =
        parsed.verdict === "approve" || parsed.verdict === "request_changes"
          ? parsed.verdict
          : "comment";

      const comments: ReviewComment[] = Array.isArray(parsed.comments)
        ? parsed.comments.map((c: Record<string, unknown>) => ({
            file: typeof c.file === "string" ? c.file : undefined,
            line: typeof c.line === "number" ? c.line : undefined,
            severity: this.parseSeverity(c.severity),
            message: String(c.message ?? ""),
            suggestion: typeof c.suggestion === "string" ? c.suggestion : undefined,
            reviewer: reviewerName,
          }))
        : [];

      return {
        reviewer: reviewerName,
        verdict,
        comments,
        summary: typeof parsed.summary === "string" ? parsed.summary : runResult.output,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        runResult,
      };
    } catch {
      return defaultResult;
    }
  }

  private parseSeverity(value: unknown): ReviewSeverity {
    if (value === "info" || value === "warning" || value === "error" || value === "critical") {
      return value;
    }
    return "info";
  }
}
