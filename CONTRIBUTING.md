# Contributing to AIZona ADK

Thank you for your interest in contributing! This guide will get you up and running.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Testing](#testing)
- [Commit Messages](#commit-messages)

---

## Code of Conduct

Be respectful, inclusive, and constructive. We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## Development Setup

### Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| pnpm | ≥ 10 |
| TypeScript | 5.9 (installed automatically) |

### 1. Fork & Clone

```bash
git clone https://github.com/<your-username>/adk.git
cd adk
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build All Packages

```bash
pnpm build
```

### 4. Run Tests

```bash
pnpm test
```

### 5. Type Check

```bash
pnpm typecheck
```

### 6. Try an Example

```bash
cd examples/hello-world
ANTHROPIC_API_KEY=sk-ant-... npx tsx index.ts "Hello!"
```

---

## Project Structure

```
aizona-adk/
├── packages/
│   ├── adk/              # Core SDK — defineAgent, Runner, tools, sessions
│   ├── adk-cli/          # `aizona` CLI — init, login, deploy
│   ├── adk-server/       # REST/SSE server for hosted agents
│   ├── aza-protocol/     # Agent identity, trust, and message pipeline
│   ├── aza-client/       # HTTP client for the AZA protocol
│   ├── mcp-bridge/       # Model Context Protocol bridge
│   └── workspace-types/  # Shared TypeScript types and manifest schemas
├── examples/
│   ├── hello-world/      # Minimal single-agent example
│   ├── email-assistant/  # Agent with a structured tool
│   └── web-scraper/      # Agent with multi-step tool use
└── docs/                 # Architecture, API reference, guides
```

Each `packages/*` directory is an independent pnpm workspace package built with [tsup](https://tsup.egoist.dev/).

---

## Making Changes

### Finding Something to Work On

- Browse [open issues](https://github.com/ai-zona/adk/issues) tagged `good first issue` or `help wanted`.
- Check the [roadmap](https://github.com/ai-zona/adk/discussions) for planned features.
- Propose new ideas by [opening a discussion](https://github.com/ai-zona/adk/discussions/new) first.

### Branching

```bash
git checkout -b feat/my-feature   # new feature
git checkout -b fix/issue-123     # bug fix
git checkout -b docs/update-xyz   # docs-only change
```

### Development Workflow

```bash
# Watch mode for a specific package
pnpm --filter @aizona/adk build --watch

# Run tests for one package
pnpm --filter @aizona/adk test

# Run all checks (build + typecheck + test + lint)
pnpm build && pnpm typecheck && pnpm test && pnpm lint
```

---

## Pull Request Process

1. **Open an issue first** for any non-trivial change so we can align before you invest time.
2. **Keep PRs focused** — one logical change per PR. Split large changes.
3. **All checks must pass**: build, typecheck, tests, lint.
4. **Add/update tests** for any new behavior or bug fix.
5. **Update docs** if you change public API surface (`docs/` or inline JSDoc).
6. **Fill in the PR template** — describe what and why, link to the issue.
7. A maintainer will review within **3 business days**. Expect at least one round of feedback.
8. Once approved, a maintainer will squash-merge your PR.

### PR Title Format

```
feat: add streaming support to Runner
fix: handle empty tool input schema
docs: add multi-agent team example
chore: bump tsup to 9.x
```

---

## Code Style

This project uses [Biome](https://biomejs.dev/) for formatting and linting (not ESLint/Prettier).

```bash
# Check for issues
pnpm lint

# Auto-fix
pnpm --filter @aizona/adk exec biome check --write .
```

Key conventions:
- **TypeScript strict mode** — no `any`, no implicit `undefined`.
- **ESM-only** — `import`/`export`, no `require()`.
- **Explicit return types** on all exported functions.
- **Zod for runtime validation** — all external inputs must be parsed.
- **No class inheritance** — prefer composition and plain functions.
- **Barrel exports** via `src/index.ts` — keep the public API surface minimal.

---

## Testing

Tests use [Vitest](https://vitest.dev/).

```bash
# Run all tests
pnpm test

# Watch mode
pnpm --filter @aizona/adk exec vitest --watch

# Coverage
pnpm --filter @aizona/adk exec vitest --coverage
```

### Test Conventions

- Test files live next to source files: `src/foo.ts` → `src/__tests__/foo.test.ts`
- Unit tests must not make real HTTP/LLM calls — mock providers with `vi.fn()` / `vi.mock()`.
- Integration tests (if any) live in `src/__tests__/integration/` and are skipped in CI unless `INTEGRATION=1`.

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>

[optional body]

[optional footer: Closes #123]
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`

Scope examples: `adk`, `adk-cli`, `aza-protocol`, `mcp-bridge`, `examples`

---

## Questions?

- Open a [GitHub Discussion](https://github.com/ai-zona/adk/discussions) for general questions.
- File a [bug report](https://github.com/ai-zona/adk/issues/new?template=bug_report.md) for defects.
- For security issues, see [SECURITY.md](SECURITY.md) — **do not** open a public issue.
