# @aizonaai/adk-cli

Command-line interface for the AIZona Agent Development Kit. Scaffold projects, create agents, manage API keys, validate configs, install marketplace skills, and run a local dev server.

## Installation

```bash
# Global install
pnpm add -g @aizonaai/adk-cli

# Or invoke via the monorepo
pnpm aizona <command>

# Quick one-shot scaffold
npx @aizonaai/adk-cli init my-app
```

After install, the `aizona` binary is on `$PATH`. Run `aizona --help` to see all commands or `aizona <command> --help` for details on any subcommand.

## Quick Start

```bash
aizona init my-project          # scaffold an ADK project
cd my-project && pnpm install
aizona dev                      # start the local dev server (port 3456)
aizona validate .               # check the project before deploy
aizona agent deploy ./agents    # deploy to the running server
```

## Commands

### `aizona init [name]`

Scaffold a new ADK project. Creates `package.json`, `tsconfig.json`, and one or more agent files under `agents/`.

```bash
aizona init                                # basic template in current directory
aizona init my-app                         # basic template in ./my-app
aizona init -t multi-agent -d ./my-app     # multi-agent template in ./my-app
aizona init --template mcp --dir ./mcp-bot # MCP template in ./mcp-bot
```

**Arguments:**
- `[name]` — Project name (used as the directory and as `package.json` "name"). Sanitized to kebab-case.

**Options:**
- `-t, --template <template>` — One of `basic` (default), `multi-agent`, `mcp`.
- `-d, --dir <directory>` — Target directory. When omitted, falls back to `./[name]` or `.`.

**Templates:**
- `basic` — single agent with a `greet` tool stub.
- `multi-agent` — coordinator + researcher + writer agents wired up with handoffs.
- `mcp` — agent that pulls tools from an MCP server.

### `aizona agent-init [name]`

Scaffold a fresh **A2A agent** project — including a generated `did:aza:` DID and Ed25519 keypair — for publishing on the AIZona marketplace.

```bash
aizona agent-init my-bot                   # interactive prompts
aizona agent-init my-bot --dir ./my-bot    # explicit target directory
```

Outputs:
- `package.json`, `tsconfig.json`, `.gitignore`
- `.env.example` with `AIZONA_DID`, `AIZONA_PRIVATE_KEY`, `AIZONA_API_URL` filled in
- `src/index.ts` — A2A server entrypoint
- `src/skills/<skill>.ts` — a priced skill stub
- `README.md` with the generated DID and onboarding steps

**Options:**
- `-d, --dir <directory>` — Target directory (default: `./<name>`).

The DID and private key are byte-compatible with the browser-side `list-agent` wizard at `apps/web/.../marketplace/list-agent/keygen.ts`. Keep `.env` out of source control — `agent-init` writes `.env.example` so you can copy it locally.

### `aizona agent <subcommand>`

Agent management against the running ADK server.

```bash
aizona agent create my-agent              # generate an agent stub locally
aizona agent test ./agents/my-agent.ts    # run agent with the default test input
aizona agent test ./agents/my-agent.ts -i "What is 2+2?"
aizona agent deploy ./agents/my-agent.ts  # deploy to ADK server
aizona agent deploy ./agents/my-agent.ts --dry-run
aizona agent list                         # list deployed agents
```

**Subcommands:**
- `create <name>` — Generate an agent file with tool/guardrail stubs in the current directory.
- `test <path>` — Run an agent locally (loads via tsx) with `-i, --input <input>` as the user message.
- `deploy <path>` — Deploy an agent to the platform. Pass `--dry-run` to preview without writing.
- `list` — List all deployed agents (ID, name, version, createdAt).

The `deploy`, `list`, and `test` commands require a running server (`aizona dev`) or a configured remote API endpoint.

### `aizona dev`

Start a local ADK dev server with in-memory storage and all API endpoints enabled (chat, agents, runs, sessions, keys, tools).

```bash
aizona dev              # start on port 3456
aizona dev -p 8000      # start on port 8000
aizona dev --port 8000  # long form
```

**Options:**
- `-p, --port <port>` — Port number (default: `3456`).

The dev server is a Hono app provided by `@aizonaai/adk-server` (declared as an optional peer dependency). Install it alongside `@aizonaai/adk-cli` if you need `dev` to work.

### `aizona validate [path]`

Validate an agent project before deployment. Runs a checklist of structural and dependency checks.

```bash
aizona validate              # validate the current directory
aizona validate ./my-app     # validate a specific project
aizona validate --strict     # treat warnings as failures
```

**Arguments:**
- `[path]` — Path to the agent project root (default: `.`).

**Options:**
- `--strict` — Exit non-zero on warnings (e.g. stray `.env`, missing `.gitignore`).

**Checks performed:**
1. Top-level agent config (`agent.json|.yaml|.ts`, `aizona.config.ts`) **or** at least one `*.ts|.js` file in `agents/`.
2. `package.json` exists and parses as JSON.
3. `@aizonaai/adk` is listed under `dependencies` or `devDependencies`.
4. Entry point declared in `package.json` (`main` / `module` / `exports["."]`) exists on disk.
5. `tsconfig.json` is present (warns if missing).
6. **Warning:** a `.env` file is present (should not be deployed).
7. **Warning:** no `.gitignore` is present.

Exit code is `1` if any hard check fails, or any warning fails under `--strict`.

### `aizona keys <subcommand>`

API key management for the ADK server.

```bash
aizona keys create -n "my-app"           # create live key (default)
aizona keys create -n "ci-tests" -t test # create test key
aizona keys list                         # list all keys (masked)
aizona keys revoke <id>                  # revoke a key by ID
```

**Subcommands:**
- `create` — Create a new key. Options: `-n, --name <name>`, `-t, --type <live|test>` (default: `live`).
- `list` — List all keys with prefix, name, and status.
- `revoke <id>` — Revoke the key with the given ID.

The newly created `key` value is shown **once** — store it securely.

### `aizona skill <subcommand>`

Community skill marketplace management.

```bash
aizona skill publish ./my-skill                    # publish skill to marketplace
aizona skill publish ./my-skill -c <community-id>  # publish to a community
aizona skill publish ./my-skill --dry-run          # preview without publishing
aizona skill install some-skill                    # install latest version
aizona skill install some-skill -v 1.2.3 -d .      # install specific version
aizona skill search "weather"                      # search marketplace
aizona skill search "weather" -c <id> --category data -l 20
```

**Subcommands:**
- `publish <path>` — Publish a skill. Options: `-c, --community <id>`, `--dry-run`.
- `install <name>` — Install a skill. Options: `-v, --version <version>`, `-d, --dir <directory>` (default: `.`).
- `search <query>` — Search the marketplace. Options: `-c, --community <id>`, `--category <category>`, `-l, --limit <limit>` (default: `10`).

### `aizona login`

Authenticate with the AIZona platform.

```bash
aizona login
# Prompts for API key, validates against the server, and stores in ~/.aizona/credentials.json
```

Set the `AIZONA_API_KEY` environment variable to skip the interactive prompt — when present, the CLI uses it for all authenticated requests.

### `aizona usage`

Print usage statistics for the authenticated account from the ADK server.

```bash
aizona usage
```

Output is the raw JSON from the server's usage endpoint.

## Configuration

The CLI resolves credentials in this order:

1. `AIZONA_API_KEY` environment variable.
2. `~/.aizona/credentials.json` (written by `aizona login`).

Server URL defaults to `http://localhost:3456` (the `aizona dev` port). Override with `AIZONA_API_URL` to target a remote ADK server.

## Exit codes

- `0` — Success.
- `1` — Validation failed, deployment refused, request failed, or generic error.

Commands that require the ADK server (`agent deploy`, `agent list`, `keys list/revoke`, `skill *`, `usage`) print a hint to start `aizona dev` when the request fails.

## License

MIT
