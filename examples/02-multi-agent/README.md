# 02 — Multi-Agent Handoff

A triage router classifies an incoming message and hands off to one of three specialists (billing, support, sales). Each specialist has its own instructions and tools.

## Run

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...

pnpm start "My last invoice has the wrong total"
pnpm start "The dashboard won't load in Safari"
pnpm start "What does the Enterprise plan include?"
```

## What it shows

- `defineAgent({ handoffs: [{ agent, description }, …] })` — the Swarm handoff pattern.
- A single coordinator agent (`triage-router`) routes work without doing any of it itself.
- Specialists own their tools — `billing` calls `lookup_invoice`, `support` calls `open_ticket`, `sales` calls `plan_catalog`.
- Each handoff resets the turn budget for the destination agent.

## Why use handoffs vs. one big agent

| Use handoffs when | Use one agent when |
| ----------------- | ------------------ |
| Specialists need disjoint tool sets | One short tool list covers it |
| Different system prompts per domain | One prompt fits |
| You want per-team telemetry | A single tape suffices |
| Some specialists need different models | One model fits |

## Next

→ [`03-guardrails`](../03-guardrails/) — defend the same router with content filter, PII redaction, and a budget cap.
