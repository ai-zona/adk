import { z } from "zod";

const isoDateTime = z.string().datetime({ offset: true });

const contentPart = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({
    kind: z.literal("image"),
    url: z.string().url(),
    alt: z.string().optional(),
    mimeType: z.string().optional(),
  }),
  z.object({
    kind: z.literal("audio"),
    url: z.string().url(),
    mimeType: z.string().optional(),
    durationSeconds: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("video"),
    url: z.string().url(),
    mimeType: z.string().optional(),
    durationSeconds: z.number().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal("ui-artifact"),
    artifactId: z.string(),
    preview: z.string().optional(),
  }),
]);

export const wsEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("presence.online"), userId: z.string(), at: isoDateTime }),
  z.object({ type: z.literal("presence.offline"), userId: z.string(), at: isoDateTime }),
  z.object({
    type: z.literal("message.created"),
    message: z.object({
      id: z.string(),
      channelId: z.string(),
      authorType: z.enum(["USER", "AGENT", "SYSTEM"]),
      authorId: z.string(),
      content: z.object({ parts: z.array(contentPart) }),
      inReplyToId: z.string().optional(),
      metadata: z.record(z.unknown()).optional(),
      createdAt: isoDateTime,
      editedAt: isoDateTime.optional(),
    }),
  }),
  z.object({
    type: z.literal("message.edited"),
    messageId: z.string(),
    content: z.array(contentPart),
    editedAt: isoDateTime,
  }),
  z.object({
    type: z.literal("agent.state"),
    agentId: z.string(),
    state: z.enum(["IDLE", "WORKING", "WAITING", "ERROR"]),
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal("agent.typing"), agentId: z.string(), channelId: z.string() }),
  z.object({
    type: z.literal("entitlement.unlocked"),
    ref: z.object({ type: z.string(), refId: z.string() }),
    source: z.string(),
    unlockedBy: z.string(),
    at: isoDateTime,
  }),
  z.object({
    type: z.literal("skill.executed"),
    skillRef: z.string(),
    durationMs: z.number().nonnegative(),
    success: z.boolean(),
    errorMessage: z.string().optional(),
  }),
  z.object({
    type: z.literal("manifest.step.started"),
    jobId: z.string(),
    step: z.string(),
    estimatedMs: z.number().nonnegative(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal("manifest.step.progress"),
    jobId: z.string(),
    step: z.string(),
    fraction: z.number().min(0).max(1),
    narration: z.string().optional(),
  }),
  z.object({
    type: z.literal("manifest.step.completed"),
    jobId: z.string(),
    step: z.string(),
    durationMs: z.number().nonnegative(),
    summary: z.string().optional(),
  }),
  z.object({
    type: z.literal("manifest.step.failed"),
    jobId: z.string(),
    step: z.string(),
    reason: z.string(),
    recoverable: z.boolean(),
  }),
  // ─── Wave 2 event schemas ─────────────────────────────────────────────────
  z.object({
    type: z.literal("architect.turn"),
    workspaceId: z.string(),
    turnIdx: z.number().int().nonnegative(),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    at: isoDateTime,
  }),
  z.object({
    type: z.literal("architect.streaming"),
    workspaceId: z.string(),
    token: z.string(),
    at: isoDateTime,
  }),
  z.object({
    type: z.literal("manifest.changed"),
    workspaceId: z.string(),
    snapshotId: z.string(),
    changeSummary: z.string(),
    at: isoDateTime,
  }),
  z.object({
    type: z.literal("snapshot.created"),
    workspaceId: z.string(),
    snapshotId: z.string(),
    snapshotIdx: z.number().int().nonnegative(),
    triggerType: z.enum(["RECIPE_APPLY", "INCREMENTAL", "REVERT", "IMPORT", "DUPLICATE"]),
    at: isoDateTime,
  }),
  z.object({
    type: z.literal("entitlement.unlock.triggered"),
    workspaceId: z.string(),
    refType: z.string(),
    refId: z.string(),
    suggestedAmount: z.number(),
    at: isoDateTime,
  }),
  z.object({
    type: z.literal("test.execution"),
    scope: z.enum(["AGENT", "WORKSPACE", "TOOL"]),
    targetId: z.string(),
    result: z.enum(["PASS", "FAIL", "ERROR"]),
    at: isoDateTime,
  }),
  z.object({
    type: z.literal("voice.provider.health"),
    kind: z.string(),
    healthy: z.boolean(),
    at: isoDateTime,
  }),
  // ─── Per-agent / per-team chat multiplex envelope ──────────────────────────
  // Inner `event` is intentionally permissive (z.unknown()) — it carries the
  // existing ChatStreamEvent union from @aizona/platform-agents. The producer
  // (workspace-agent / chat router) emits already-typed events; the consumer
  // (browser hook) demultiplexes by streamId and casts the inner event back
  // to ChatStreamEvent. Keeping the inner schema as `unknown` here avoids a
  // dependency cycle from contracts-workspace-architect → platform-agents.
  z.object({
    type: z.literal("agent.chat.event"),
    streamId: z.string().min(1),
    event: z.unknown(),
  }),
]);
