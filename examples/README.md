# Examples

Runnable ADK examples, ordered from "hello world" to "production HTTP server". Each directory is self-contained — `cd` in, `pnpm install`, `pnpm start`.

## The numbered tour

| # | Example | What it shows |
|---|---------|---------------|
| 01 | [basic-agent](./01-basic-agent/)            | Smallest useful program: `defineAgent` + `Runner.run()` |
| 02 | [multi-agent](./02-multi-agent/)            | Swarm-style handoffs from a triage router to three specialists |
| 03 | [guardrails](./03-guardrails/)              | Content filter + PII redaction + budget cap + consent gate |
| 04 | [streaming](./04-streaming/)                | Token-by-token streaming with the typed event bus |
| 05 | [mcp-tools](./05-mcp-tools/)                | Discover tools from a Model Context Protocol server |
| 06 | [production-server](./06-production-server/) | Hono server with API-key auth, rate limiting, SSE, graceful shutdown |

## Legacy examples (kept for the basic patterns)

| Example | What it shows |
|---------|---------------|
| [hello-world](./hello-world/)         | Single-file minimal agent |
| [email-assistant](./email-assistant/) | `defineTool()` with a structured Zod schema |
| [web-scraper](./web-scraper/)         | Custom fetch tool, multi-step tool use |

## Quick start

All examples use [tsx](https://github.com/privatenumber/tsx) for zero-build TypeScript execution.

```bash
# 1. Install dependencies (each example is independent)
cd 01-basic-agent && pnpm install

# 2. Set your provider key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Run
pnpm start "Explain TypeScript generics"
```

## Requirements

- Node.js ≥ 20
- An [Anthropic API key](https://console.anthropic.com/) (most examples)
- Examples 05 / 06 use extra dependencies declared in their own `package.json`

## Where to read more

- [`../docs/deployment.md`](../docs/deployment.md) — Docker, Railway, Vercel, Kubernetes
- [`../docs/security.md`](../docs/security.md) — keys, CORS, guardrails, sandboxing
- [`../docs/troubleshooting.md`](../docs/troubleshooting.md) — errors, debug mode, perf
- [`../packages/adk/README.md`](../packages/adk/README.md) — full API reference
