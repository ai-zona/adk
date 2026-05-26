// ──────────────────────────────────────────────────────
// Skill 12 tests — submission-tracker
// TDD: red → green
// Queries WorkspaceMessage + MeteredUsage by submissionId
// Timeline entries ordered by createdAt ascending
// ──────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { submissionTracker } from "../submission-tracker";

const mk = (id: string, sub: string, status: string, day: number) =>
  ({
    id,
    channelId: "publishing",
    metadata: { submissionId: sub, status },
    createdAt: new Date(`2026-01-${String(day).padStart(2, "0")}T10:00:00Z`),
  }) as any;

const messages = [
  mk("m1", "s1", "sent", 1),
  mk("m2", "s2", "sent", 2),
  mk("m3", "s1", "received", 5),
  mk("m4", "s3", "sent", 3),
  mk("m5", "s4", "rejected", 10),
  mk("m6", "s5", "accepted", 20),
] as any[];

describe("submission-tracker", () => {
  it("tracks 5 submissions with mixed statuses", async () => {
    const result = await submissionTracker.execute(
      { campaignId: "camp_1" },
      {
        queryMessages: async () => messages,
        queryUsage: async () => [{ skillRef: "email-campaign-basic", count: 5 }],
        kbRead: async () => ({ content: "" }),
        workspaceId: "ws_t",
      },
    );
    expect(result.submissions.length).toBe(5);
    expect(result.submissions.map((s) => s.currentStatus).sort()).toEqual([
      "accepted",
      "received",
      "rejected",
      "sent",
      "sent",
    ]);
  });

  it("orders timeline data by createdAt ascending per submission", async () => {
    const result = await submissionTracker.execute(
      { campaignId: "camp_1" },
      {
        queryMessages: async () => messages,
        queryUsage: async () => [],
        kbRead: async () => ({ content: "" }),
        workspaceId: "ws_t",
      },
    );
    const s1 = result.submissions.find((s) => s.submissionId === "s1");
    expect(s1?.timeline.map((t) => t.status)).toEqual(["sent", "received"]);
    expect(s1?.timeline[0].at.getTime()).toBeLessThan(s1?.timeline[1].at.getTime());
  });
});
