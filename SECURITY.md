# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `0.x` (latest) | ✅ Active |
| Earlier | ❌ No longer maintained |

---

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

We take security seriously and appreciate responsible disclosure. If you discover a vulnerability, please report it privately so we can fix it before it is publicly known.

### How to Report

Send an email to **security@aizona.ai** with:

1. **Subject**: `[ADK Security] <brief description>`
2. **Affected package(s)**: e.g., `@aizona/adk`, `@aizona/aza-protocol`
3. **Description**: What the vulnerability is and what an attacker could achieve
4. **Reproduction steps**: Minimal code or steps to reproduce
5. **Severity estimate**: Critical / High / Medium / Low (CVSS score if known)
6. Your preferred contact for follow-up (optional)

### What to Expect

| Timeline | Action |
|----------|--------|
| **Within 48 hours** | Acknowledgement of your report |
| **Within 7 days** | Initial assessment and severity confirmation |
| **Within 30 days** | Patch released (critical/high), or agreed disclosure timeline |
| **After patch ships** | We'll credit you in the release notes (unless you prefer anonymity) |

### Scope

The following are **in scope**:

- All packages published under `@aizona/*` (adk, adk-cli, adk-server, aza-protocol, aza-client, mcp-bridge)
- Agent identity / key management in `aza-protocol`
- API key handling and proxy routing in `adk`
- Authentication in `adk-server`

The following are **out of scope**:

- Vulnerabilities in third-party dependencies (report to them directly; also file a GitHub Advisory so we're aware)
- Social engineering attacks
- Denial of service on public example endpoints

---

## Security Best Practices for ADK Users

### Never hardcode API keys

```typescript
// ✅ Correct — read from environment
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ❌ Wrong — key in source code
const provider = new AnthropicProvider({ apiKey: "sk-ant-abc123..." });
```

### Use `.env` files locally, secrets managers in production

```bash
# .env (git-ignored)
ANTHROPIC_API_KEY=sk-ant-...
AIZONA_PRIVATE_KEY=<hex-encoded-ed25519-key>
```

Add `.env` to your `.gitignore`. In production, use environment secrets from your platform (Railway, Fly, Render, Vercel, etc.).

### Agent key rotation

Your AZA agent identity (`AIZONA_PRIVATE_KEY`) acts like an SSH private key. Rotate it if you believe it was exposed:

```bash
aizona agent rotate-key
```

### Least-privilege tool definitions

Only expose tools with the permissions your agent actually needs. Use Zod schemas to validate all tool inputs strictly — never pass raw user text to shell commands, SQL, or file paths.

---

## Disclosure Policy

We follow a **coordinated disclosure** model:

1. Reporter submits privately.
2. We confirm and assess the issue.
3. We develop and test a fix.
4. We release the fix and publish a GitHub Security Advisory.
5. We credit the reporter (if they agree) in the advisory and changelog.

We aim to ship critical patches within **7 days** of confirmation. We will not take legal action against good-faith researchers who follow this policy.

---

*This policy was last updated: May 2026*
