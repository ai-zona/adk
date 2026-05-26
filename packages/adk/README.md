# @aizona/adk

[![npm version](https://img.shields.io/npm/v/@aizona/adk.svg)](https://www.npmjs.com/package/@aizona/adk)
[![npm downloads](https://img.shields.io/npm/dm/@aizona/adk.svg)](https://www.npmjs.com/package/@aizona/adk)
[![license](https://img.shields.io/npm/l/@aizona/adk.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@aizona/adk.svg)](https://nodejs.org)

**Agent Development Kit** — Build, deploy, and orchestrate AI agents. Zero platform dependencies (only `zod`). ESM + CJS dual publish, full TypeScript.

## Features

- **Multi-agent orchestration** — Handoffs (Swarm pattern), parallel runners, team coordination
- **6 built-in LLM providers** — Anthropic, OpenAI, Google, xAI, Ollama, LMStudio with routing strategies
- **Guardrails engine** — Content filters, budget limits, PII redaction, consent gating
- **Skills system** — Define and compose reusable agent behaviors (publishing, research, outreach)
- **Eval harness** — Structured evaluation framework with scoring and reporting
- **Streaming** — SSE + WebSocket relay, typed event bus (16 event types)
- **Memory** — Vector-based semantic memory with pgvector backend and auto-decay
- **MCP integration** — Connect to Model Context Protocol servers
- **Realtime / Voice** — Voice conversation support via Anthropic Realtime API

## Installation

```bash
npm install @aizona/adk
# or
pnpm add @aizona/adk
# or
yarn add @aizona/adk
```

## CLI

```bash
npx adk --help
npx adk init my-agent    # scaffold a new project
npx adk test agent.ts    # run guidance
npx adk deploy agent.ts  # deploy to AIZona platform
```

## Examples

| Example | Description |
|---------|-------------|
| [hello-world](./examples/hello-world/) | Minimal agent — no tools |
| [web-scraper](./examples/web-scraper/) | Agent with a `fetch_url` tool |
| [email-assistant](./examples/email-assistant/) | Agent with a structured draft tool |

## Quick Start

```typescript
import { defineAgent, defineTool, Runner, createProvider } from "@aizona/adk";

const calculator = defineTool({
  name: "add",
  description: "Add two numbers",
  inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
  execute: async (input) => ({ result: input.a + input.b }),
});

const agent = defineAgent({
  name: "math-agent",
  instructions: "You are a helpful math assistant.",
  tools: [calculator],
});

const provider = createProvider({ providerId: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY });
const runner = new Runner({ provider });
const result = await runner.run(agent, { input: "What is 2 + 3?" });
console.log(result.output); // "The answer is 5."
```

## Core APIs

### `defineAgent(config)`

Creates an agent with instructions, tools, guardrails, and handoffs.

```typescript
const agent = defineAgent({
  name: "my-agent",
  instructions: "You are a helpful assistant.", // string or (ctx) => string
  description: "Short description for discovery",
  tools: [myTool],
  guardrails: [contentFilter()],
  handoffs: [{ agent: otherAgent, description: "Hand off for specialized tasks" }],
  outputSchema: z.object({ answer: z.string() }), // structured output
  consentLevel: "auto", // auto | notify | explicit | multi_party
  maxTurns: 25,
});
```

### `defineTool(config)`

Creates a tool with input validation and execution hooks.

```typescript
const tool = defineTool({
  name: "search",
  description: "Search the web",
  inputSchema: z.object({ query: z.string() }),
  execute: async (input, ctx) => {
    return { results: await search(input.query) };
  },
  hooks: {
    preExecute: async (input) => input, // modify or block
    postExecute: async (output) => output, // transform result
  },
});
```

### `Runner`

Main execution engine. Runs agents through a turn loop: build messages → LLM call → tool execution → guardrails → handoff → repeat.

```typescript
const runner = new Runner({ provider, eventBus, defaultMaxTurns: 25 });

// Synchronous run
const result = await runner.run(agent, {
  input: "Hello",
  messages: [], // prior conversation
  sessionId: "session-123",
  maxTurns: 10,
  signal: abortController.signal,
});

// Streaming run — yields events as they happen
for await (const event of runner.stream(agent, { input: "Hello" })) {
  switch (event.type) {
    case "turn_started": break;
    case "text_delta": process.stdout.write(event.content); break;
    case "tool_result": break;
    case "handoff": break;
    case "run_complete": console.log(event.result); break;
  }
}
```

### Guardrails

Input, output, and tool-level guardrails with tripwire support.

```typescript
import { contentFilter, budgetLimit, consentGate } from "@aizona/adk";

const agent = defineAgent({
  name: "safe-agent",
  instructions: "...",
  guardrails: [
    contentFilter({ blockedTerms: ["harmful"] }),
    budgetLimit({ maxCostUsd: 1.0 }),
    consentGate({ level: "explicit" }),
  ],
});
```

### Multi-Agent

Handoffs (Swarm pattern), parallel execution, and team orchestration.

```typescript
import { ParallelRunner, Team, agentAsTool } from "@aizona/adk";

// Route to specialists via handoffs
const router = defineAgent({
  name: "router",
  instructions: "Route to specialists",
  handoffs: [
    { agent: codeAgent, description: "For code questions" },
    { agent: mathAgent, description: "For math questions" },
  ],
});

// Parallel execution
const parallel = new ParallelRunner();
const results = await parallel.run([agent1, agent2], { input: "Analyze this" });

// Agent as tool
const researchTool = agentAsTool(researchAgent, "Research a topic deeply");
```

### LLM Providers

6 built-in providers with routing strategies.

```typescript
import { createProvider, ADKRouter } from "@aizona/adk";

const anthropic = createProvider({ providerId: "anthropic", apiKey: "sk-ant-..." });
const openai = createProvider({ providerId: "openai", apiKey: "sk-..." });

const router = new ADKRouter({
  providers: [anthropic, openai],
  strategy: "balanced", // cost-optimized | latency-optimized | quality-optimized | balanced | fallback-chain
});
```

### Skills

Define and compose reusable agent behaviors.

```typescript
import { defineSkill } from "@aizona/adk";

const summarizeSkill = defineSkill({
  name: "summarize",
  description: "Summarize a document",
  execute: async (input, ctx) => {
    const result = await ctx.runner.run(summarizerAgent, { input: input.text });
    return { summary: result.output };
  },
});
```

### Memory

Vector-based semantic memory with auto-decay.

```typescript
import { MemoryManager, EmbeddingService, PgVectorMemoryBackend } from "@aizona/adk";

const memory = new MemoryManager({
  backend: new PgVectorMemoryBackend(dbClient),
  embeddings: new EmbeddingService({ provider: anthropic }),
});

await memory.storeMemory({ content: "User prefers TypeScript", type: "fact" });
const results = await memory.searchMemories("programming language preference");
```

### Eval Harness

Structured evaluation framework.

```typescript
import { EvalHarness } from "@aizona/adk";

const harness = new EvalHarness({ runner, provider });
const report = await harness.evaluate(agent, testCases);
console.log(report.passRate, report.avgScore);
```

### Event Bus

Typed event system for real-time observability (16 event types).

```typescript
import { ADKEventBus } from "@aizona/adk";

const bus = new ADKEventBus();
bus.on("run.started", (data) => console.log("Run started:", data.runId));
bus.on("tool.invoked", (data) => console.log("Tool:", data.toolName));
```

### MCP Integration

Connect to Model Context Protocol servers.

```typescript
import { mcpServerTools } from "@aizona/adk";

const tools = await mcpServerTools({ serverUrl: "http://localhost:3000" });
const agent = defineAgent({ name: "mcp-agent", tools });
```

## Architecture

- **Turn Loop** — messages → LLM call → tool execution → guardrails → handoff check → repeat
- **Standalone** — Zero platform dependencies; works with any supported LLM provider
- **Type-Safe** — Full TypeScript with Zod validation on all boundaries
- **Composable** — Tools, guardrails, handoffs, and skills mix-and-match freely
- **Observable** — Structured event bus, distributed tracing, and streaming out of the box

## Documentation

Full documentation and guides: [github.com/ai-zona/AIZona](https://github.com/ai-zona/AIZona)

Bug reports and feature requests: [github.com/ai-zona/AIZona/issues](https://github.com/ai-zona/AIZona/issues)

## License

MIT — see [LICENSE](LICENSE) for details.
