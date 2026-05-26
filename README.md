# AIZona ADK — Agent Development Kit

<div align="center">

**Build governed AI agent teams with TypeScript.**

[![CI](https://github.com/ai-zona/adk/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ai-zona/adk/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@aizonaai/adk)](https://www.npmjs.com/package/@aizonaai/adk)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](#getting-started)

[Quickstart](./docs/quickstart.md) • [Documentation](./docs/) • [Examples](./examples) • [CLI Reference](./docs/cli-reference.md) • [Contributing](./CONTRIBUTING.md)

</div>

---

## What is AIZona ADK?

The AIZona Agent Development Kit (ADK) is an open-source TypeScript SDK for building production multi-agent systems with built-in governance, metering, and trust.

```typescript
import { defineAgent, defineTool, defineSkill } from '@aizonaai/adk';

const researcher = defineAgent({
  name: 'researcher',
  model: 'claude-sonnet-4',
  skills: ['web-search', 'summarize'],
  consentLevel: 'NOTIFY', // Human sees what agent does
});

const writer = defineAgent({
  name: 'writer', 
  model: 'claude-haiku-3.5',
  skills: ['draft-content', 'format-markdown'],
  consentLevel: 'EXPLICIT', // Human approves before execution
});

// Multi-agent team with orchestrator pattern
const contentTeam = defineTeam({
  name: 'content-engine',
  agents: [researcher, writer],
  coordinator: researcher,
  consensus: 'orchestrator', // researcher delegates to writer
});
```

## Key Features

- **🏗️ `defineAgent()` / `defineTool()` / `defineSkill()`** — Declarative API for agents, tools, and skills
- **👥 Multi-Agent Teams** — 4 consensus types: orchestrator, voting, round-robin, specialist
- **🧠 Smart Routing** — 5 strategies: cost, latency, quality, balanced, fallback
- **🛡️ Guardrails** — Content filter, consent gate, budget limit, PII filter
- **💾 Memory** — PgVector-backed with decay and embedding service
- **🔌 MCP Bridge** — Connect to 7,000+ apps via Model Context Protocol
- **📡 Streaming** — SSE and WebSocket support
- **🎤 Voice** — Whisper, ElevenLabs, OpenAI TTS integration
- **🔒 Sandboxed Execution** — Isolated code execution environment
- **📊 Eval Harness** — Test and benchmark your agents
- **💰 Metering** — Per-turn cost tracking and budget enforcement

## Getting Started

```bash
# Install the ADK
npm install @aizonaai/adk

# Or scaffold a new project
npx @aizonaai/adk-cli init my-agent-project
cd my-agent-project

# Start local dev server (BYOK — use your own API keys)
export ANTHROPIC_API_KEY=sk-...
npx @aizonaai/adk-cli dev

# Deploy to AIZona Cloud (uses AIZ credits)
npx @aizonaai/adk-cli deploy
```

## BYOK (Bring Your Own Key)

Develop locally with your own API keys — zero cost, full control:

```typescript
const agent = defineAgent({
  name: 'my-agent',
  model: 'claude-sonnet-4',
  // Local: use your own key
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

When you deploy to AIZona Cloud, the platform manages keys, routing, caching, and billing automatically. You pay per task with AIZ credits ($0.01/credit).

## Packages

| Package | Description | Status |
|---------|-------------|--------|
| [`@aizonaai/adk`](./packages/adk) | Core SDK — defineAgent, defineTool, defineSkill | ✅ |
| [`@aizonaai/adk-cli`](./packages/adk-cli) | CLI — init, dev, test, deploy | ✅ |
| [`@aizonaai/adk-server`](./packages/adk-server) | Local development server | ✅ |
| [`@aizonaai/aza-protocol`](./packages/aza-protocol) | Agent-to-agent protocol spec | ✅ |
| [`@aizonaai/aza-client`](./packages/aza-client) | AZA protocol client SDK | ✅ |
| [`@aizonaai/mcp-bridge`](./packages/mcp-bridge) | MCP tool bridge (7,000+ integrations) | ✅ |
| [`@aizona/workspace-types`](./packages/workspace-types) | TypeScript types for workspace manifests | ✅ |

## How It Compares

| Feature | AIZona ADK | LangChain | CrewAI | AutoGPT |
|---------|-----------|-----------|--------|---------|
| Open Source | MIT ✅ | MIT ✅ | MIT ✅ | MIT ✅ |
| Agent Teams | ✅ 4 consensus types | ❌ | ✅ Basic | ❌ |
| Governance | ✅ 4 consent levels | ❌ | ❌ | ❌ |
| Per-task Billing | ✅ AIZ credits | ❌ | ❌ | ❌ |
| MCP Native | ✅ 64/64 tests | ❌ | ❌ | ❌ |
| Marketplace | ✅ Publish & earn 70% | ❌ | ❌ | ❌ |
| Trust Scoring | ✅ 6-axis on-chain | ❌ | ❌ | ❌ |
| Smart Routing | ✅ 5 strategies | ❌ | ❌ | ❌ |
| BYOK | ✅ | ✅ | ✅ | ✅ |

## AIZona Cloud

The ADK works standalone, but deploying to [AIZona Cloud](https://aizona.ai) unlocks:

- **Agent Marketplace** — Publish agents, earn 70% of revenue
- **Managed Routing** — Automatic model selection for cost/quality
- **Governance Dashboard** — Approval gates, audit trails, consent management  
- **Trust Engine** — 6-axis agent reputation scoring
- **Team Orchestration** — Multi-agent workflows with human oversight
- **Credit Economy** — Transparent per-task billing at $0.01/credit

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT — see [LICENSE](./LICENSE) for details.

---

<div align="center">

**[aizona.ai](https://aizona.ai)** • **[Documentation](https://docs.aizona.ai)** • **[Discord](https://discord.gg/aizona)**

</div>
