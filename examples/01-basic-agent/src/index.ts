/**
 * 01 — Basic Agent
 *
 * The smallest useful ADK program: a single agent with instructions and a
 * model, executed via Runner. No tools, no guardrails, no streaming.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm start "Explain TypeScript generics"
 */

import { AnthropicProvider, Runner, defineAgent } from "@aizonaai/adk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY environment variable.");
  process.exit(1);
}

const tutor = defineAgent({
  name: "tutor",
  model: "claude-haiku-4-5-20251001",
  instructions: [
    "You are a patient programming tutor.",
    "Answer concisely (≤ 6 sentences) and prefer concrete examples over abstract theory.",
    "If the user's question is ambiguous, ask exactly one clarifying question first.",
  ].join(" "),
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey }),
});

const input = process.argv.slice(2).join(" ") || "What is a closure?";

const result = await runner.run(tutor, { input });

console.log(result.output);
console.log(
  `\n[turns=${result.turns} cost=$${result.usage.totalCostUsd.toFixed(6)} tokens=${
    result.usage.inputTokens + result.usage.outputTokens
  }]`,
);
