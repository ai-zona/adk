---
name: Bug Report
about: Report a defect or unexpected behavior in the ADK
title: "[bug] "
labels: ["bug", "needs-triage"]
assignees: []
---

## Bug Description

<!-- A clear and concise description of what the bug is. -->

## Affected Package(s)

<!-- Which package(s) are involved? -->
- [ ] `@aizona/adk` — core SDK
- [ ] `@aizona/adk-cli` — CLI (`aizona` command)
- [ ] `@aizona/adk-server` — REST/SSE server
- [ ] `@aizona/aza-protocol` — agent identity / trust
- [ ] `@aizona/aza-client` — AZA HTTP client
- [ ] `@aizona/mcp-bridge` — MCP integration
- [ ] Other / unsure

## Steps to Reproduce

```typescript
// Minimal reproduction — ideally runnable standalone
import { defineAgent, Runner } from "@aizona/adk";

// ...
```

1. 
2. 
3. 

## Expected Behavior

<!-- What did you expect to happen? -->

## Actual Behavior

<!-- What actually happened? Include the full error message / stack trace. -->

```
<error output here>
```

## Environment

| Field | Value |
|-------|-------|
| `@aizona/adk` version | e.g. `0.1.0` |
| Node.js version | e.g. `v22.3.0` |
| OS | e.g. `macOS 15.2`, `Ubuntu 24.04`, `Windows 11` |
| Package manager | `pnpm` / `npm` / `yarn` |
| LLM provider | Anthropic / OpenAI / Gemini / other |

## Additional Context

<!-- Screenshots, logs, or any other context that might help. -->

## Checklist

- [ ] I searched existing issues and this is not a duplicate
- [ ] I included a minimal reproduction
- [ ] I am not reporting a security vulnerability (see [SECURITY.md](../../SECURITY.md))
