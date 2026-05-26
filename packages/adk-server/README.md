# @aizonaai/adk-server

REST API server for the AIZona Agent Development Kit. Built on [Hono](https://hono.dev/) with API key auth, rate limiting, usage tracking, and an OpenAI-compatible chat proxy.

## Installation

```bash
pnpm add @aizonaai/adk-server
```

## Quick Start

```typescript
import { createServer, startStandaloneServer } from "@aizonaai/adk-server";
import { createProvider } from "@aizonaai/adk";

const provider = createProvider({ providerId: "anthropic", apiKey: "sk-..." });

const app = createServer({
  defaultProvider: provider,
  rateLimitRpm: 60,
  corsOrigins: ["http://localhost:3000"],
});

startStandaloneServer({ port: 3456 });
```

## Server Configuration

```typescript
interface ServerConfig {
  proxyRouter?: ProxyRouter;                              // API key → provider resolution
  defaultProvider?: ADKLLMProvider;                        // Default LLM provider
  validateApiKey?: (keyHash: string) => Promise<ApiKeyRecord | null>;
  rateLimitRpm?: number;                                  // Rate limit (requests/min)
  corsOrigins?: string[];                                 // CORS allowed origins
  onUsage?: (record: UsageRecord) => Promise<void>;       // Usage tracking callback
  basePath?: string;                                      // URL prefix (default: "")
  storage?: StorageBackend;                               // Storage backend (default: in-memory)
}
```

## API Endpoints

All endpoints under `/v1/` require API key authentication via `Authorization: Bearer <key>` header.

### Chat Completions (OpenAI-compatible)

```
POST /v1/chat/completions
```

Accepts OpenAI-format requests and proxies to configured providers.

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "messages": [{ "role": "user", "content": "Hello" }],
  "temperature": 0.7,
  "max_tokens": 1024,
  "stream": false
}
```

### Agents

```
GET    /v1/agents          — List all agents
POST   /v1/agents          — Register new agent
GET    /v1/agents/:id      — Get agent by ID
PUT    /v1/agents/:id      — Update agent
DELETE /v1/agents/:id      — Delete agent
```

### Runs

```
POST   /v1/runs            — Start agent run
GET    /v1/runs/:id        — Get run result
```

Request body for starting a run:

```json
{
  "agentId": "agent-123",
  "input": "What is 2 + 2?",
  "maxTurns": 10,
  "sessionId": "session-456"
}
```

### Sessions

```
POST   /v1/sessions            — Create session
GET    /v1/sessions/:id        — Get session with messages
POST   /v1/sessions/:id/resume — Resume session
POST   /v1/sessions/:id/fork   — Fork session
```

### API Keys

```
POST   /v1/keys            — Create API key (live or test)
GET    /v1/keys             — List keys (masked)
DELETE /v1/keys/:id         — Revoke key
```

### Tools

```
GET    /v1/tools            — List available tools
```

### Health

```
GET    /health              — Health check (no auth required)
GET    /openapi.json        — OpenAPI specification
```

## Middleware

- **API Key Auth** — Validates `Authorization: Bearer <key>`, checks active status and expiration
- **Rate Limiter** — Per-key rate limiting (requests per minute, sliding window)
- **Usage Tracker** — Records tokens, cost, latency, model, and endpoint per request
- **CORS** — Configurable allowed origins

## Storage Backends

```typescript
import { createMemoryStorage, createPrismaStorage } from "@aizonaai/adk-server";

// In-memory (development)
const app = createServer({ storage: createMemoryStorage() });

// PostgreSQL via Prisma (production)
const app = createServer({ storage: createPrismaStorage(prismaClient) });
```

## Standalone Server

```typescript
import { startStandaloneServer } from "@aizonaai/adk-server";

startStandaloneServer({ port: 3456 });
// => ADK Server listening on http://localhost:3456
```

## License

MIT
