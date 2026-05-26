# Web Scraper

An agent that fetches and summarizes web content using a custom tool.

## Run

```bash
ANTHROPIC_API_KEY=<your-key> npx tsx index.ts "Summarize https://example.com"
```

## What it does

- Defines a `fetch_url` tool with Zod input schema validation
- The agent decides when to call the tool based on the user's request
- Strips HTML and truncates to fit within the context window

## Key APIs

```ts
defineTool({
  name: "fetch_url",
  description: "...",
  inputSchema: z.object({ url: z.string().url() }),
  execute: async ({ url }) => { /* ... */ return string },
})

defineAgent({ name, instructions, tools: [fetchUrlTool] })
```

## Extend it

- Add authentication headers for paywalled sites
- Parse structured data (JSON-LD, Open Graph) instead of stripping HTML
- Chain with another agent to generate a report from multiple URLs

See the [ADK README](../../README.md) for the full API reference.
