# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Production deployment guide (`docs/deployment.md`) — Docker multi-stage build, Compose, Railway, Vercel, Kubernetes, sizing & scaling.
- Security guide (`docs/security.md`) — API key management, CORS, rate limiting, input validation, secrets, TLS, guardrails, tool sandboxing.
- Troubleshooting runbook (`docs/troubleshooting.md`) — common errors, debug mode, log format, performance tuning, memory leak prevention.
- Six runnable examples under `examples/` covering the production surface: basic agent, multi-agent handoffs, guardrails, streaming, MCP tools, production server.

## [0.1.0] — 2026-05-26

Initial public release of the AIZona Agent Development Kit.

### Added

#### Core SDK (`@aizonaai/adk`)

- **Declarative API** — `defineAgent`, `defineTool`, `defineSkill` with full TypeScript and Zod schema validation on all boundaries.
- **`Runner`** — turn-loop executor with synchronous `run()` and streaming `stream()` APIs, abort signals, per-run cost/usage accounting, and configurable `maxTurns`.
- **`TurnExecutor`** — single-turn primitive for advanced orchestration.
- **LLM providers (6)** — `AnthropicProvider`, `OpenAIProvider`, `GoogleProvider`, `XAIProvider`, `OllamaProvider`, `LMStudioProvider` behind a `BaseProvider` contract; `createProvider()` factory; typed `ADKProviderError`.
- **`ADKRouter`** — multi-provider routing with five strategies: `cost-optimized`, `latency-optimized`, `quality-optimized`, `balanced`, `fallback-chain`.
- **Multi-agent**:
  - `HandoffManager` — Swarm-pattern handoffs between agents.
  - `agentAsTool()` — wrap an agent as a callable tool.
  - `ParallelRunner` — fan-out execution.
  - `Team` — orchestrator / voting / round-robin / specialist consensus.
- **Guardrails engine** — `GuardrailEngine` + tripwire errors; built-ins: `contentFilter`, `consentGate`, `budgetLimit`, `budgetGateGuardrail`, `tokenLimit`, `piiFilter`.
- **Consent model** — four levels: `auto`, `notify`, `explicit`, `multi_party`.
- **Sessions & context** — `MemorySessionBackend`, `PrismaSessionBackend`, `ContextManager`, `TokenCounter`, `ContextSummarizer`, `compactMessages`, `AgenticMemory` with `InMemoryBackend`.
- **Memory (vector)** — `MemoryManager`, `EmbeddingService`, `PgVectorMemoryBackend`, `InMemorySharedStore`, `MemoryDecayManager`.
- **Streaming** — `createAsyncEventStream`, SSE encoder (`encodeSSE`, `streamToSSE`), `relayToWebSocket`, `BackpressuredStream`.
- **Event bus** — `ADKEventBus` with 16 typed events spanning runs, turns, tools, guardrails, and handoffs.
- **Tracing** — `Tracer`, `Span`, exporters for console, event bus, and Langfuse.
- **Structured output** — Zod ↔ JSON Schema bridge; provider-specific schema adapters for Anthropic, OpenAI, Google.
- **Skills system** — `defineSkill`, `SkillManifestSchema`, `loadSkill`, `mergeSkillTools`.
- **Code execution sandbox** — `CodeExecutor` with timeout and memory caps; `createExecuteCodeTool()`.
- **MCP integration** — `mcpServerTools`, `MCPServerConnector`, `discoverMCPTools`, `mcpSelectTools`.
- **Realtime / voice** — `RealtimeAgent`, `AudioStreamBuffer`, PCM16 helpers.
- **Multi-modal content** — text / image / audio / video / UI artifact parts with type-guard helpers.
- **Artifacts (A2UI)** — `ArtifactStore`, `createArtifactTool`.
- **Harness (Progress Protocol)** — `ProgressTracker`, `NotesStore` and supporting tools.
- **Eval harness** — `defineEvalSuite`, `runEval` for structured agent benchmarking.
- **Plugin system** — `definePlugin`, `PluginRegistry`, lifecycle and capability types.
- **API-key utilities** — `generateApiKey`, `hashApiKey`, `parseApiKey`, `validateApiKeyFormat`.
- **Redaction utility** — `redact()` for safe logging of payloads containing API keys.

#### REST server (`@aizonaai/adk-server`)

- **`createServer()`** — Hono app with API-key auth, rate limiting, usage tracking, and CORS middleware.
- **`startStandaloneServer()`** — Node listener with SIGINT/SIGTERM graceful shutdown.
- **Hardened defaults** — refuses to start in `NODE_ENV=production` without `validateApiKey`; adds `X-Content-Type-Options`, `X-Frame-Options`, and HSTS headers.
- **Endpoints (`/v1/*`)** — OpenAI-compatible `/chat/completions` proxy, agent CRUD, run lifecycle, session CRUD with `resume`/`fork`, tool listing, API-key CRUD.
- **Storage backends** — in-memory (default) and Prisma (Postgres) implementations.
- **Health & OpenAPI** — `/health` (unauthenticated) and `/v1/openapi.json`.

#### CLI (`@aizonaai/adk-cli`)

- `adk init` — scaffold a new agent project.
- `adk dev` — local development server (BYOK).
- `adk test` — run agent test guidance.
- `adk deploy` — push to the AIZona Cloud control plane.

### Packaging

- Dual ESM + CJS output via `tsup`, full TypeScript declarations.
- Published with npm provenance.
- Zero runtime dependencies in `@aizonaai/adk` beyond `zod`.
- Node ≥ 20 enforced via `engines`.

[Unreleased]: https://github.com/ai-zona/adk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ai-zona/adk/releases/tag/v0.1.0
