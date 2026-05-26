# Hello World

The simplest possible ADK agent — one file, no tools, no config.

## Run

```bash
ANTHROPIC_API_KEY=<your-key> npx tsx index.ts "Hello!"
```

## What it does

- Creates an agent with a name, instructions, and a model
- Runs it with the `Runner` and prints the response
- Shows token usage and cost per run

## Key APIs

```ts
defineAgent({ name, instructions, model })
new Runner({ provider })
runner.run(agent, { input: "..." }) → RunResult
```

See the [ADK README](../../README.md) for the full API reference.
