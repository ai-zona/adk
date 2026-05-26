/**
 * 05 — MCP Tools
 *
 * Discover tools from a Model Context Protocol (MCP) server and expose them
 * to an agent. MCP is the standard way to plug agents into thousands of
 * pre-built integrations (filesystem, GitHub, Slack, Notion, Postgres, …).
 *
 * Two transports are supported out of the box:
 *
 *  1. Streamable HTTP   — point ADK_MCP_URL at any MCP-compatible HTTP endpoint
 *  2. Stdio subprocess  — spawn a local MCP server, e.g. `@modelcontextprotocol/server-filesystem`
 *
 * Run (HTTP):
 *   ADK_MCP_URL=http://localhost:3001/mcp \
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm start
 *
 * Run (stdio, filesystem server on /tmp):
 *   ADK_MCP_CMD='npx -y @modelcontextprotocol/server-filesystem /tmp' \
 *   ANTHROPIC_API_KEY=sk-ant-... pnpm start "List the files in /tmp"
 */

import {
  AnthropicProvider,
  Runner,
  defineAgent,
  mcpServerTools,
} from "@aizonaai/adk";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY environment variable.");
  process.exit(1);
}

const mcpUrl = process.env.ADK_MCP_URL;
const mcpCmd = process.env.ADK_MCP_CMD;
if (!mcpUrl && !mcpCmd) {
  console.error(
    "Set either ADK_MCP_URL (HTTP transport) or ADK_MCP_CMD (stdio transport).\n" +
      "Example: ADK_MCP_CMD='npx -y @modelcontextprotocol/server-filesystem /tmp'",
  );
  process.exit(1);
}

// Discover tools — the connector handles handshake, tool listing, and schema translation.
const tools = await mcpServerTools(
  mcpUrl
    ? { transport: "http", url: mcpUrl }
    : { transport: "stdio", command: mcpCmd!.split(" ")[0], args: mcpCmd!.split(" ").slice(1) },
);

console.log(`\nDiscovered ${tools.length} MCP tool(s):`);
for (const t of tools) console.log(`  • ${t.name} — ${t.description ?? "(no description)"}`);

const agent = defineAgent({
  name: "mcp-agent",
  model: "claude-haiku-4-5-20251001",
  instructions: [
    "You can use the tools provided by the connected MCP server.",
    "Choose the most direct tool for each step. Report results concisely.",
  ].join(" "),
  tools,
  maxTurns: 8,
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey }),
});

const input =
  process.argv.slice(2).join(" ") ||
  "List the available tools you have and demonstrate one of them with a safe, read-only call.";

const result = await runner.run(agent, { input });

console.log("\n──────────── FINAL ────────────");
console.log(result.output);
console.log(
  `\n[turns=${result.turns} cost=$${result.usage.totalCostUsd.toFixed(6)}]`,
);
