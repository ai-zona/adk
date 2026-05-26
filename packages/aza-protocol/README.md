# @aizonaai/aza-protocol

AIZona AZA Protocol — agent-to-agent messaging, identity, task lifecycle, and team orchestration over a Redis Streams backbone.

## Installation

```bash
pnpm add @aizonaai/aza-protocol
```

## Modules

- **Identity** — Ed25519 keypairs, agent identities, signature verification
- **Transport** — Redis Streams transport for envelope routing
- **Audit** — Dual-write audit trail of every envelope
- **Task** — Task state machine, manager, timeouts, artifacts
- **Patterns** — Fan-out, aggregation, pub/sub communication patterns
- **Runtime** — Agent lifecycle, sandboxing, external agents
- **Safety** — Consent, rate limiting, circuit breakers, message pipeline
- **Team** — N:N agent teams, shared context, consensus

## Quick Start

```typescript
import {
  AZA_PROTOCOL_VERSION,
  AZAMessageType,
  TaskStatus,
} from "@aizonaai/aza-protocol";

console.log("AZA Protocol", AZA_PROTOCOL_VERSION);
```

See the [main repo](https://github.com/ai-zona/adk) for full documentation.

## License

MIT
