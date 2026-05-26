/**
 * Web Scraper — agent with a custom fetch tool
 *
 * Demonstrates:
 *  - defineTool() with Zod input schema
 *  - Tool execution with error handling
 *  - Agent with tool access
 *
 * Run:
 *   ANTHROPIC_API_KEY=<key> npx tsx index.ts "Summarize https://example.com"
 */

import { z } from "zod";
import { AnthropicProvider, Runner, defineAgent, defineTool } from "@aizonaai/adk";

const fetchUrlTool = defineTool({
  name: "fetch_url",
  description: "Fetch the text content of a URL and return it as plain text",
  inputSchema: z.object({
    url: z.string().url().describe("The full URL to fetch"),
  }),
  execute: async ({ url }) => {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ADK-Example/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const html = await res.text();
    // Strip tags and collapse whitespace — good enough for demo purposes
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return text.slice(0, 8_000);
  },
});

const agent = defineAgent({
  name: "web-scraper",
  instructions: `You are a web research assistant.
Use the fetch_url tool to retrieve content from URLs the user provides.
After fetching, extract and summarize the key information they asked for.
If a fetch fails, report the error and suggest alternatives.`,
  model: "claude-haiku-4-5-20251001",
  tools: [fetchUrlTool],
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const result = await runner.run(agent, {
  input:
    process.argv[2] ?? "Fetch https://example.com and summarize what the page is about.",
});

console.log(result.output);
