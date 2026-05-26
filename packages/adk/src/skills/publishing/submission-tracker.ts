// ──────────────────────────────────────────────────────
// Skill 12 — submission-tracker
// Track every submission in a campaign with timeline
// visualization data ordered by createdAt.
// executionMode: INLINE  (WorkspaceMessage + MeteredUsage)
// ──────────────────────────────────────────────────────

import { defineSkill } from "../define-skill";

// ─── Types ───────────────────────────────────────────

export type SubmissionStatus = "sent" | "received" | "under-review" | "accepted" | "rejected";

export interface SubmissionTimelineEntry {
  status: SubmissionStatus;
  at: Date;
  messageId: string;
}

export interface SubmissionRecord {
  submissionId: string;
  currentStatus: SubmissionStatus;
  timeline: SubmissionTimelineEntry[];
}

export interface SubmissionTrackerOutput {
  submissions: SubmissionRecord[];
  totalSends: number;
}

export interface SubmissionTrackerInput {
  campaignId: string;
}

export interface SubmissionTrackerContext {
  queryMessages: (args: {
    campaignId: string;
    workspaceId: string;
  }) => Promise<
    Array<{
      id: string;
      channelId: string;
      metadata: { submissionId?: string; status?: SubmissionStatus };
      createdAt: Date;
    }>
  >;
  queryUsage: (args: {
    campaignId: string;
  }) => Promise<Array<{ skillRef: string; count: number }>>;
  kbRead: (args: { slug: string; query: string }) => Promise<{ content: string }>;
  workspaceId: string;
}

// ─── Manifest ────────────────────────────────────────

export const submissionTrackerManifest = defineSkill({
  name: "submission-tracker",
  version: "1.0.0",
  description:
    "Track every submission in a campaign with timeline visualization data. " +
    "Aggregates WorkspaceMessage events and MeteredUsage by submissionId; " +
    "timeline entries are ordered by createdAt ascending.",
  category: "publishing",
  tags: ["tracking", "timeline", "campaign"],
  tools: [
    {
      name: "track",
      description: "Aggregate WorkspaceMessage + MeteredUsage by submissionId.",
      inputSchema: {
        type: "object",
        required: ["campaignId"],
        properties: {
          campaignId: { type: "string" },
        },
      },
      outputSchema: {
        type: "object",
        required: ["submissions", "totalSends"],
        properties: {
          submissions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                submissionId: { type: "string" },
                currentStatus: {
                  type: "string",
                  enum: ["sent", "received", "under-review", "accepted", "rejected"],
                },
                timeline: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      status: { type: "string" },
                      at: { type: "string", format: "date-time" },
                      messageId: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          totalSends: { type: "integer" },
        },
      },
    },
  ],
  metadata: {
    executionMode: "INLINE",
  },
});

// ─── Skill Object ────────────────────────────────────

export const submissionTracker = {
  manifest: submissionTrackerManifest,

  async execute(
    input: SubmissionTrackerInput,
    ctx: SubmissionTrackerContext,
  ): Promise<SubmissionTrackerOutput> {
    // Fetch messages + usage in parallel; also warm the submission-history KB entry.
    const [messages, usage] = await Promise.all([
      ctx.queryMessages({ campaignId: input.campaignId, workspaceId: ctx.workspaceId }),
      ctx.queryUsage({ campaignId: input.campaignId }),
    ]);
    await ctx.kbRead({ slug: "submission-history", query: input.campaignId });

    // Group timeline entries by submissionId.
    const grouped = new Map<string, SubmissionTimelineEntry[]>();
    for (const m of messages) {
      const id = m.metadata.submissionId;
      const status = m.metadata.status;
      if (!id || !status) continue;
      const entries = grouped.get(id) ?? [];
      entries.push({ status, at: m.createdAt, messageId: m.id });
      grouped.set(id, entries);
    }

    // Sort each submission's timeline ascending by createdAt; derive currentStatus from last entry.
    const submissions: SubmissionRecord[] = [...grouped.entries()].map(
      ([submissionId, timeline]) => {
        timeline.sort((a, b) => a.at.getTime() - b.at.getTime());
        return {
          submissionId,
          currentStatus: (timeline[timeline.length - 1] as SubmissionTimelineEntry).status,
          timeline,
        };
      },
    );

    // totalSends = sum of MeteredUsage rows whose skillRef begins with "email-campaign".
    const totalSends = usage.reduce(
      (acc, u) => acc + (u.skillRef.startsWith("email-campaign") ? u.count : 0),
      0,
    );

    return { submissions, totalSends };
  },
};
