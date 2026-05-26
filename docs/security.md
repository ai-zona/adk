# Security Guide

Hardening guidance for production deployments of the AIZona ADK. The ADK is a defensive primitive — guardrails, key proxying, and consent gates exist so you can run untrusted prompts against trusted infrastructure without bleeding spend, data, or capability.

## Threat model

Treat every LLM input as **adversarial**. Prompt injection is the dominant risk: a tool result, scraped page, or pasted document can override your system prompt, exfiltrate secrets, or trigger unintended tool calls. Layer the controls below so no single failure becomes a breach.

## Contents

- [API key management](#api-key-management)
- [Server authentication](#server-authentication)
- [CORS](#cors)
- [Rate limiting](#rate-limiting)
- [Input validation](#input-validation)
- [Secrets management](#secrets-management)
- [TLS & transport](#tls--transport)
- [Guardrails](#guardrails)
- [Tool sandboxing](#tool-sandboxing)
- [Logging & PII](#logging--pii)
- [Dependency hygiene](#dependency-hygiene)
- [Incident response](#incident-response)

---

## API key management

There are two layers of keys to think about:

1. **Provider keys** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …) — your bill, your reputation. Never ship to a client.
2. **ADK keys** — keys issued by `@aizonaai/adk-server` that callers present to reach your agents. These are validated against your storage backend.

### Rules

- Never embed provider keys in a browser bundle, mobile app, or public Docker image.
- Rotate on a schedule (90 days) and immediately if a developer leaves or a laptop is lost.
- Scope keys: create separate Anthropic / OpenAI keys per environment (dev, staging, prod) and per workload (chat, batch, eval).
- Use the proxy: clients hit `@aizonaai/adk-server` with a short-lived ADK key; the server holds the provider key and forwards.

### Issuing ADK keys

The server provides helpers for safe key generation and storage of hashes only:

```typescript
import { generateApiKey, hashApiKey } from "@aizonaai/adk";

const { key, prefix } = generateApiKey({ type: "live" });
// key:    "sk_live_a1b2c3...xyz" — show to user ONCE
// prefix: "sk_live_a1b2"          — safe to display in the UI
const keyHash = await hashApiKey(key);   // store this, not `key`
```

Plumb the validator into `createServer`:

```typescript
import { createServer } from "@aizonaai/adk-server";

const app = createServer({
  validateApiKey: async (hash) => {
    const record = await db.apiKey.findUnique({ where: { keyHash: hash } });
    if (!record?.active) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    return record;
  },
});
```

In `NODE_ENV=production` the server **refuses to start** without a `validateApiKey` function — there is no silent fall-through to anonymous access.

---

## Server authentication

- All `/v1/*` routes require `Authorization: Bearer <key>`. The `apiKeyAuth` middleware short-circuits with `401` for missing or unknown keys and `403` for expired ones.
- The OAuth/SSO surface (if you build one) should issue ADK keys after authenticating the user, not after delegating to the provider.
- Pin caller identity into structured logs (`apiKeyId`, `ownerId`) so abuse can be traced.

The server adds `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and HSTS in production. Keep these — they neuter trivial XSS amplifications and clickjacking.

---

## CORS

The default CORS middleware mirrors only configured origins. **Do not** wildcard `*` once authentication is in play: it allows any site running in the user's browser to make authenticated requests.

```typescript
createServer({
  corsOrigins: [
    "https://app.example.com",
    "https://staging.example.com",
  ],
});
```

If you need credentials (cookies, `Authorization`) you must enumerate origins explicitly — `*` with credentials is a CORS spec violation and modern browsers reject it.

---

## Rate limiting

Built-in `rateLimiter` is per-key, per-minute, sliding window, **in-memory**. That is enough for a single replica; behind a load balancer you must:

- Replace it with a shared-store limiter (Redis, Upstash, Cloudflare WAF) so per-key counters survive replica failover.
- Add a coarser **IP-based** front-line limit at the edge to absorb credential-stuffing storms before they reach the app.
- Tier limits by key type — `test` keys lower than `live`, free tier lower than paid.

Trip a circuit breaker on a per-key error rate so a single misbehaving caller can't burn your provider quota.

---

## Input validation

Every tool input flows through Zod. Use it.

```typescript
defineTool({
  name: "fetch_url",
  inputSchema: z.object({
    url: z.string()
      .url()
      .refine((u) => !u.includes("169.254.169.254"), "Blocked AWS metadata")
      .refine((u) => !u.match(/^https?:\/\/(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/), "Blocked private network")
      .refine((u) => new URL(u).protocol !== "file:", "Blocked file protocol"),
  }),
  execute: async ({ url }) => fetch(url, { signal: AbortSignal.timeout(10_000) }),
});
```

Patterns:

- **SSRF**: deny private CIDRs, link-local, cloud metadata IPs, and `file:` / `gopher:` schemes.
- **Path traversal**: refuse `..` and absolute paths in any tool that touches the filesystem.
- **Command injection**: pass shell args as arrays, never templated strings; prefer Node APIs (`fs.readFile`) over `exec`.
- **Output schemas**: set `outputSchema` on agents that downstream code parses, so a hallucinated field fails closed.

---

## Secrets management

- Store secrets in your platform's vault (Railway Variables, Vercel env, AWS Secrets Manager, Doppler, 1Password Connect, Kubernetes Secrets). Avoid `.env` files in production images.
- Mount secrets as **environment variables, not files** in the image. If you must mount files, set `mode: 0400` and use a non-root user.
- Inject at runtime, not build time. A leaked image with baked secrets is a leaked credential.
- Encrypt secrets at rest in your CI provider (GitHub Actions encrypted secrets, GitLab masked variables).
- Audit access — every secret read should be reviewable.

The `redact()` utility in `@aizonaai/adk` scrubs known key shapes before logging:

```typescript
import { redact } from "@aizonaai/adk";

logger.info({ event: "tool_invoke", payload: redact(payload) });
// "sk-ant-abc…xyz" → "sk-ant-***REDACTED***"
```

---

## TLS & transport

- **Terminate TLS at the edge** — load balancer, ingress controller, or Cloudflare. The Node server speaks HTTP and trusts the proxy.
- Set `Strict-Transport-Security: max-age=63072000; includeSubDomains` (the server does this in production already).
- Enforce HTTP/2 at the edge to avoid head-of-line blocking on streaming responses.
- For mTLS between internal services use SPIFFE/SPIRE or your service mesh (Linkerd, Istio) — don't roll your own.
- TLS 1.2 minimum; prefer 1.3.

If you expose WebSocket streams, wrap them in `wss://` only — never plain `ws://` over the public internet.

---

## Guardrails

The ADK ships layered guardrails. Compose them — most production agents need at least four.

```typescript
import {
  contentFilter,
  piiFilter,
  budgetLimit,
  tokenLimit,
  consentGate,
  defineAgent,
} from "@aizonaai/adk";

const agent = defineAgent({
  name: "support-bot",
  instructions: "Help users with billing questions.",
  guardrails: [
    { guardrail: contentFilter({ blockedKeywords: ["ignore previous", "system prompt"] }) },
    { guardrail: piiFilter({ detect: ["email", "phone", "credit_card", "ssn"] }) },
    { guardrail: budgetLimit(0.50) },          // per-run USD cap
    { guardrail: tokenLimit({ maxTotalTokens: 32_000 }) },
    { guardrail: consentGate("notify") },      // surface every tool call to the user
  ],
});
```

| Guardrail        | What it catches                                    |
| ---------------- | -------------------------------------------------- |
| `contentFilter`  | Banned terms in input or output                    |
| `piiFilter`      | Emails, phone numbers, SSNs, credit card patterns  |
| `budgetLimit`    | Per-run USD spend                                  |
| `tokenLimit`     | Runaway context growth                             |
| `consentGate`    | Requires user approval for `notify`/`explicit` tools |
| `budgetGateGuardrail` | Hard stop when cumulative spend exceeds a threshold |

Guardrails throw `GuardrailTripwireError`; catch and surface a clear error to the user. **Do not** retry blindly — tripwires are deliberate.

### Consent levels

| Level         | Behaviour                                              |
| ------------- | ------------------------------------------------------ |
| `auto`        | Tool runs without confirmation (low-risk reads)        |
| `notify`      | User sees the call in real time                        |
| `explicit`    | User must approve before execution                     |
| `multi_party` | Requires approval from multiple identities (4-eyes)    |

Default to `notify` for new tools; promote to `auto` only after measurement.

---

## Tool sandboxing

For tools that execute code, use the `CodeExecutor` (Node `vm` isolate) and keep risky tools out of the same agent that handles untrusted input.

```typescript
import { CodeExecutor, createExecuteCodeTool } from "@aizonaai/adk";

const sandbox = new CodeExecutor({
  timeoutMs: 5_000,
  memoryLimitMb: 128,
});

const codeTool = createExecuteCodeTool(sandbox);
```

Higher-risk patterns (e.g. running model-generated SQL or shell):

- Run in a separate process with seccomp/AppArmor or in a microVM (Firecracker, gVisor).
- Network-deny the sandbox; allow only an explicit allowlist.
- Read-only filesystem; mount writable tmpfs scoped to the run.
- Drop all Linux capabilities (`securityContext.capabilities.drop: ["ALL"]`).

---

## Logging & PII

- Log structured JSON: `runId`, `agentName`, `apiKeyId`, `model`, `inputTokens`, `outputTokens`, `costUsd`, `latencyMs`, `statusCode`.
- **Never** log raw prompts or completions by default — they will contain PII, secrets, or both. If you need them for debugging, gate behind a feature flag and a short retention window.
- Pipe `redact()` over any payload that ends up in stdout.
- Retain logs only as long as compliance requires. Set lifecycle rules on your log bucket.
- For tracing, use `LangfuseExporter` with a self-hosted Langfuse if data residency matters.

---

## Dependency hygiene

- `pnpm audit --prod` on every PR; fail CI on `high`/`critical`.
- Renovate or Dependabot on weekly cadence with auto-merge for patch versions.
- Pin to exact versions in `pnpm-lock.yaml` — already enforced by `--frozen-lockfile` in CI.
- Verify provenance on installs: `pnpm install --frozen-lockfile --strict-peer-dependencies` and prefer packages published with npm provenance (this repo publishes with it).
- Audit MCP servers before mounting — they can run arbitrary tools.

---

## Incident response

When a key leaks or an agent runs amok:

1. **Revoke** the offending ADK key (`DELETE /v1/keys/:id`) — propagation is immediate because validation is per-request.
2. **Rotate** any provider key that may have been exposed; the leak window starts at first commit, not first push.
3. **Cap** spend at the provider dashboard (Anthropic / OpenAI both support budgets) as a backstop.
4. **Search logs** for `apiKeyId` and `costUsd` outliers in the last 24 h.
5. **Disclose** to affected users if PII was exposed. Coordinate with your security/legal team.
6. **Patch** the gap — usually a missing guardrail, an over-broad CORS origin, or a tool that needed an explicit consent gate.

Report ADK security issues privately to `security@aizona.ai`. See [SECURITY.md](../SECURITY.md) for the disclosure timeline.
