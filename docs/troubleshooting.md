# Troubleshooting

Runbook for common failures in `@aizonaai/adk` and `@aizonaai/adk-server`. Each entry has a symptom, a root cause to verify, and a fix.

## Contents

- [Common errors](#common-errors)
- [Debug mode](#debug-mode)
- [Log format](#log-format)
- [Performance tuning](#performance-tuning)
- [Memory leak prevention](#memory-leak-prevention)
- [Streaming issues](#streaming-issues)
- [Multi-agent issues](#multi-agent-issues)
- [Provider issues](#provider-issues)

---

## Common errors

### `ADKProviderError: 401 Unauthorized`

**Symptom**: Every run fails immediately with a 401 from Anthropic / OpenAI.

**Verify**: Is the right key in the environment? `echo $ANTHROPIC_API_KEY | cut -c1-15`. Are you on the right project (Anthropic keys are project-scoped)? Is the key revoked?

**Fix**: Set the key in the right scope (Compose `environment:`, Kubernetes `secretKeyRef`, Vercel project env). Restart the process — Node reads env at start.

---

### `ADKProviderError: 429 Too Many Requests`

**Symptom**: Random failures under load; provider dashboard shows rate-limit hits.

**Verify**: Check your tier limits at the provider. Watch the `Retry-After` header — values > 30 s usually mean you've hit the token-per-minute cap, not RPM.

**Fix**:
- Add `ADKRouter` with a `fallback-chain` strategy to spill to a second provider.
- Lower concurrency on burst paths (queue runs in an ingest worker).
- Apply for a higher tier; provider tiers gate aggressively below paid usage.

---

### `Error: ADK server requires a validateApiKey function in production`

**Symptom**: Server refuses to start when `NODE_ENV=production`.

**Cause**: Anonymous mode is disabled in production by design. Without a validator any caller could spend your provider credits.

**Fix**: Pass `validateApiKey` to `createServer({ … })`. Look up the key against your DB and return `null` for unknown/expired/inactive keys. See [security.md → Issuing ADK keys](./security.md#issuing-adk-keys).

---

### `GuardrailTripwireError: budget_limit_exceeded`

**Symptom**: A run aborts mid-way with a tripwire error.

**Cause**: The agent crossed `maxCostUsd` for the run. Working as intended.

**Fix**: Investigate *why* the agent spent so much. Common: a tool returns a huge payload that re-enters the context. Truncate tool outputs, lower `maxTurns`, or split into a multi-agent handoff.

---

### `Error: Max turns exceeded`

**Symptom**: Run terminates with `maxTurns` reached and no final answer.

**Cause**: The agent is looping — usually calling the same tool repeatedly because it can't parse the result.

**Fix**:
- Inspect the message trail (`result.messages`) for the loop pattern.
- Tighten tool output: structured JSON beats prose for the model to act on.
- Add an `outputSchema` to force the agent toward a terminating answer.
- Raise `maxTurns` only as a last resort — usually the prompt or tool is at fault.

---

### `TypeError: fetch failed (ECONNRESET)` / `ETIMEDOUT`

**Symptom**: Sporadic provider call failures.

**Cause**: Network jitter or upstream provider degradation.

**Fix**: The provider classes have built-in retry on transient errors. If you see persistent failures, check `https://status.anthropic.com` / `https://status.openai.com`. For self-hosted Ollama, raise `OLLAMA_BASE_URL` host file descriptors and worker count.

---

### `Error: invalid_tool_input` from a Zod-validated tool

**Symptom**: Tool input fails validation even though the model "seems" to call it correctly.

**Cause**: The model emitted a string where a number was expected, or omitted a default field, or returned an empty `{}` because the schema description was unclear.

**Fix**: Add `.describe(...)` on every Zod field — descriptions become part of the tool schema passed to the model. Use `z.coerce.number()` for fields the model often stringifies. Make optional fields `.optional()` instead of `.default()` when defaults confuse the model.

---

### `ESM resolution error` / `ERR_UNSUPPORTED_DIR_IMPORT`

**Symptom**: `require()` of `@aizonaai/adk` fails in a CJS-only consumer.

**Cause**: The package publishes dual ESM/CJS, but some bundlers cache the wrong entry.

**Fix**: Clear `node_modules` and the bundler cache, ensure your tsconfig has `"moduleResolution": "Bundler"` or `"NodeNext"`. The published `exports` map handles `.js` (import) and `.cjs` (require) automatically.

---

## Debug mode

### Server side

```bash
ADK_LOG_LEVEL=debug node packages/adk-server/dist/start.js
```

### SDK side

Subscribe to the event bus — every internal step emits a typed event:

```typescript
import { Runner, ADKEventBus } from "@aizonaai/adk";

const bus = new ADKEventBus();
bus.on("run.started", (e) => console.log("→", e.runId));
bus.on("turn.completed", (e) => console.log("  turn", e.turnIndex, e.usage));
bus.on("tool.invoked", (e) => console.log("  tool", e.toolName, e.input));
bus.on("tool.completed", (e) => console.log("  ←", e.toolName, e.durationMs, "ms"));
bus.on("guardrail.tripwire", (e) => console.error("⚠ tripwire", e.guardrailName, e.reason));
bus.on("run.completed", (e) => console.log("✓", e.runId, e.usage.totalCostUsd, "USD"));

const runner = new Runner({ provider, eventBus: bus });
```

### Tracing

For deeper investigation wire up the `ConsoleExporter` (stdout) or `LangfuseExporter` (full timeline UI):

```typescript
import { Tracer, ConsoleExporter, LangfuseExporter } from "@aizonaai/adk";

const tracer = new Tracer({
  exporters: [
    new ConsoleExporter(),
    new LangfuseExporter({
      host: process.env.LANGFUSE_HOST,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
      secretKey: process.env.LANGFUSE_SECRET_KEY!,
    }),
  ],
});
```

Langfuse will visualise every turn, tool call, and token cost — invaluable for diagnosing prompt regressions.

---

## Log format

The server emits structured JSON lines. Typical record:

```json
{
  "level": "info",
  "ts": "2026-05-26T14:32:11.812Z",
  "event": "run.completed",
  "runId": "run_8f3a1c",
  "agentName": "support-bot",
  "apiKeyId": "key_4e2",
  "model": "claude-sonnet-4-5",
  "inputTokens": 1842,
  "outputTokens": 312,
  "costUsd": 0.00763,
  "latencyMs": 4210,
  "statusCode": 200
}
```

Recommended ingestion: parse with `jq`, ship via Vector or Fluent Bit, query in Loki / Datadog / CloudWatch Logs Insights.

Useful filters:

```bash
# Slow runs in the last hour
journalctl -u adk-server --since '1 hour ago' --output json \
  | jq 'select(.event == "run.completed" and .latencyMs > 10000)'

# Top spenders
... | jq 'select(.event == "run.completed") | {apiKeyId, costUsd}' \
    | jq -s 'group_by(.apiKeyId) | map({key: .[0].apiKeyId, spend: map(.costUsd) | add}) | sort_by(-.spend)'
```

---

## Performance tuning

| Symptom                          | Lever                                                            |
| -------------------------------- | ---------------------------------------------------------------- |
| High p95 latency                 | Switch to a faster model (`claude-haiku-4-5`) for routing/handoff agents. |
| Many redundant tool calls        | Add `outputSchema` to force structured answers; tighten instructions. |
| Long-running agent loops         | Drop `maxTurns`; split into specialist handoffs.                 |
| Slow startup / cold starts       | Pre-warm the provider client (issue a tiny completion at boot).  |
| High token cost per run          | Enable session compaction (`ContextManager` + `compactMessages`). |
| LLM is slow on huge contexts     | Truncate tool results before they re-enter the context.          |
| WebSocket clients dropping       | Raise `BackpressuredStream.highWaterMark`; check client read rate. |

### Session compaction

For long conversations, compact old turns into summaries to keep context lean:

```typescript
import { ContextManager, compactMessages } from "@aizonaai/adk";

const ctx = new ContextManager({
  maxTokens: 100_000,
  compactionThreshold: 0.75, // start compacting at 75% full
  summarizer: contextSummarizer,
});

const compacted = await compactMessages(messages, { provider, targetTokens: 8_000 });
```

### Routing

Use `ADKRouter` to send cheap turns to Haiku and expensive ones to Sonnet/Opus:

```typescript
import { ADKRouter } from "@aizonaai/adk";

const router = new ADKRouter({
  providers: [anthropic, openai],
  strategy: "balanced", // cost-optimized | latency-optimized | quality-optimized | balanced | fallback-chain
});
```

---

## Memory leak prevention

Long-running Node processes leak when references outlive their purpose. The patterns below cover the recurring offenders in agent code.

### Don't accumulate event listeners

If you `bus.on(...)` inside a request handler, you'll add a listener per request:

```typescript
// ❌ leaks: registers a new listener on every request
app.post("/run", (req, res) => {
  bus.on("turn.completed", (e) => res.write(JSON.stringify(e)));
});

// ✅ scope listeners to one run and remove them
app.post("/run", async (req, res) => {
  const onTurn = (e) => res.write(JSON.stringify(e));
  bus.on("turn.completed", onTurn);
  try { await runner.run(agent, { input: req.body.input }); }
  finally { bus.off("turn.completed", onTurn); }
});
```

### Always pass an `AbortSignal` to long-running fetches

A tool that calls `fetch()` without a signal will hang for the OS default (≥ 5 minutes). Multiply by concurrent runs and the heap balloons.

```typescript
defineTool({
  name: "scrape",
  execute: async ({ url }, ctx) =>
    fetch(url, { signal: AbortSignal.timeout(10_000) }),
});
```

### Bound queues, never unbounded buffers

Streaming runs that collect events into an array grow without limit if the consumer disconnects. Use `BackpressuredStream` or drop when the queue is full.

```typescript
import { BackpressuredStream } from "@aizonaai/adk";

const stream = new BackpressuredStream({ highWaterMark: 100, onDrop: "newest" });
```

### Close DB connections on shutdown

The standalone server handles SIGINT/SIGTERM. Inside your own setup, propagate shutdown to Prisma / pgvector clients:

```typescript
process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
```

### Watch for it

```bash
# Catch a leak before it crashes prod
node --max-old-space-size=1024 --inspect=0.0.0.0:9229 packages/adk-server/dist/start.js
```

In production, alert on `process_resident_memory_bytes` rising monotonically over hours. Capture a heap snapshot with `kill -SIGUSR2 <pid>` (Node) and load it into Chrome DevTools — most leaks resolve to a single retained object graph.

---

## Streaming issues

### SSE stream cuts off after 60 s on Vercel / Cloudflare

Edge proxies idle-time out long-lived responses. Either:

- Move to a Node-runtime function with `maxDuration: 300` (Vercel).
- Send a `: heartbeat\n\n` comment every 15 s — it keeps the connection live without polluting the event stream.

### WebSocket upgrade fails behind a proxy

Most managed L7 proxies require explicit WebSocket support. Vercel does not support it; Cloudflare requires the "WebSockets" toggle; AWS ALB requires `Connection: Upgrade` listener rules.

### Events arrive out of order

You're racing two streams (e.g., reading from `runner.stream()` and the event bus in parallel). Pick one source of truth — the streaming generator emits an ordered event sequence already.

---

## Multi-agent issues

### Handoff loop ("agent A → B → A → B → …")

**Cause**: Both agents have a `handoff` back to each other and no terminating condition.

**Fix**: Pick a coordinator and route through it; or constrain handoffs to a directed acyclic graph. Set `maxTurns` aggressively while debugging.

### `ParallelRunner` results swap

**Cause**: Treating the result array as ordered by start time. It is ordered by **input index**.

**Fix**: Index results explicitly:

```typescript
const results = await parallel.run([a1, a2, a3], inputs);
const byAgent = Object.fromEntries(results.map((r, i) => [agents[i].name, r]));
```

---

## Provider issues

### Anthropic: "request_too_large"

Cut the message history. Use `compactMessages()` or chunk uploads.

### OpenAI: "context_length_exceeded"

Same fix; or switch to a model with a larger context.

### Google Gemini: empty responses on safety triggers

Gemini silently returns empty when its safety filter fires. Inspect `response.promptFeedback` (passed through in the provider's debug logs) and either rephrase the prompt or relax the safety setting at the provider call site.

### Ollama: "model not found"

```bash
ollama pull llama3.2
```

`OLLAMA_BASE_URL` must point to the host running the Ollama daemon, not the model.

### LM Studio: connection refused

Start LM Studio's local server (Developer tab → Start Server). The default base URL is `http://localhost:1234/v1`.

---

If you've worked through this guide and the issue persists, open an issue at [github.com/ai-zona/adk/issues](https://github.com/ai-zona/adk/issues) with:

- ADK + Node version (`node -v` and `npm ls @aizonaai/adk`).
- A minimal repro (or a captured `runner.stream()` event log with `redact()` applied).
- Provider, model, and the first 10 lines of the structured log around the failure.
