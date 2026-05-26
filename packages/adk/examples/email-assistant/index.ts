/**
 * Email Assistant — agent with a structured draft tool
 *
 * Demonstrates:
 *  - defineTool() with rich Zod schema (enum, default, email validation)
 *  - Side-effectful tool (in a real app, this would call your email API)
 *  - Agent instructions that guide multi-step behaviour
 *
 * Run:
 *   ANTHROPIC_API_KEY=<key> npx tsx index.ts \
 *     "Draft a follow-up to sarah@example.com about last week's Q3 review"
 */

import { z } from "zod";
import { AnthropicProvider, Runner, defineAgent, defineTool } from "@aizonaai/adk";

const draftEmailTool = defineTool({
  name: "draft_email",
  description: "Create an email draft with the specified recipient, subject, and body",
  inputSchema: z.object({
    to: z.string().email().describe("Recipient email address"),
    subject: z.string().describe("Email subject line (concise, under 60 chars)"),
    body: z.string().describe("Full email body text"),
    tone: z
      .enum(["professional", "friendly", "formal"])
      .default("professional")
      .describe("Writing tone"),
  }),
  execute: async ({ to, subject, body, tone }) => {
    // In a real app: call SendGrid, Nodemailer, Gmail API, etc.
    console.log("\n─── EMAIL DRAFT ───────────────────────────────");
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Tone:    ${tone}`);
    console.log();
    console.log(body);
    console.log("───────────────────────────────────────────────\n");
    return {
      success: true,
      draftId: `draft_${Date.now()}`,
      message: `Draft saved for ${to}`,
    };
  },
});

const agent = defineAgent({
  name: "email-assistant",
  instructions: `You are an expert email writing assistant.

When asked to write or draft an email:
1. Identify the recipient, subject, and purpose from the user's request
2. Choose an appropriate tone (professional by default)
3. Call draft_email to create the draft
4. Confirm what you drafted and offer to adjust tone or content

Write clear, concise emails. Avoid filler phrases like "I hope this email finds you well."`,
  model: "claude-haiku-4-5-20251001",
  tools: [draftEmailTool],
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const result = await runner.run(agent, {
  input:
    process.argv[2] ??
    "Draft a professional follow-up email to sarah@acmecorp.com about the Q3 budget review meeting we had last week.",
});

console.log(result.output);
