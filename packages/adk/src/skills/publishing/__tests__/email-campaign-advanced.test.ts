// ──────────────────────────────────────────────────────
// Skill 9 tests — email-campaign-advanced
// TDD: red → green
// ──────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { emailCampaignAdvanced } from "../email-campaign-advanced";

const contacts = [
  { id: "c1", name: "A", email: "a@x.test" },
  { id: "c2", name: "B", email: "b@x.test" },
];
const baseTemplate = { subject: "Hi {{name}}", body: "Body for {{name}}" };

const ctxOk = (over: Partial<Record<string, unknown>> = {}) => ({
  checkEntitlement: vi.fn(async () => ({ unlocked: true })),
  dataApiCall: vi.fn(async () => ({ ok: true })),
  kbRead: vi.fn(async () => ({ content: "" })),
  chatSend: vi.fn(async () => undefined),
  sleep: vi.fn(async () => undefined),
  workspaceId: "ws_t",
  managerAgentId: "ag_mgr",
  ...over,
});

describe("email-campaign-advanced", () => {
  it("orchestrates 2 A/B variants with sequencing", async () => {
    const ctx = ctxOk();
    const result = await emailCampaignAdvanced.execute(
      {
        contacts,
        baseTemplate,
        abSubjectVariants: ["A subject", "B subject"],
        sequencingRules: { touches: 2, waitDays: 3 },
      },
      ctx,
    );
    expect(result.variants.length).toBe(2);
    expect(result.touches).toBe(2);
    expect(ctx.chatSend).toHaveBeenCalled(); // manager pinged
  });

  it("returns ENTITLEMENT_DENIED when not unlocked", async () => {
    await expect(() =>
      emailCampaignAdvanced.execute(
        {
          contacts,
          baseTemplate,
          abSubjectVariants: ["A"],
          sequencingRules: { touches: 1, waitDays: 0 },
        },
        ctxOk({ checkEntitlement: vi.fn(async () => ({ unlocked: false })) }),
      ),
    ).rejects.toThrow("ENTITLEMENT_DENIED");
  });

  it("enforces sequencing waits between touches", async () => {
    const ctx = ctxOk();
    const result = await emailCampaignAdvanced.execute(
      {
        contacts,
        baseTemplate,
        abSubjectVariants: ["A"],
        sequencingRules: { touches: 3, waitDays: 2 },
      },
      ctx,
    );
    expect(ctx.sleep).toHaveBeenCalledTimes(2); // 3 touches → 2 inter-touch waits
    expect(result.touches).toBe(3);
  });
});
