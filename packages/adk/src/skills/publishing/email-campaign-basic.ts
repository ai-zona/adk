// ──────────────────────────────────────────────────────
// Skill 8 — email-campaign-basic
// Send a single-touch email campaign to a contact list.
// executionMode: INLINE
// Tier-included from PRO (no AIZ unlock for basic tier).
// ──────────────────────────────────────────────────────

import { defineSkill } from "../define-skill";

// ─── Types ───────────────────────────────────────────

export interface EmailContact {
  id: string;
  name: string;
  email: string;
}

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface EmailCampaignBasicInput {
  contacts: EmailContact[];
  template: EmailTemplate;
}

export interface DeliveryReportRow {
  contactId: string;
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
}

export interface EmailCampaignBasicOutput {
  sent: number;
  failed: number;
  report: DeliveryReportRow[];
}

export interface EmailCampaignBasicContext {
  /** Retrieve a secret credential by key name (SMTP_API_KEY, POSTMARK_TOKEN, etc.). */
  secretsGet: (key: string) => Promise<string | null>;
  /** Send an HTTP request via the host-fn boundary. */
  httpFetch: (args: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: unknown;
  }) => Promise<{ status: number; body: { messageId?: string; error?: string } }>;
  /** Email transport to use. */
  transport: "sendgrid" | "postmark" | "smtp";
}

// ─── Manifest ────────────────────────────────────────

export const emailCampaignBasicManifest = defineSkill({
  name: "email-campaign-basic",
  version: "1.0.0",
  description:
    "Send a single-touch email campaign to a contact list (PRO+ tier-included). " +
    "Renders per-recipient template variables and reports per-contact delivery status.",
  category: "publishing",
  tags: ["email", "campaign", "outreach"],
  tools: [
    {
      name: "send",
      description:
        "Send a templated email to each contact and return per-recipient delivery status.",
      inputSchema: {
        type: "object",
        required: ["contacts", "template"],
        properties: {
          contacts: {
            type: "array",
            minItems: 1,
            description: "List of recipients (id, name, email).",
          },
          template: {
            type: "object",
            description:
              "Email template with subject and body (supports {{name}}, {{email}} vars).",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: ["sent", "failed", "report"],
        properties: {
          sent: { type: "number", description: "Count of successfully sent emails." },
          failed: { type: "number", description: "Count of failed deliveries." },
          report: {
            type: "array",
            description: "Per-recipient delivery status rows.",
          },
        },
      },
    },
  ],
});

// ─── Helpers ─────────────────────────────────────────

const TRANSPORT_URL: Record<EmailCampaignBasicContext["transport"], string> = {
  sendgrid: "https://api.sendgrid.com/v3/mail/send",
  postmark: "https://api.postmarkapp.com/email",
  smtp: "https://smtp.example/send",
};

const TRANSPORT_SECRET_KEY: Record<EmailCampaignBasicContext["transport"], string> = {
  sendgrid: "SMTP_API_KEY",
  postmark: "POSTMARK_TOKEN",
  smtp: "SMTP_API_KEY",
};

/** Render simple {{var}} template variables. */
function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/{{\s*(\w+)\s*}}/g, (_, k) => vars[k] ?? "");
}

// ─── Skill Object ────────────────────────────────────

export const emailCampaignBasic = {
  manifest: emailCampaignBasicManifest,

  async execute(
    input: EmailCampaignBasicInput,
    ctx: EmailCampaignBasicContext,
  ): Promise<EmailCampaignBasicOutput> {
    const secretKey = TRANSPORT_SECRET_KEY[ctx.transport];
    const apiKey = await ctx.secretsGet(secretKey);
    if (!apiKey) {
      throw new Error(`Missing transport credentials: secret "${secretKey}" not found`);
    }

    const report: DeliveryReportRow[] = [];

    for (const contact of input.contacts) {
      const vars: Record<string, string> = { name: contact.name, email: contact.email };
      const resp = await ctx.httpFetch({
        url: TRANSPORT_URL[ctx.transport],
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: {
          to: contact.email,
          subject: render(input.template.subject, vars),
          body: render(input.template.body, vars),
        },
      });

      const ok = resp.status >= 200 && resp.status < 300;
      if (ok) {
        report.push({ contactId: contact.id, status: "sent", messageId: resp.body.messageId });
      } else {
        report.push({
          contactId: contact.id,
          status: "failed",
          error: resp.body.error ?? `HTTP ${resp.status}`,
        });
      }
    }

    return {
      sent: report.filter((r) => r.status === "sent").length,
      failed: report.filter((r) => r.status === "failed").length,
      report,
    };
  },
};
