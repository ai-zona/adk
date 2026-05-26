# @aizonaai/aza-client

AIZona AZA Agent Client — high-level SDK for building external agents on the [AZA protocol](https://www.npmjs.com/package/@aizonaai/aza-protocol).

## Installation

```bash
pnpm add @aizonaai/aza-client @aizonaai/aza-protocol
```

## Quick Start

```typescript
import { AZAAgent } from "@aizonaai/aza-client";

const agent = new AZAAgent({
  agentId: "my-agent-001",
  redisUrl: process.env.REDIS_URL!,
  privateKey: process.env.AZA_PRIVATE_KEY!,
});

agent.onTask(async (envelope, payload) => {
  // Handle incoming task requests
  return { status: "complete", result: { ok: true } };
});

await agent.connect();
```

## Features

- **AZAAgent class** — Connection lifecycle, task handling, message dispatch
- **HeartbeatSender** — Background heartbeat publishing
- **Type re-exports** — Common envelope and payload types from `@aizonaai/aza-protocol`

See the [main repo](https://github.com/ai-zona/adk) for full documentation.

## License

MIT
