# @aizonaai/adk

[![npm version](https://img.shields.io/npm/v/@aizonaai/adk.svg)](https://www.npmjs.com/package/@aizonaai/adk)
[![npm downloads](https://img.shields.io/npm/dm/@aizonaai/adk.svg)](https://www.npmjs.com/package/@aizonaai/adk)
[![license](https://img.shields.io/npm/l/@aizonaai/adk.svg)](LICENSE)
[![node](https://img.shields.io/node/v/@aizonaai/adk.svg)](https://nodejs.org)

**Agent Development Kit** — build, deploy, and orchestrate AI agents in TypeScript. Zero runtime dependencies beyond `zod`. Dual ESM + CJS publish, full TypeScript declarations, npm provenance.

```bash
npm install @aizonaai/adk
# or
pnpm add @aizonaai/adk
# or
yarn add @aizonaai/adk
```

> Requires Node ≥ 20.

---

## Five-minute quick start

```typescript
import { AnthropicProvider, Runner, defineAgent } from "@aizonaai/adk";

const agent = defineAgent({
  name: "tutor",
  model: "claude-haiku-4-5-20251001",
  instructions: "You are a patient programming tutor. Keep answers under 6 sentences.",
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const { output, usage } = await runner.run(agent, { input: "What is a closure?" });
console.log(output);
console.log(`cost: $${usage.totalCostUsd.toFixed(6)}`);
```

That's the entire surface for a single-agent program. From here you add tools, guardrails, handoffs, and streaming as you need them.

---

## What you can build

| Capability | API entry point | Example |
| ---------- | --------------- | ------- |
| Single agent with custom instructions | `defineAgent`, `Runner` | [01-basic-agent](https://github.com/ai-zona/adk/tree/main/examples/01-basic-agent) |
| Tools with Zod-validated inputs | `defineTool` | [web-scraper](https://github.com/ai-zona/adk/tree/main/examples/web-scraper) |
| Multi-agent handoffs (Swarm pattern) | `defineAgent({ handoffs })` | [02-multi-agent](https://github.com/ai-zona/adk/tree/main/examples/02-multi-agent) |
| Guardrails (content, PII, budget, consent) | `contentFilter`, `piiFilter`, `budgetLimit`, `consentGate` | [03-guardrails](https://github.com/ai-zona/adk/tree/main/examples/03-guardrails) |
| Token-by-token streaming | `runner.stream()`, `streamToSSE` | [04-streaming](https://github.com/ai-zona/adk/tree/main/examples/04-streaming) |
| MCP server integration | `mcpServerTools` | [05-mcp-tools](https://github.com/ai-zona/adk/tree/main/examples/05-mcp-tools) |
| Vector memory with decay | `MemoryManager`, `PgVectorMemoryBackend` | — |
| Multi-provider routing | `ADKRouter` | — |
| Sandboxed code execution | `CodeExecutor`, `createExecuteCodeTool` | — |
| Evaluation harness | `defineEvalSuite`, `runEval` | — |
| Voice / realtime | `RealtimeAgent` | — |

---

## BYOK (bring your own key)

The ADK is **provider-agnostic and standalone**. You hold the API keys; the SDK never phones home.

```typescript
import { createProvider } from "@aizonaai/adk";

// Local development — your key, your bill
const provider = createProvider({
  providerId: "anthropic",         // or "openai" | "google" | "xai" | "ollama" | "lmstudio"
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

For production deployments, put `@aizonaai/adk-server` in front so clients never see the provider key — they present a short-lived ADK key that you mint and validate. See [docs/security.md](https://github.com/ai-zona/adk/blob/main/docs/security.md) for the full pattern.

### Supported providers

| Provider | `providerId` | Notes |
| -------- | ------------ | ----- |
| Anthropic | `anthropic` | Claude family |
| OpenAI | `openai` | GPT family + structured outputs |
| Google | `google` | Gemini family |
| xAI | `xai` | Grok family |
| Ollama | `ollama` | Self-hosted; set `OLLAMA_BASE_URL` |
| LM Studio | `lmstudio` | Self-hosted; OpenAI-compatible |

---

## Core APIs

### `defineAgent(config)`

```typescript
const agent = defineAgent({
  name: "my-agent",
  model: "claude-sonnet-4-5-20250929",
  instructions: "You are a helpful assistant.", // string or (ctx) => string
  description: "Short description for handoff discovery",
  tools: [myTool],
  guardrails: [contentFilter()],
  handoffs: [{ agent: otherAgent, description: "Specialized tasks" }],
  outputSchema: z.object({ answer: z.string() }),
  consentLevel: "auto", // auto | notify | explicit | multi_party
  maxTurns: 25,
});
```

### `defineTool(config)`

```typescript
import { z } from "zod";

const search = defineTool({
  name: "search",
  description: "Search the web",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }, ctx) => ({ results: await api(query) }),
  hooks: {
    preExecute: async (input) => input,    // modify or block
    postExecute: async (output) => output, // transform result
  },
});
```

### `Runner`

```typescript
const runner = new Runner({ provider, eventBus, defaultMaxTurns: 25 });

// One-shot
const result = await runner.run(agent, {
  input: "Hello",
  messages: [],         // prior conversation
  sessionId: "s-123",
  maxTurns: 10,
  signal: abort.signal,
});

// Streaming
for await (const event of runner.stream(agent, { input: "Hello" })) {
  if (event.type === "text_delta") process.stdout.write(event.content);
  if (event.type === "run_complete") console.log(event.result.usage);
}
```

### Guardrails

```typescript
import { contentFilter, piiFilter, budgetLimit, consentGate } from "@aizonaai/adk";

defineAgent({
  // …
  guardrails: [
    contentFilter({ blockedTerms: ["ignore previous"] }),
    piiFilter({ redact: true }),
    budgetLimit({ maxCostUsd: 0.50 }),
    consentGate({ level: "explicit" }),
  ],
});
```

Tripwire violations throw `GuardrailTripwireError` — catch at the call site.

### Multi-agent

```typescript
import { ParallelRunner, Team, agentAsTool } from "@aizonaai/adk";

// Handoff routing
const router = defineAgent({
  name: "router",
  handoffs: [
    { agent: codeAgent, description: "Code questions" },
    { agent: mathAgent, description: "Math questions" },
  ],
});

// Parallel fan-out
const parallel = new ParallelRunner();
const results = await parallel.run([agent1, agent2], { input: "Analyze this" });

// Wrap an agent as a tool
const researchTool = agentAsTool(researchAgent, "Research a topic deeply");
```

### Provider routing

```typescript
import { ADKRouter } from "@aizonaai/adk";

const router = new ADKRouter({
  providers: [anthropic, openai],
  strategy: "balanced", // cost-optimized | latency-optimized | quality-optimized | balanced | fallback-chain
});
```

### Skills

```typescript
import { defineSkill } from "@aizonaai/adk";

const summarize = defineSkill({
  name: "summarize",
  description: "Summarize a document",
  execute: async (input, ctx) => {
    const r = await ctx.runner.run(summarizerAgent, { input: input.text });
    return { summary: r.output };
  },
});
```

### Memory

```typescript
import { MemoryManager, EmbeddingService, PgVectorMemoryBackend } from "@aizonaai/adk";

const memory = new MemoryManager({
  backend: new PgVectorMemoryBackend(dbClient),
  embeddings: new EmbeddingService({ provider: anthropic }),
});

await memory.storeMemory({ content: "User prefers TypeScript", type: "fact" });
const hits = await memory.searchMemories("programming language preference");
```

### Event bus

```typescript
import { ADKEventBus } from "@aizonaai/adk";

const bus = new ADKEventBus();
bus.on("run.started",     (e) => console.log("→", e.runId));
bus.on("tool.invoked",    (e) => console.log("  tool:", e.toolName));
bus.on("run.completed",   (e) => console.log("✓", e.usage.totalCostUsd, "USD"));
```

### MCP integration

```typescript
import { mcpServerTools } from "@aizonaai/adk";

const tools = await mcpServerTools({ transport: "http", url: "http://localhost:3000/mcp" });
const agent = defineAgent({ name: "mcp-agent", tools });
```

### Eval harness

```typescript
import { defineEvalSuite, runEval } from "@aizonaai/adk";

const suite = defineEvalSuite({
  name: "factuality",
  cases: [{ input: "Capital of France?", expected: /Paris/i }],
});

const report = await runEval(suite, agent, { runner });
console.log(report.passRate);
```

---

## Architecture

- **Turn loop** — messages → LLM call → tool execution → guardrails → handoff check → repeat.
- **Standalone** — zero platform coupling. Works against any supported provider.
- **Type-safe** — full TypeScript with Zod validation on every boundary.
- **Composable** — tools, guardrails, handoffs, and skills mix freely.
- **Observable** — structured event bus, distributed tracing, streaming-first transport.

---

## Documentation

| Guide | What it covers |
| ----- | -------------- |
| [docs/deployment.md](https://github.com/ai-zona/adk/blob/main/docs/deployment.md) | Docker, Compose, Railway, Vercel, Kubernetes, sizing |
| [docs/security.md](https://github.com/ai-zona/adk/blob/main/docs/security.md) | Keys, CORS, rate limiting, validation, secrets, guardrails |
| [docs/troubleshooting.md](https://github.com/ai-zona/adk/blob/main/docs/troubleshooting.md) | Common errors, debug mode, perf, memory leaks |
| [examples/](https://github.com/ai-zona/adk/tree/main/examples) | Six runnable examples covering the production surface |

Issues and feature requests: [github.com/ai-zona/adk/issues](https://github.com/ai-zona/adk/issues).

## License

MIT — see [LICENSE](LICENSE).
