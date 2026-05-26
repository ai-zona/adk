// ──────────────────────────────────────────────────────
// aizona validate [path]
// ──────────────────────────────────────────────────────

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";

interface ValidationResult {
  check: string;
  passed: boolean;
  /** True for soft failures (warnings) — used to colour the icon. */
  warning?: boolean;
  message: string;
}

function findAgentSourceFiles(dir: string): string[] {
  const agentsDir = resolve(dir, "agents");
  if (!existsSync(agentsDir)) return [];
  try {
    if (!statSync(agentsDir).isDirectory()) return [];
  } catch {
    return [];
  }
  try {
    return readdirSync(agentsDir)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
      .map((f) => resolve(agentsDir, f));
  } catch {
    return [];
  }
}

export function createValidateCommand(): Command {
  return new Command("validate")
    .description("Validate agent configuration before deployment")
    .argument("[path]", "Path to agent config file", ".")
    .option("--strict", "Fail on warnings", false)
    .action(async (path: string, options: { strict: boolean }) => {
      const results: ValidationResult[] = [];
      const configPath = resolve(path);

      // Check 1: Config file or agent source exists.
      // Accept either a top-level config file (agent.json, agent.ts, aizona.config.ts)
      // OR one or more agent source files in the `agents/` folder — that matches the
      // layout produced by `aizona init` so a freshly scaffolded project validates.
      const possibleFiles = ["agent.json", "agent.yaml", "agent.ts", "aizona.config.ts"];
      let configFile: string | null = null;
      for (const file of possibleFiles) {
        const fullPath = resolve(configPath, file);
        if (existsSync(fullPath)) {
          configFile = fullPath;
          break;
        }
      }

      const agentFiles = findAgentSourceFiles(configPath);

      if (configFile) {
        results.push({
          check: "config-file",
          passed: true,
          message: `Found config: ${configFile}`,
        });
      } else if (agentFiles.length > 0) {
        results.push({
          check: "config-file",
          passed: true,
          message: `Found ${agentFiles.length} agent source file(s) in agents/`,
        });
      } else {
        results.push({
          check: "config-file",
          passed: false,
          message: `No agent config found in ${configPath}. Expected one of: ${possibleFiles.join(", ")}, or agent files in agents/`,
        });
      }

      // Check 2: package.json exists and is valid
      const pkgPath = resolve(configPath, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
          results.push({
            check: "package-json",
            passed: true,
            message: `Package: ${pkg.name}@${pkg.version}`,
          });

          // Check 3: ADK dependency present
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps["@aizonaai/adk"]) {
            results.push({
              check: "adk-dependency",
              passed: true,
              message: `@aizonaai/adk version: ${deps["@aizonaai/adk"]}`,
            });
          } else {
            results.push({
              check: "adk-dependency",
              passed: false,
              message: "@aizonaai/adk not found in dependencies",
            });
          }

          // Check 4: Main/entry point exists
          const entryPoint = pkg.main ?? pkg.module ?? pkg.exports?.["."];
          if (entryPoint) {
            const entryPath = resolve(configPath, entryPoint);
            const entryExists = existsSync(entryPath);
            results.push({
              check: "entry-point",
              passed: entryExists,
              message: entryExists
                ? `Entry point found: ${entryPoint}`
                : `Entry point missing: ${entryPoint}`,
            });
          }
        } catch {
          results.push({
            check: "package-json",
            passed: false,
            message: "Failed to parse package.json",
          });
        }
      } else {
        results.push({
          check: "package-json",
          passed: false,
          message: "No package.json found",
        });
      }

      // Check 5: TypeScript config
      const tsconfigPath = resolve(configPath, "tsconfig.json");
      results.push({
        check: "tsconfig",
        passed: existsSync(tsconfigPath),
        message: existsSync(tsconfigPath) ? "tsconfig.json found" : "No tsconfig.json (optional)",
      });

      // Check 6: Environment file check (warn if .env is present — shouldn't be deployed)
      const envPath = resolve(configPath, ".env");
      if (existsSync(envPath)) {
        results.push({
          check: "env-file",
          passed: !options.strict,
          warning: true,
          message: "WARNING: .env file found \u2014 ensure secrets are not included in deployment",
        });
      }

      // Check 7: .gitignore exists (deployment best practice)
      const gitignorePath = resolve(configPath, ".gitignore");
      if (!existsSync(gitignorePath)) {
        results.push({
          check: "gitignore",
          passed: !options.strict,
          warning: true,
          message: "WARNING: No .gitignore found \u2014 recommended for deployment safety",
        });
      }

      // Print results
      console.log("\n  Agent Validation Report\n");
      let hasFailures = false;
      for (const result of results) {
        let icon: string;
        let color: string;
        if (!result.passed) {
          icon = "\u2717";
          color = "\x1b[31m";
        } else if (result.warning) {
          icon = "!";
          color = "\x1b[33m";
        } else {
          icon = "\u2713";
          color = "\x1b[32m";
        }
        console.log(`  ${color}${icon}\x1b[0m ${result.check}: ${result.message}`);
        if (!result.passed) hasFailures = true;
      }

      console.log(
        `\n  ${results.filter((r) => r.passed).length}/${results.length} checks passed\n`,
      );

      if (hasFailures) {
        process.exitCode = 1;
      }
    });
}
