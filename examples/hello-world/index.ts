/**
 * Hello World — minimal ADK agent
 *
 * The simplest possible agent: a name, instructions, and a model.
 * No tools, no sessions, no multi-agent routing — just a direct chat.
 *
 * Run:
 *   ANTHROPIC_API_KEY=<key> npx tsx index.ts "Hello!"
 */

import { AnthropicProvider, Runner, defineAgent } from "@aizonaai/adk";

const agent = defineAgent({
  name: "hello-world",
  instructions:
    "You are a friendly assistant. Greet users warmly and answer their questions concisely.",
  model: "claude-haiku-4-5-20251001",
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const result = await runner.run(agent, {
  input: process.argv[2] ?? "Hello! What can you do?",
});

console.log(result.output);
console.log(
  `\n[${result.usage.totalCostUsd.toFixed(6)} USD | ${result.usage.inputTokens + result.usage.outputTokens} tokens]`,
);
