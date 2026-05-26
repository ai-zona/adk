# @aizonaai/mcp-bridge

AIZona MCP Bridge — connect [Model Context Protocol](https://modelcontextprotocol.io/) servers to the AIZona agent platform.

## Installation

```bash
pnpm add @aizonaai/mcp-bridge
```

## Features

- **MCP Client + Pool** — Stdio and Streamable HTTP transports
- **Server Registry** — Track servers and discover tools
- **Tool Catalog & Health Monitor** — Inventory tools, monitor server liveness
- **Safety** — Grants, consent, rate limiting around tool invocations
- **Audit** — Dual-write audit trail of every tool call

## Quick Start

```typescript
import {
  MCPClient,
  createStdioTransport,
  ServerRegistry,
} from "@aizonaai/mcp-bridge";

const transport = createStdioTransport({ command: "my-mcp-server" });
const client = new MCPClient({ transport });
await client.connect();

const tools = await client.listTools();
```

See the [main repo](https://github.com/ai-zona/adk) for full documentation.

## License

MIT
