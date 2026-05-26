# CLI Reference — `@aizonaai/adk-cli`

The ADK CLI ships as `aizona` (the binary name) once installed. You can also invoke it ad-hoc via `npx`.

```bash
npm install -g @aizonaai/adk-cli
aizona --help

# or one-shot
npx @aizonaai/adk-cli <command>
```

All commands respect the following environment variables:

| Variable             | Purpose                                              |
|----------------------|------------------------------------------------------|
| `ANTHROPIC_API_KEY`  | Anthropic provider key (or any other supported key)  |
| `AIZONA_API_KEY`     | Auth for the AIZona platform (deploy / login)        |
| `AIZONA_API_URL`     | Override the platform URL (defaults to production)   |
| `ADK_LOG_LEVEL`      | `debug` \| `info` \| `warn` \| `error`               |

---

## `aizona init [name]`

Scaffold a new ADK project from the bundled template.

```bash
aizona init my-agent
cd my-agent
pnpm install
pnpm start
```

Options:

| Flag                | Description                                  |
|---------------------|----------------------------------------------|
| `-d, --dir <path>`  | Target directory (default: `./<name>`)       |
| `--template <name>` | Template to use (`basic`, `multi-agent`)     |

The template ships with `index.ts`, `package.json`, `tsconfig.json`, and a `.env.example` covering all supported providers.

---

## `aizona agent-init [name]`

Scaffold a fresh **A2A agent** project — adds a DID, an example skill, and `.env` wiring. Use this when you want to publish an agent on the AIZona marketplace.

```bash
aizona agent-init my-public-agent
```

---

## `aizona agent <subcommand>`

Agent lifecycle commands.

### `aizona agent create <name>`

Generate boilerplate for an additional agent inside the current project.

### `aizona agent test <path>`

Run an agent locally against the inputs in `tests/cases.json`.

```bash
aizona agent test ./agents/triage
```

### `aizona agent deploy <path>`

Deploy an agent to the AIZona platform. Requires `aizona login` first.

```bash
aizona agent deploy ./agents/triage
```

Options:

| Flag             | Description                              |
|------------------|------------------------------------------|
| `--env <name>`   | Target environment (`prod`, `staging`)   |
| `--dry-run`      | Bundle and validate without uploading    |

### `aizona agent list`

List agents deployed under your account.

---

## `aizona dev`

Start a local development server (Hono + ADK server) on port 3456.

```bash
aizona dev
aizona dev -p 8080
```

Options:

| Flag                | Description                  |
|---------------------|------------------------------|
| `-p, --port <port>` | Listen port (default `3456`) |

The dev server enables anonymous access — **do not bind it to a public interface**. Use [`@aizonaai/adk-server`](../packages/adk-server/) directly for production.

---

## `aizona keys <subcommand>`

Manage ADK API keys (the keys your callers use to reach `@aizonaai/adk-server`).

### `aizona keys create`

Create a new key. Prints the plaintext key **once** — store it now.

```bash
aizona keys create --name "production-web" --type live
```

Options:

| Flag                | Description                       |
|---------------------|-----------------------------------|
| `-n, --name <name>` | Human-readable label              |
| `-t, --type <type>` | `live` or `test` (default `live`) |

### `aizona keys list`

List active keys (by prefix only — full keys are never re-printed).

### `aizona keys revoke <id>`

Revoke a key immediately. Validation runs per request, so propagation is instant.

---

## `aizona skill <subcommand>`

Community skill management for the AIZona marketplace.

### `aizona skill publish <path>`

Publish a skill from the given directory.

```bash
aizona skill publish ./skills/email-triage --community myteam
```

Options:

| Flag                       | Description                              |
|----------------------------|------------------------------------------|
| `-c, --community <id>`     | Community ID to publish under            |
| `--dry-run`                | Validate the manifest without uploading  |

### `aizona skill install <name>`

Install a skill from the marketplace into the current project.

```bash
aizona skill install email-triage
aizona skill install email-triage --version 1.2.0
```

### `aizona skill search <query>`

Search for skills.

```bash
aizona skill search "code review" --limit 5 --category devops
```

---

## `aizona login`

Authenticate with the AIZona platform via OAuth. Stores the token in `~/.config/aizona/credentials.json`.

```bash
aizona login
```

---

## `aizona usage`

Show usage statistics for the authenticated account: spend, tokens, top agents, error rate.

```bash
aizona usage
aizona usage --since '24 hours ago'
```

---

## Exit codes

| Code | Meaning                                |
|------|----------------------------------------|
| 0    | Success                                |
| 1    | Generic failure / validation error     |
| 2    | Guardrail tripwire fired               |
| 3    | Unauthenticated (run `aizona login`)   |
| 4    | Network / provider unavailable         |

---

## Troubleshooting

- `command not found: aizona` — install with `npm i -g @aizonaai/adk-cli` or call via `npx @aizonaai/adk-cli`.
- `EACCES` on global install — use `npx`, or fix the npm prefix (`npm config set prefix ~/.npm-global`).
- Deploy fails with `401` — re-run `aizona login`; tokens expire after 30 days.

See [troubleshooting.md](./troubleshooting.md) for runtime issues.
