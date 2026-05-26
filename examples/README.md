# Examples

Runnable ADK examples — each is a single directory you can clone and run.

| Example | What it demonstrates |
|---------|---------------------|
| [hello-world](./hello-world/) | Minimal agent — no tools, one file |
| [email-assistant](./email-assistant/) | `defineTool()` with Zod schema, structured output |
| [web-scraper](./web-scraper/) | Multi-step tool use, looping agent |

## Quick Start

All examples use [tsx](https://github.com/privatenumber/tsx) for zero-build TypeScript execution.

```bash
# 1. Install tsx globally (once)
npm install -g tsx

# 2. Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Run any example
cd hello-world
npx tsx index.ts "Hello!"
```

## Requirements

- Node.js ≥ 20
- An [Anthropic API key](https://console.anthropic.com/)

See the [main README](../README.md) for full documentation.
