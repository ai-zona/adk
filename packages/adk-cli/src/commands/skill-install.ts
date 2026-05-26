// ──────────────────────────────────────────────────────
// aizona skill install <name>
// Installs a skill from the AIZona marketplace
// ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createClient } from "../http-client";

export interface SkillInstallOptions {
  version?: string;
  dir?: string;
}

export async function skillInstallCommand(
  name: string,
  options?: SkillInstallOptions,
): Promise<void> {
  console.log(`Searching for skill "${name}"${options?.version ? ` v${options.version}` : ""}...`);

  try {
    const client = createClient();

    // Search for the skill by name
    const searchResult = await client.searchSkills({ search: name, limit: 10 });

    if (!searchResult.items || searchResult.items.length === 0) {
      console.error(`Error: No skill found matching "${name}"`);
      process.exit(1);
    }

    // Find exact match or best match
    let matched = searchResult.items.find(
      (s: { name: string; version: string }) =>
        s.name === name && (!options?.version || s.version === options.version),
    );

    if (!matched) {
      // Try partial match
      matched = searchResult.items[0];
      console.log(`  No exact match. Using closest match: "${matched.name}" v${matched.version}`);
    }

    // Install (increment download count and get source)
    const installed = await client.installSkill(matched.id);

    // Determine output directory
    const outputDir = path.resolve(options?.dir ?? ".");
    const skillsDir = path.join(outputDir, ".aizona-skills");

    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    // Save the manifest locally
    const skillFile = path.join(skillsDir, `${installed.name}@${installed.version}.json`);
    fs.writeFileSync(
      skillFile,
      JSON.stringify(
        {
          id: installed.id,
          name: installed.name,
          version: installed.version,
          sourceCode: installed.sourceCode,
          inputSchema: installed.inputSchema,
          outputSchema: installed.outputSchema,
          installedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );

    console.log("\nSkill installed successfully!");
    console.log(`  Name: ${installed.name}`);
    console.log(`  Version: ${installed.version}`);
    console.log(`  Saved to: ${skillFile}`);
    console.log(`  Total downloads: ${installed.downloads}`);
  } catch (error) {
    console.error(`\nInstall failed: ${error instanceof Error ? error.message : error}`);
    console.error("  Make sure the ADK server is running (aizona dev) and you are authenticated.");
    process.exit(1);
  }
}
