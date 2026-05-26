# Deployment Guide

Production deployment patterns for the AIZona ADK — Docker, Railway, Vercel, Kubernetes, and self-hosted Compose. This guide covers the `@aizonaai/adk-server` package; standalone agents that don't expose HTTP can be deployed as any Node process or serverless function.

## Contents

- [Requirements](#requirements)
- [Environment Variables](#environment-variables)
- [Docker (multi-stage)](#docker-multi-stage)
- [Docker Compose](#docker-compose)
- [Railway](#railway)
- [Vercel](#vercel)
- [Kubernetes](#kubernetes)
- [Resource Sizing](#resource-sizing)
- [Scaling](#scaling)
- [Zero-downtime deploys](#zero-downtime-deploys)
- [Pre-flight checklist](#pre-flight-checklist)

---

## Requirements

| Component        | Minimum            | Recommended                |
| ---------------- | ------------------ | -------------------------- |
| Node.js          | 20.x LTS           | 22.x LTS                   |
| Memory           | 512 MB             | 1–2 GB (1 GB per concurrent stream) |
| vCPU             | 0.5                | 1–2 (LLM I/O bound)        |
| Postgres         | 14 (with `pgvector` if using memory) | 16        |
| Outbound network | HTTPS to provider APIs | Same + DNS over TLS    |

The server is I/O-bound — most of its time is spent waiting on provider APIs. Scale horizontally before vertically.

## Environment Variables

Variables consumed at runtime. Anything starting with `ADK_` is server-specific; provider keys follow each vendor's convention.

### Required

| Variable                  | Description                                       | Example                       |
| ------------------------- | ------------------------------------------------- | ----------------------------- |
| `NODE_ENV`                | `production` enables auth-required mode + HSTS    | `production`                  |
| `ADK_PORT`                | HTTP listen port                                  | `3456`                        |
| `ANTHROPIC_API_KEY`       | Anthropic provider key                            | `sk-ant-…`                    |

At least one provider key is required. Configure only the providers you use.

### Provider keys (optional, per-provider)

| Variable               | Provider               |
| ---------------------- | ---------------------- |
| `ANTHROPIC_API_KEY`    | Anthropic              |
| `OPENAI_API_KEY`       | OpenAI                 |
| `GOOGLE_API_KEY`       | Google (Gemini)        |
| `XAI_API_KEY`          | xAI (Grok)             |
| `OLLAMA_BASE_URL`      | Self-hosted Ollama     |
| `LMSTUDIO_BASE_URL`    | Self-hosted LM Studio  |

### Server tuning

| Variable                  | Default            | Notes                                |
| ------------------------- | ------------------ | ------------------------------------ |
| `ADK_RATE_LIMIT_RPM`      | unset (off)        | Per-key requests per minute          |
| `ADK_CORS_ORIGINS`        | unset (off)        | Comma-separated allowed origins      |
| `ADK_LOG_LEVEL`           | `info`             | `debug` \| `info` \| `warn` \| `error` |
| `ADK_MAX_TURNS`           | `25`               | Default per-run turn cap             |
| `ADK_REQUEST_TIMEOUT_MS`  | `120000`           | Per-request server timeout           |

### Storage / persistence

| Variable                  | Description                                           |
| ------------------------- | ----------------------------------------------------- |
| `DATABASE_URL`            | Postgres connection string (Prisma session backend)   |
| `PGVECTOR_URL`            | Postgres URL with `pgvector` extension for memory     |

### Observability

| Variable                  | Description                          |
| ------------------------- | ------------------------------------ |
| `LANGFUSE_HOST`           | Langfuse tracing endpoint            |
| `LANGFUSE_PUBLIC_KEY`     | Langfuse public key                  |
| `LANGFUSE_SECRET_KEY`     | Langfuse secret key                  |

Load via `.env` in development. In production use your platform's secret manager (Railway variables, Vercel project env, AWS Secrets Manager, GCP Secret Manager, Kubernetes Secrets). **Never** bake keys into Docker images.

---

## Docker (multi-stage)

A multi-stage build keeps the runtime image lean (~150 MB) and reproducible. Place this at the repo root.

```dockerfile
# syntax=docker/dockerfile:1.7

# ─── Stage 1: deps ──────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/adk/package.json packages/adk/
COPY packages/adk-server/package.json packages/adk-server/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @aizonaai/adk-server...

# ─── Stage 2: build ─────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.29.2 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/adk/node_modules ./packages/adk/node_modules
COPY --from=deps /app/packages/adk-server/node_modules ./packages/adk-server/node_modules
COPY . .

RUN pnpm --filter @aizonaai/adk build \
 && pnpm --filter @aizonaai/adk-server build

# ─── Stage 3: runtime ───────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    ADK_PORT=3456

RUN addgroup -S adk && adduser -S adk -G adk

COPY --from=build --chown=adk:adk /app/packages/adk/dist ./packages/adk/dist
COPY --from=build --chown=adk:adk /app/packages/adk/package.json ./packages/adk/
COPY --from=build --chown=adk:adk /app/packages/adk-server/dist ./packages/adk-server/dist
COPY --from=build --chown=adk:adk /app/packages/adk-server/package.json ./packages/adk-server/
COPY --from=build --chown=adk:adk /app/node_modules ./node_modules

USER adk
EXPOSE 3456

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${ADK_PORT}/health || exit 1

CMD ["node", "packages/adk-server/dist/start.js"]
```

Build and run:

```bash
docker build -t adk-server:0.1.0 .
docker run --rm -p 3456:3456 \
  -e NODE_ENV=production \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  adk-server:0.1.0
```

### `.dockerignore`

```
node_modules
**/node_modules
**/dist
.git
.env*
**/*.test.ts
**/coverage
```

---

## Docker Compose

A two-service stack with Postgres for session persistence.

```yaml
# compose.yaml
services:
  adk:
    image: adk-server:0.1.0
    build: .
    restart: unless-stopped
    ports:
      - "3456:3456"
    environment:
      NODE_ENV: production
      ADK_PORT: 3456
      ADK_RATE_LIMIT_RPM: 120
      ADK_CORS_ORIGINS: https://app.example.com
      DATABASE_URL: postgres://adk:${POSTGRES_PASSWORD}@db:5432/adk
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    depends_on:
      db:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 1G

  db:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_DB: adk
      POSTGRES_USER: adk
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U adk -d adk"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

Run:

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
docker compose up -d
```

---

## Railway

Railway auto-detects the Dockerfile. Two paths:

**1. From the repo (recommended)**

```bash
railway link
railway up
```

Configure variables in the Railway dashboard:

- `NODE_ENV=production`
- `ANTHROPIC_API_KEY=...`
- `DATABASE_URL` (auto-injected by the Postgres add-on)
- `ADK_PORT=$PORT` (Railway sets `$PORT`)

Update the start command if needed:

```
node packages/adk-server/dist/start.js
```

**2. Provision Postgres + service via MCP**

If you have the Railway MCP server enabled, the `use-railway` skill can create the project, attach a `pgvector`-capable Postgres, set environment variables, and deploy in one shot.

Generate a public domain after the first deploy:

```bash
railway domain
```

Railway terminates TLS for you — no certificate management required.

---

## Vercel

The ADK server runs on Vercel via its Node runtime, but the **Edge runtime is not supported** (the server uses Node-only APIs). Use the `@vercel/node` adapter pattern: expose a single `api/[...path].ts` that mounts the Hono app.

```typescript
// api/[...path].ts
import { handle } from "hono/vercel";
import { createServer } from "@aizonaai/adk-server";
import { createProvider } from "@aizonaai/adk";

export const runtime = "nodejs";
export const maxDuration = 300; // streaming runs

const app = createServer({
  defaultProvider: createProvider({
    providerId: "anthropic",
    apiKey: process.env.ANTHROPIC_API_KEY!,
  }),
  validateApiKey: async (hash) => {
    // your validation
    return { id: "k1", keyHash: hash, type: "live", permissions: ["*"], active: true, ownerId: "u1" };
  },
  rateLimitRpm: 60,
});

export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
export const PUT = handle(app);
```

`vercel.json`:

```json
{
  "functions": {
    "api/[...path].ts": { "maxDuration": 300, "memory": 1024 }
  }
}
```

Caveats:

- Vercel functions are stateless — use a managed Postgres for sessions and a dedicated rate limit store (Vercel KV / Upstash) instead of the in-memory default.
- Cold starts add ~500–1500 ms to the first request after idle. Use Vercel's Fluid Compute for tighter latency.
- Streaming works via SSE; WebSocket upgrades do not.

---

## Kubernetes

A reference `Deployment` + `Service` with health probes and resource requests.

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: adk-server
spec:
  replicas: 3
  selector:
    matchLabels: { app: adk-server }
  template:
    metadata:
      labels: { app: adk-server }
    spec:
      containers:
        - name: adk
          image: ghcr.io/your-org/adk-server:0.1.0
          ports:
            - { name: http, containerPort: 3456 }
          env:
            - { name: NODE_ENV, value: production }
            - { name: ADK_PORT, value: "3456" }
            - name: ANTHROPIC_API_KEY
              valueFrom:
                secretKeyRef: { name: adk-secrets, key: anthropic_api_key }
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef: { name: adk-secrets, key: database_url }
          resources:
            requests: { cpu: 250m, memory: 512Mi }
            limits:   { cpu: "1",  memory: 1Gi }
          startupProbe:
            httpGet: { path: /health, port: http }
            failureThreshold: 30
            periodSeconds: 2
          readinessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 5
            timeoutSeconds: 2
          livenessProbe:
            httpGet: { path: /health, port: http }
            periodSeconds: 15
            timeoutSeconds: 3
            failureThreshold: 3
---
apiVersion: v1
kind: Service
metadata:
  name: adk-server
spec:
  selector: { app: adk-server }
  ports:
    - { port: 80, targetPort: http, name: http }
```

### Horizontal Pod Autoscaler

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: adk-server
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: adk-server
  minReplicas: 2
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
```

For long-running streams set `terminationGracePeriodSeconds: 60` so in-flight runs finish before SIGTERM forces shutdown.

---

## Resource Sizing

Sizing is dominated by **concurrent active runs**, not request rate. A run holds memory for its message history, streaming buffers, and any in-flight tool calls.

| Concurrent runs | CPU | RAM    | Notes |
| ---------------:| --- | ------ | ----- |
|              10 | 0.25 | 256 MB | hobby / single-user                |
|              50 | 0.5  | 512 MB | small team                         |
|             200 | 1    | 1 GB   | typical product workload           |
|           1,000 | 2    | 2 GB   | scale horizontally past this point |

Streaming runs roughly double the per-run footprint vs. one-shot completions. SSE/WebSocket connections each consume a file descriptor and ~10–50 KB of buffer — raise `ulimit -n` to ≥ 65,536 on hosts that handle many concurrent streams.

---

## Scaling

The server is **stateless** when sessions and rate-limit counters live in a shared store. To scale out:

1. Set `storage` to a Postgres-backed `StorageBackend` (Prisma is the only one shipped).
2. Move rate limiting to a shared store (Redis / Upstash) — the default `rateLimiter` is in-memory and per-instance.
3. Put the replicas behind a load balancer with **sticky sessions on the run/session paths** (or pin via `sessionId` hashing) so streaming connections survive.
4. Set readiness to depend on Postgres connectivity so a struggling DB pulls a replica out of rotation.

LLM provider quotas usually become the bottleneck before host capacity does. Track rate-limit responses in your metrics and use `ADKRouter` with a `fallback-chain` strategy to spill across providers.

---

## Zero-downtime deploys

1. `livenessProbe` only on `/health` (cheap, no DB hop).
2. `readinessProbe` gates traffic; mark unready before SIGTERM so the load balancer drains the pod.
3. Hold SIGTERM for ≥ `terminationGracePeriodSeconds` to let active runs finish. The standalone server already handles SIGINT/SIGTERM gracefully via `packages/adk-server/src/start.ts`.
4. Rolling update with `maxUnavailable: 0` and `maxSurge: 1` on small fleets; raise the surge on larger ones.

---

## Pre-flight checklist

Before flipping the public DNS:

- [ ] `NODE_ENV=production` set (forces `validateApiKey` requirement and HSTS header)
- [ ] Provider keys loaded from a secret manager, not baked into the image
- [ ] `ADK_RATE_LIMIT_RPM` set or backed by your own limiter
- [ ] `ADK_CORS_ORIGINS` enumerates only domains you control
- [ ] TLS terminated at the load balancer / ingress
- [ ] `/health` reachable from outside the pod network
- [ ] Logs flow into your aggregator (stdout → Loki/Datadog/CloudWatch)
- [ ] Outbound egress allowed to required provider hostnames
- [ ] Backups on Postgres (sessions + memory) enabled
- [ ] A rollback target image is published and tested

See [security.md](./security.md) for the hardening checklist and [troubleshooting.md](./troubleshooting.md) for incident response.
