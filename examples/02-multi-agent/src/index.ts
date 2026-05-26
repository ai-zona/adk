/**
 * 02 — Multi-Agent Handoff
 *
 * A triage router inspects a customer message and hands off to one of three
 * specialists: billing, technical support, or sales. Each specialist has its
 * own instructions and tools; the router only decides the destination.
 *
 * Pattern: Swarm-style handoffs via `defineAgent({ handoffs: [...] })`.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm start "My last invoice has the wrong total"
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm start "The dashboard won't load in Safari"
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm start "What does the Enterprise plan include?"
 */

import { z } from "zod";
import {
  AnthropicProvider,
  Runner,
  defineAgent,
  defineTool,
} from "@aizonaai/adk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY environment variable.");
  process.exit(1);
}

// ── Tools ───────────────────────────────────────────────────────────────

const lookupInvoice = defineTool({
  name: "lookup_invoice",
  description: "Fetch the most recent invoice for a customer email.",
  inputSchema: z.object({
    email: z.string().email(),
  }),
  execute: async ({ email }) => ({
    invoiceId: "INV-2026-04-2231",
    email,
    amountUsd: 149.0,
    issuedAt: "2026-04-01",
    status: "paid",
  }),
});

const openTicket = defineTool({
  name: "open_ticket",
  description: "Create a support ticket and return its ID.",
  inputSchema: z.object({
    summary: z.string().min(10).describe("One-sentence problem summary"),
    severity: z.enum(["low", "medium", "high", "urgent"]),
  }),
  execute: async ({ summary, severity }) => ({
    ticketId: `T-${Date.now().toString(36)}`,
    summary,
    severity,
    queuedAt: new Date().toISOString(),
  }),
});

const planCatalog = defineTool({
  name: "plan_catalog",
  description: "Return the public pricing plan catalog.",
  inputSchema: z.object({}),
  execute: async () => ({
    plans: [
      { name: "Hobby", priceUsd: 0, seats: 1, support: "community" },
      { name: "Pro", priceUsd: 49, seats: 5, support: "email" },
      { name: "Enterprise", priceUsd: 499, seats: 50, support: "dedicated" },
    ],
  }),
});

// ── Specialists ─────────────────────────────────────────────────────────

const billingAgent = defineAgent({
  name: "billing",
  model: "claude-haiku-4-5-20251001",
  instructions:
    "You are a billing specialist. Look up the customer's invoice and explain the charge clearly. Never speculate about amounts — call lookup_invoice first.",
  tools: [lookupInvoice],
});

const supportAgent = defineAgent({
  name: "technical-support",
  model: "claude-haiku-4-5-20251001",
  instructions:
    "You are a technical support engineer. Gather the symptoms in one short follow-up, then open a ticket with an appropriate severity. Confirm the ticket ID back to the user.",
  tools: [openTicket],
});

const salesAgent = defineAgent({
  name: "sales",
  model: "claude-haiku-4-5-20251001",
  instructions:
    "You are a friendly sales advisor. Pull the plan catalog and recommend the most appropriate plan for the customer's described needs. Mention seat count and support tier.",
  tools: [planCatalog],
});

// ── Router ──────────────────────────────────────────────────────────────

const router = defineAgent({
  name: "triage-router",
  model: "claude-haiku-4-5-20251001",
  instructions: [
    "You are the first line of customer service. Classify the user's message and hand off to exactly one specialist.",
    "- Billing questions, invoices, refunds → billing",
    "- Bugs, outages, errors, broken features → technical-support",
    "- Pricing, plans, upgrades, trials → sales",
    "Do not attempt to answer yourself — always hand off.",
  ].join("\n"),
  handoffs: [
    { agent: billingAgent, description: "Hand off billing or invoice questions." },
    { agent: supportAgent, description: "Hand off bug reports or technical issues." },
    { agent: salesAgent, description: "Hand off pricing or plan questions." },
  ],
});

// ── Execute ─────────────────────────────────────────────────────────────

const input =
  process.argv.slice(2).join(" ") ||
  "Hey, my last invoice looks wrong — I was charged $149 but I'm on the Hobby plan.";

const runner = new Runner({
  provider: new AnthropicProvider({ providerId: 'anthropic', apiKey }),
});

const result = await runner.run(router, { input, maxTurns: 10 });

console.log("\n──────────── FINAL ────────────");
console.log(result.output);
console.log(
  `\n[turns=${result.totalTurns} cost=$${result.usage.totalCostUsd.toFixed(6)}]`,
);
