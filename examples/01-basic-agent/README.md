# 01 — Basic Agent

The minimum viable ADK program: declare an agent, create a `Runner`, invoke it.

## Run

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
pnpm start "Explain TypeScript generics in two sentences"
```

## What it shows

- `defineAgent({ name, model, instructions })` — declarative agent definition.
- `new Runner({ provider })` — execution engine with cost accounting.
- `runner.run(agent, { input })` — single-shot synchronous run.
- The returned `result.usage.totalCostUsd` and `result.turns` for instrumentation.

## Files

```
src/index.ts     — the entire program (~30 lines)
package.json     — tsx + @aizonaai/adk
tsconfig.json    — strict ESM build
```

## Next

→ [`02-multi-agent`](../02-multi-agent/) — split work across specialist agents.
