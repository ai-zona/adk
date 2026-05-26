# @aizona/adk-cli

Command-line interface for the AIZona Agent Development Kit. Scaffold projects, create agents, manage API keys, and run a local dev server.

## Installation

```bash
pnpm add -g @aizona/adk-cli
# or run via the monorepo:
pnpm aizona <command>
```

## Commands

### `aizona init`

Scaffold a new ADK project.

```bash
aizona init                          # basic template in current directory
aizona init -t multi-agent -d my-app # multi-agent template in ./my-app
```

**Options:**
- `-t, --template <template>` — `basic` (default), `multi-agent`, `mcp`
- `-d, --dir <directory>` — Target directory (default: `.`)

### `aizona agent`

Agent management commands.

```bash
aizona agent create my-agent          # generate agent boilerplate
aizona agent test src/agent.ts        # test locally with default input
aizona agent test src/agent.ts -i "What is 2+2?"  # test with custom input
aizona agent deploy src/agent.ts      # deploy to ADK server
aizona agent deploy src/agent.ts --dry-run  # preview deployment
aizona agent list                     # list deployed agents
```

**Subcommands:**
- `create <name>` — Generate agent file with tool/guardrail stubs
- `test <path>` — Run agent locally with test input (`-i` flag)
- `deploy <path>` — Deploy agent to platform (`--dry-run` for preview)
- `list` — List all deployed agents

### `aizona dev`

Start a local development server.

```bash
aizona dev              # start on port 3456
aizona dev -p 8000      # start on port 8000
```

Starts a Hono server with in-memory storage and all API endpoints enabled (chat, agents, runs, sessions, keys, tools).

### `aizona keys`

API key management.

```bash
aizona keys create -n "my-app"           # create live key
aizona keys create -n "testing" -t test  # create test key
aizona keys list                         # list all keys (masked)
aizona keys revoke <id>                  # revoke a key
```

### `aizona login`

Authenticate with the AIZona platform.

```bash
aizona login
# Prompts for API key, validates, and stores in ~/.aizona/credentials.json
```

Set `AIZONA_API_KEY` environment variable to skip interactive login.

## Configuration

Credentials are stored in `~/.aizona/credentials.json`. The CLI reads from this file or the `AIZONA_API_KEY` environment variable.

## License

MIT
