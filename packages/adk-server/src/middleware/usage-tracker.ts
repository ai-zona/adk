// ──────────────────────────────────────────────────────
// Usage Tracking Middleware
// ──────────────────────────────────────────────────────

import type { Context, Next } from "hono";
import type { UsageRecord } from "../server";

/**
 * Tracks request usage and calls onUsage callback after response.
 */
export function usageTracker(onUsage: (record: UsageRecord) => Promise<void>) {
  return async (c: Context, next: Next) => {
    const startTime = Date.now();

    await next();

    // Build usage record from context (set by route handlers)
    const usage = c.get("usage") as Partial<UsageRecord> | undefined;
    if (!usage) return;

    const apiKey = c.get("apiKey") as { id: string } | undefined;

    const record: UsageRecord = {
      apiKeyId: apiKey?.id ?? "anonymous",
      providerId: usage.providerId ?? "unknown",
      model: usage.model ?? "unknown",
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      costUsd: usage.costUsd ?? 0,
      endpoint: c.req.path,
      statusCode: c.res.status,
      latencyMs: Date.now() - startTime,
      agentName: usage.agentName,
      sessionId: usage.sessionId,
      runId: usage.runId,
    };

    // Fire-and-forget
    onUsage(record).catch(() => {});
  };
}
