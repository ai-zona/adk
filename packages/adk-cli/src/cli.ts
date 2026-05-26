// ──────────────────────────────────────────────────────
// CLI entry point
// ──────────────────────────────────────────────────────

import { Command } from "commander";
import { agentCreateCommand } from "./commands/agent-create";
import { agentDeployCommand } from "./commands/agent-deploy";
import { agentInitCommand } from "./commands/agent-init";
import { agentTestCommand } from "./commands/agent-test";
import { devCommand } from "./commands/dev";
import { initCommand } from "./commands/init";
import { keysCommand } from "./commands/keys";
import { loginCommand } from "./commands/login";
import { skillInstallCommand } from "./commands/skill-install";
import { skillPublishCommand } from "./commands/skill-publish";
import { createValidateCommand } from "./commands/validate";
import { createClient } from "./http-client";

export function createCLI(): Command {
  const program = new Command();

  program.name("aizona").description("AIZona Agent Development Kit CLI").version("0.1.0");

  // aizona init
  program
    .command("init")
    .description("Scaffold a new ADK project")
    .option("-t, --template <template>", "Template to use", "basic")
    .option("-d, --dir <directory>", "Target directory", ".")
    .action(initCommand);

  // aizona agent-init <name> — scaffold a fresh A2A agent project
  program
    .command("agent-init [name]")
    .description("Scaffold a fresh A2A agent project (DID + skill + .env)")
    .option("-d, --dir <directory>", "Target directory (defaults to ./<name>)")
    .action(async (name: string | undefined, opts: { dir?: string }) => {
      try {
        await agentInitCommand(name, { dir: opts.dir });
      } catch (error) {
        console.error(`Failed: ${error instanceof Error ? error.message : error}`);
        process.exitCode = 1;
      }
    });

  // aizona agent <subcommand>
  const agent = program.command("agent").description("Agent management commands");

  agent
    .command("create <name>")
    .description("Generate agent boilerplate")
    .action(agentCreateCommand);

  agent
    .command("deploy <path>")
    .description("Deploy agent to AIZona platform")
    .option("--dry-run", "Show what would be deployed")
    .action(agentDeployCommand);

  agent
    .command("test <path>")
    .description("Run agent locally with test inputs")
    .option("-i, --input <input>", "Test input")
    .action(agentTestCommand);

  agent
    .command("list")
    .description("List deployed agents")
    .action(async () => {
      try {
        const client = createClient();
        const { agents, total } = await client.listAgents();
        if (total === 0) {
          console.log("No agents deployed. Use 'aizona agent deploy' to deploy.");
          return;
        }
        console.log(`Agents (${total}):\n`);
        for (const a of agents) {
          console.log(`  ${a.id}  ${a.name}  v${a.version}  ${a.createdAt}`);
        }
      } catch (error) {
        console.error(`Failed: ${error instanceof Error ? error.message : error}`);
        console.error("  Make sure the ADK server is running (aizona dev)");
      }
    });

  // aizona dev
  program
    .command("dev")
    .description("Start local dev server")
    .option("-p, --port <port>", "Port number", "3456")
    .action(devCommand);

  // aizona keys <subcommand>
  const keys = program.command("keys").description("API key management");

  keys
    .command("create")
    .description("Create a new API key")
    .option("-n, --name <name>", "Key name")
    .option("-t, --type <type>", "Key type (live or test)", "live")
    .action(keysCommand);

  keys
    .command("list")
    .description("List API keys")
    .action(async () => {
      try {
        const client = createClient();
        const { keys: keyList, total } = await client.listKeys();
        if (total === 0) {
          console.log("No API keys. Use 'aizona keys create' to create one.");
          return;
        }
        console.log(`API Keys (${total}):\n`);
        for (const k of keyList) {
          const status = k.active ? "active" : "revoked";
          console.log(`  ${k.id}  ${k.prefix}...  ${k.name}  [${status}]`);
        }
      } catch (error) {
        console.error(`Failed: ${error instanceof Error ? error.message : error}`);
        console.error("  Make sure the ADK server is running (aizona dev)");
      }
    });

  keys
    .command("revoke <id>")
    .description("Revoke an API key")
    .action(async (id: string) => {
      try {
        const client = createClient();
        await client.revokeKey(id);
        console.log(`Revoked key: ${id}`);
      } catch (error) {
        console.error(`Failed: ${error instanceof Error ? error.message : error}`);
      }
    });

  // aizona skill <subcommand>
  const skill = program.command("skill").description("Community skill management");

  skill
    .command("publish <path>")
    .description("Publish a skill to the AIZona marketplace")
    .option("-c, --community <id>", "Community ID")
    .option("--dry-run", "Show what would be published")
    .action(skillPublishCommand);

  skill
    .command("install <name>")
    .description("Install a skill from the marketplace")
    .option("-v, --version <version>", "Specific version to install")
    .option("-d, --dir <directory>", "Target directory", ".")
    .action(skillInstallCommand);

  skill
    .command("search <query>")
    .description("Search skills in the marketplace")
    .option("-c, --community <id>", "Filter by community")
    .option("--category <category>", "Filter by category")
    .option("-l, --limit <limit>", "Max results", "10")
    .action(
      async (query: string, options: { community?: string; category?: string; limit?: string }) => {
        try {
          const client = createClient();
          const result = await client.searchSkills({
            search: query,
            communityId: options.community,
            category: options.category,
            limit: Number(options.limit ?? 10),
          });

          if (!result.items || result.items.length === 0) {
            console.log(`No skills found matching "${query}".`);
            return;
          }

          console.log(`Skills matching "${query}":\n`);
          for (const s of result.items) {
            const stars = s.rating ? ` (${s.rating.toFixed(1)}/5)` : "";
            const dep = s.deprecated ? " [DEPRECATED]" : "";
            console.log(`  ${s.name}  v${s.version}  ${s.downloads} downloads${stars}${dep}`);
            if (s.description)
              console.log(
                `    ${s.description.slice(0, 80)}${s.description.length > 80 ? "..." : ""}`,
              );
          }
        } catch (error) {
          console.error(`Failed: ${error instanceof Error ? error.message : error}`);
          console.error("  Make sure the ADK server is running (aizona dev)");
        }
      },
    );

  // aizona validate
  program.addCommand(createValidateCommand());

  // aizona login
  program.command("login").description("Authenticate with AIZona platform").action(loginCommand);

  // aizona usage
  program
    .command("usage")
    .description("Show usage statistics")
    .action(async () => {
      try {
        const client = createClient();
        const usage = await client.getUsage();
        console.log("Usage Statistics:");
        console.log(JSON.stringify(usage, null, 2));
      } catch (error) {
        console.error(`Failed: ${error instanceof Error ? error.message : error}`);
        console.error("  Make sure the ADK server is running (aizona dev)");
      }
    });

  return program;
}
