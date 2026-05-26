/**
 * 04 — Streaming
 *
 * Stream agent output token-by-token using `runner.stream()`. We render text
 * deltas to stdout in real time, surface tool calls inline, and print final
 * cost + token usage when the run completes.
 *
 * Run:
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm start "Write a 4-line haiku about Postgres"
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

const timeNow = defineTool({
  name: "time_now",
  description: "Return the current UTC timestamp in ISO-8601 format.",
  inputSchema: z.object({}),
  execute: async () => ({ now: new Date().toISOString() }),
});

const agent = defineAgent({
  name: "streamer",
  model: "claude-haiku-4-5-20251001",
  instructions:
    "You are a concise, expressive writer. When asked for the time, call time_now first.",
  tools: [timeNow],
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey }),
});

const input =
  process.argv.slice(2).join(" ") ||
  "What time is it right now? Then write a 4-line haiku about databases.";

// Abort after 30 s so a stuck stream doesn't hang the demo
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);

try {
  process.stdout.write("\x1b[2m"); // dim while streaming meta
  for await (const event of runner.stream(agent, { input, signal: controller.signal })) {
    switch (event.type) {
      case "turn_started":
        process.stdout.write(`\x1b[0m\n[turn ${event.turnIndex + 1}]\n\x1b[1m`);
        break;
      case "text_delta":
        process.stdout.write(event.content);
        break;
      case "tool_invoked":
        process.stdout.write(`\x1b[0m\n\x1b[36m→ tool ${event.toolName}(${JSON.stringify(event.input)})\x1b[0m\n`);
        break;
      case "tool_result":
        process.stdout.write(`\x1b[36m← ${JSON.stringify(event.output)}\x1b[0m\n\x1b[1m`);
        break;
      case "handoff":
        process.stdout.write(`\x1b[0m\n\x1b[33m⇢ handoff → ${event.toAgent}\x1b[0m\n`);
        break;
      case "run_complete":
        process.stdout.write(
          `\x1b[0m\n\n[turns=${event.result.turns} cost=$${event.result.usage.totalCostUsd.toFixed(6)} tokens=${
            event.result.usage.inputTokens + event.result.usage.outputTokens
          }]\n`,
        );
        break;
    }
  }
} finally {
  clearTimeout(timeout);
  process.stdout.write("\x1b[0m");
}
