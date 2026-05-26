// ──────────────────────────────────────────────────────
// Skill 8 tests — email-campaign-basic
// TDD: red → green
// ──────────────────────────────────────────────────────

import { describe, expect, it, vi } from "vitest";
import { emailCampaignBasic } from "../email-campaign-basic";

const contacts = [
  ["c1", "A. Smith"],
  ["c2", "B. Jones"],
  ["c3", "C. Doe"],
].map(([id, name]) => ({ id, name, email: `${id}@pub.example` }));

describe("email-campaign-basic", () => {
  it("sends to all 3 contacts with mock transport", async () => {
    const secretsGet = vi.fn(async () => "test-key");
    const httpFetch = vi.fn(async () => ({ status: 202, body: { messageId: "mid-test" } }));
    const result = await emailCampaignBasic.execute(
      { contacts, template: { subject: "Hi {{name}}", body: "Hello {{name}}" } },
      { secretsGet, httpFetch, transport: "sendgrid" },
    );
    expect(result.sent).toBe(3);
    expect(httpFetch).toHaveBeenCalledTimes(3);
  });

  it("reports per-recipient delivery status", async () => {
    const secretsGet = vi.fn(async () => "test-key");
    const httpFetch = vi
      .fn()
      .mockResolvedValueOnce({ status: 202, body: { messageId: "m1" } })
      .mockResolvedValueOnce({ status: 500, body: { error: "transient" } })
      .mockResolvedValueOnce({ status: 202, body: { messageId: "m3" } });
    const result = await emailCampaignBasic.execute(
      { contacts, template: { subject: "S", body: "B" } },
      { secretsGet, httpFetch, transport: "sendgrid" },
    );
    expect(result.report.map((r) => r.status)).toEqual(["sent", "failed", "sent"]);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
  });
});
