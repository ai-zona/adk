# 06 — Production Server

A production-shaped HTTP server built on `@aizonaai/adk-server`. Demonstrates the surface you'll wire into your own service: API-key auth, rate limiting, CORS allow-list, usage tracking, structured logging, and graceful shutdown.

## Run

```bash
pnpm install
export ANTHROPIC_API_KEY=sk-ant-...
export NODE_ENV=production
pnpm start
```

Test it:

```bash
curl -H "Authorization: Bearer sk_live_demo" \
     -H "Content-Type: application/json" \
     -d '{"model":"claude-haiku-4-5-20251001","messages":[{"role":"user","content":"Say hello in one word"}]}' \
     http://localhost:3456/v1/chat/completions
```

Or check health (no auth required):

```bash
curl http://localhost:3456/health
```

## What it shows

- `createServer()` with all four production middlewares enabled.
- `validateApiKey` backed by a hashed key table — **never store plaintext keys**.
- `onUsage` callback emitting one JSON record per request (model, tokens, cost, latency, status).
- `corsOrigins` driven by `ADK_CORS_ORIGINS` env (comma-separated).
- `redact()` scrubbing key shapes from log lines.
- SIGTERM / SIGINT handlers with a 25 s drain timeout for in-flight runs.

## Configuration knobs

| Variable | Default | What it does |
| -------- | ------- | ------------ |
| `ADK_PORT` | `3456` | Listen port |
| `ADK_RATE_LIMIT_RPM` | `60` | Per-key requests per minute |
| `ADK_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated origin allow-list |
| `NODE_ENV` | — | Set to `production` to require `validateApiKey` and emit HSTS |

## Production hardening checklist

This example is intentionally minimal. Before deploying:

- Replace the in-memory `keyTable` with a Postgres-backed lookup. Hash on insert with `hashApiKey()`.
- Replace `onUsage` with a durable sink (insert into a warehouse, ship to a metrics service).
- Move the rate limiter to a shared store (Redis, Upstash) when running > 1 replica.
- Terminate TLS at the load balancer; do not expose `:3456` to the public internet directly.
- Wire a real CORS allow-list — every comma-separated origin must be one you control.
- Add `LangfuseExporter` for traces (see `../../docs/troubleshooting.md`).
- Run as a non-root user inside a multi-stage Docker image (see `../../docs/deployment.md`).

## Next

- [`../../docs/deployment.md`](../../docs/deployment.md) — Docker, Compose, Railway, Vercel, Kubernetes.
- [`../../docs/security.md`](../../docs/security.md) — full hardening guide.
- [`../../docs/troubleshooting.md`](../../docs/troubleshooting.md) — common errors and tuning.
