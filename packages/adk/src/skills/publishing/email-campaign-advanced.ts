// ──────────────────────────────────────────────────────
// Skill 9 — email-campaign-advanced
// Orchestrated multi-touch A/B email campaign with
// deliverability optimisation, open-rate tracking, and
// follow-up sequencing.
// executionMode: INLINE
// AIZ unlock: 200  (entitlement-gated via checkEntitlement)
// ──────────────────────────────────────────────────────

import { defineSkill } from "../define-skill";

// ─── Types ───────────────────────────────────────────

export interface EmailCampaignAdvancedInput {
  contacts: { id: string; name: string; email: string }[];
  baseTemplate: { subject: string; body: string };
  /** 1–4 alternative subject lines to A/B test. */
  abSubjectVariants: string[];
  sequencingRules: { touches: number; waitDays: number };
}

export interface CampaignVariant {
  subject: string;
  recipientCount: number;
}

export interface EmailCampaignAdvancedOutput {
  variants: CampaignVariant[];
  touches: number;
  totalSent: number;
}

export interface EmailCampaignAdvancedContext {
  /** Entitlement gate — must resolve `unlocked: true` or the skill throws ENTITLEMENT_DENIED. */
  checkEntitlement: (ref: { type: "SKILL"; refId: string }) => Promise<{ unlocked: boolean }>;
  /** Data API call (deliverability platform, open-rate tracker, etc.) */
  dataApiCall: (args: {
    slug: string;
    op: string;
    params: Record<string, unknown>;
  }) => Promise<unknown>;
  /** Knowledge-base read — used to pull sequencing best-practice playbook. */
  kbRead: (args: { slug: string; query: string }) => Promise<{ content: string }>;
  /** Internal agent chat — used to ping the manager with campaign progress. */
  chatSend: (args: { agentId: string; channel: string; text: string }) => Promise<void>;
  /** Sleep helper (takes milliseconds). Injected so tests stay synchronous. */
  sleep: (ms: number) => Promise<void>;
  /** Workspace owning this campaign run. */
  workspaceId: string;
  /** Agent ID to notify with campaign progress updates. */
  managerAgentId: string;
}

// ─── Manifest ────────────────────────────────────────

export const emailCampaignAdvancedManifest = defineSkill({
  name: "email-campaign-advanced",
  version: "1.0.0",
  description:
    "Orchestrated multi-touch email campaign with A/B subject-line variants, " +
    "deliverability optimisation, open-rate tracking, and follow-up sequencing. " +
    "Requires AIZ unlock 200.",
  category: "publishing",
  tags: ["email", "campaign", "ab-testing", "sequencing", "premium"],
  tools: [
    {
      name: "orchestrate",
      description:
        "Run an A/B-tested multi-touch outreach sequence; ping the manager after each touch.",
      inputSchema: {
        type: "object",
        required: ["contacts", "baseTemplate", "abSubjectVariants", "sequencingRules"],
        properties: {
          contacts: {
            type: "array",
            minItems: 1,
            description: "List of recipients (id, name, email).",
          },
          baseTemplate: {
            type: "object",
            description: "Base email template with subject and body.",
          },
          abSubjectVariants: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            description: "Alternative subject lines for A/B testing (1–4).",
          },
          sequencingRules: {
            type: "object",
            description: "Number of touches and wait days between touches.",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["variants", "touches", "totalSent"],
        properties: {
          variants: {
            type: "array",
            description: "Per-variant recipient distribution.",
          },
          touches: {
            type: "number",
            description: "Total number of campaign touches executed.",
          },
          totalSent: {
            type: "number",
            description: "Aggregate send count across all touches and variants.",
          },
        },
      },
    },
  ],
  metadata: {
    aizUnlockRequired: 200,
  },
});

// ─── Skill Object ────────────────────────────────────

export const emailCampaignAdvanced = {
  manifest: emailCampaignAdvancedManifest,

  async execute(
    input: EmailCampaignAdvancedInput,
    ctx: EmailCampaignAdvancedContext,
  ): Promise<EmailCampaignAdvancedOutput> {
    // ── Entitlement gate ──────────────────────────────
    const ent = await ctx.checkEntitlement({ type: "SKILL", refId: "email-campaign-advanced" });
    if (!ent.unlocked) {
      throw new Error("ENTITLEMENT_DENIED: email-campaign-advanced not unlocked for workspace");
    }

    // ── Pull sequencing playbook from KB ─────────────
    await ctx.kbRead({
      slug: "publishing-industry-knowledge",
      query: "email sequencing best practices",
    });

    // ── Partition contacts across A/B variants ────────
    const N = input.abSubjectVariants.length;
    const variants: CampaignVariant[] = input.abSubjectVariants.map((subject, idx) => ({
      subject,
      recipientCount: input.contacts.filter((_, i) => i % N === idx).length,
    }));

    // ── Multi-touch send loop ─────────────────────────
    let totalSent = 0;
    const { touches, waitDays } = input.sequencingRules;

    for (let touch = 0; touch < touches; touch++) {
      // Dispatch via deliverability data-api
      await ctx.dataApiCall({
        slug: "deliverability-v1",
        op: "send",
        params: {
          workspaceId: ctx.workspaceId,
          variants,
          contacts: input.contacts,
          touchIndex: touch,
        },
      });

      totalSent += input.contacts.length;

      // Ping the manager after every touch
      await ctx.chatSend({
        agentId: ctx.managerAgentId,
        channel: "publishing",
        text: `Campaign touch ${touch + 1}/${touches} dispatched (${input.contacts.length} recipients, ${N} variants)`,
      });

      // Wait between touches (skip after the final touch)
      if (touch < touches - 1) {
        await ctx.sleep(waitDays * 86_400_000);
      }
    }

    return { variants, touches, totalSent };
  },
};
