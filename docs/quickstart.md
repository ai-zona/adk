# Quickstart — 5 minutes to a running agent

Build, run, and stream your first agent in less than five minutes. No platform account required — you bring your own Anthropic key and the ADK does the rest.

## Prerequisites

- Node.js **≥ 20** (`node -v`)
- An [Anthropic API key](https://console.anthropic.com/) (`sk-ant-…`)
- pnpm or npm

## 1. Install

```bash
mkdir hello-adk && cd hello-adk
npm init -y
npm install @aizonaai/adk zod
npm install -D tsx typescript @types/node
```

Or skip the boilerplate with the CLI:

```bash
npx @aizonaai/adk-cli init hello-adk
cd hello-adk
```

## 2. Write the agent

Save this as `index.ts`:

```typescript
import { z } from "zod";
import {
  AnthropicProvider,
  Runner,
  defineAgent,
  defineTool,
} from "@aizonaai/adk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error("Set ANTHROPIC_API_KEY");

const timeNow = defineTool({
  name: "time_now",
  description: "Return the current UTC timestamp in ISO-8601 format",
  inputSchema: z.object({}),
  execute: async () => ({ now: new Date().toISOString() }),
});

const agent = defineAgent({
  name: "hello-agent",
  model: "claude-haiku-4-5-20251001",
  instructions:
    "You are a concise assistant. When asked for the time, call time_now first.",
  tools: [timeNow],
});

const runner = new Runner({
  provider: new AnthropicProvider({ providerId: "anthropic", apiKey }),
});

const result = await runner.run(agent, {
  input: process.argv.slice(2).join(" ") || "What time is it?",
});

console.log(result.output);
console.log(
  `\n[turns=${result.totalTurns} cost=$${result.usage.totalCostUsd.toFixed(6)}]`,
);
```

## 3. Run it

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npx tsx index.ts "What time is it, and what's a closure?"
```

Expected output (abridged):

```
The current UTC time is 2026-05-26T14:32:11.812Z.

A closure is a function that captures variables from its surrounding lexical scope…

[turns=2 cost=$0.000418]
```

## 4. Stream the output

Replace the `runner.run(...)` block with the streaming generator:

```typescript
for await (const event of runner.stream(agent, { input: "Tell me a haiku" })) {
  if (event.type === "text_delta") process.stdout.write(event.content);
  if (event.type === "tool_call_start")
    console.log(`\n→ ${event.toolName}(${JSON.stringify(event.input)})`);
  if (event.type === "run_complete")
    console.log(`\n[cost=$${event.result.usage.totalCostUsd.toFixed(6)}]`);
}
```

You will see tokens print as the model generates them.

## 5. Add a guardrail

Stop runaway spend and screen for prompt injection in three extra lines:

```typescript
import { budgetLimit, contentFilter } from "@aizonaai/adk";

const agent = defineAgent({
  name: "hello-agent",
  model: "claude-haiku-4-5-20251001",
  instructions: "You are a concise assistant.",
  tools: [timeNow],
  guardrails: [
    { guardrail: contentFilter({ blockedKeywords: ["ignore previous"] }) },
    { guardrail: budgetLimit(0.05) }, // hard cap at $0.05 per run
  ],
});
```

Guardrails throw `GuardrailTripwireError` — catch it to surface a clear message instead of retrying.

## Where next

- **Multi-agent handoffs** → [`examples/02-multi-agent`](../examples/02-multi-agent/)
- **Layered guardrails** → [`examples/03-guardrails`](../examples/03-guardrails/) and [security.md](./security.md)
- **MCP tools (7,000+ integrations)** → [`examples/05-mcp-tools`](../examples/05-mcp-tools/)
- **Production HTTP server** → [`examples/06-production-server`](../examples/06-production-server/) and [deployment.md](./deployment.md)
- **CLI reference** → [cli-reference.md](./cli-reference.md)
- **When something breaks** → [troubleshooting.md](./troubleshooting.md)

## Cost expectations

With `claude-haiku-4-5` (the default in these examples):

| Workload         | Approx. cost per run |
|------------------|----------------------|
| Single short Q/A | $0.0001 – $0.0005    |
| Tool use, 2–3 turns | $0.0005 – $0.002 |
| Long context (32k tokens) | $0.01 – $0.03 |

You're billed by Anthropic directly — the ADK never touches your card.
