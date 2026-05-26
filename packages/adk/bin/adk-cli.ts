#!/usr/bin/env node
// adk — AIZona Agent Development Kit CLI

const VERSION = "0.1.0";

const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  process.stdout.write(`
adk — AIZona Agent Development Kit v${VERSION}

Usage:
  adk <command> [options]

Commands:
  init [name]    Scaffold a new ADK project (default: my-agent)
  test <file>    Show guidance for running an agent test file
  deploy <file>  Deploy an agent to AIZona platform

Options:
  --help, -h     Show this help message
  --version, -v  Print version

Examples:
  adk init my-agent
  adk test ./src/agent.ts
  adk deploy ./src/agent.ts

Docs: https://github.com/ai-zona/AIZona/tree/main/packages/adk
`);
}

async function cmdInit(name = "my-agent"): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");

  const root = resolve(process.cwd(), name);
  await mkdir(join(root, "src"), { recursive: true });

  await writeFile(
    join(root, "src", "agent.ts"),
    `import { defineAgent, Runner, AnthropicProvider } from "@aizona/adk";

const agent = defineAgent({
  name: "${name}",
  instructions: "You are a helpful assistant.",
  model: "claude-haiku-4-5-20251001",
});

const runner = new Runner({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }),
});

const result = await runner.run(agent, {
  input: process.argv[2] ?? "Hello! What can you do?",
});

console.log(result.output);
`,
  );

  await writeFile(
    join(root, "package.json"),
    JSON.stringify(
      {
        name,
        version: "0.1.0",
        type: "module",
        scripts: {
          start: "tsx src/agent.ts",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          "@aizona/adk": "latest",
          zod: "^3.24.1",
        },
        devDependencies: {
          tsx: "^4.0.0",
          typescript: "^5.7.3",
          "@types/node": "^20.0.0",
        },
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          outDir: "./dist",
          rootDir: "./src",
        },
        include: ["src"],
      },
      null,
      2,
    ),
  );

  await writeFile(join(root, ".env.example"), "ANTHROPIC_API_KEY=your_key_here\n");
  await writeFile(join(root, ".gitignore"), "node_modules/\ndist/\n.env\n");
  await writeFile(
    join(root, "README.md"),
    `# ${name}

An AI agent built with the [AIZona ADK](https://github.com/ai-zona/AIZona).

## Setup

\`\`\`bash
pnpm install
cp .env.example .env   # fill in your ANTHROPIC_API_KEY
pnpm start "Hello!"
\`\`\`
`,
  );

  console.log(`Created ADK project at ./${name}/`);
  console.log(`  src/agent.ts  — your agent`);
  console.log(`  package.json  — dependencies`);
  console.log();
  console.log("Next steps:");
  console.log(`  cd ${name}`);
  console.log("  pnpm install");
  console.log("  cp .env.example .env   # add ANTHROPIC_API_KEY");
  console.log(`  pnpm start "Hello!"`);
}

async function cmdTest(file: string | undefined): Promise<void> {
  if (!file) {
    process.stderr.write("Error: file argument required\n  Usage: adk test <file>\n");
    process.exit(1);
  }
  console.log("Run your agent file directly:");
  console.log(`  npx tsx ${file}`);
  console.log();
  console.log("Run automated tests with vitest:");
  console.log("  npx vitest run");
  console.log();
  console.log("Run the eval harness:");
  console.log("  import { defineEvalSuite, runEval } from '@aizona/adk'");
}

async function cmdDeploy(file: string | undefined): Promise<void> {
  if (!file) {
    process.stderr.write("Error: file argument required\n  Usage: adk deploy <file>\n");
    process.exit(1);
  }
  console.log("Platform deploy is coming soon.");
  console.log("See https://github.com/ai-zona/AIZona for current deployment options.");
}

async function main(): Promise<void> {
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "--version" || command === "-v" || command === "version") {
    console.log(`adk v${VERSION}`);
    return;
  }

  switch (command) {
    case "init":
      await cmdInit(args[1]);
      break;
    case "test":
      await cmdTest(args[1]);
      break;
    case "deploy":
      await cmdDeploy(args[1]);
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\nRun "adk --help" for usage.\n`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
