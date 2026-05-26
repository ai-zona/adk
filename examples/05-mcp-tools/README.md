# 05 — MCP Tools

Discover tools from a Model Context Protocol (MCP) server and expose them to an agent. MCP is the standard wire protocol for connecting agents to tools — there are thousands of pre-built servers (filesystem, GitHub, Slack, Notion, Postgres, Stripe, etc.).

## Run

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
```

### Stdio transport (recommended for local dev)

```bash
export ADK_MCP_CMD='npx -y @modelcontextprotocol/server-filesystem /tmp'
pnpm start "List the files in /tmp and tell me which is the largest"
```

### HTTP transport (for remote / shared MCP servers)

```bash
export ADK_MCP_URL=http://localhost:3001/mcp
pnpm start
```

## What it shows

- `mcpServerTools({ transport: 'stdio' | 'http', … })` — connects, performs the MCP handshake, lists tools, and translates each tool's JSON Schema into an ADK `defineTool`-compatible shape.
- Passing the discovered tools straight into `defineAgent({ tools })` — they look identical to native ADK tools.
- Capability discovery — the example prints every tool the server exposes before the agent runs.

## Picking servers

Audit any MCP server before you mount it — they can execute arbitrary tools on your behalf.

| Server | Use case |
| ------ | -------- |
| `@modelcontextprotocol/server-filesystem` | Local file read/write (sandbox the path!) |
| `@modelcontextprotocol/server-github` | Read issues, PRs, file contents |
| `@modelcontextprotocol/server-postgres` | Query a Postgres DB |
| `@modelcontextprotocol/server-slack` | Post messages, fetch channels |

Hosted catalog: <https://modelcontextprotocol.io/clients>.

## Security

- Pair every MCP-backed tool with a `consentGate({ level: "explicit" })` guardrail when the server can mutate state.
- For untrusted MCP servers, run them inside a separate container with a read-only filesystem and a network egress allowlist.

## Next

→ [`06-production-server`](../06-production-server/) — the same patterns wrapped in `@aizonaai/adk-server` with API-key auth, rate limiting, and SSE streaming.
