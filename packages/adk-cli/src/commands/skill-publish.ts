// ──────────────────────────────────────────────────────
// aizona skill publish <path>
// Publishes a skill manifest to the AIZona marketplace
// ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createClient } from "../http-client";

export interface SkillPublishOptions {
  community?: string;
  dryRun?: boolean;
}

export async function skillPublishCommand(
  manifestPath: string,
  options?: SkillPublishOptions,
): Promise<void> {
  const resolvedPath = path.resolve(manifestPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }

  let manifest: Record<string, unknown>;
  try {
    const content = fs.readFileSync(resolvedPath, "utf-8");
    manifest = JSON.parse(content);
  } catch (error) {
    console.error(
      `Error: Failed to parse manifest file: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  }

  // Basic local validation
  if (!manifest.name || typeof manifest.name !== "string") {
    console.error("Error: Manifest must have a 'name' field (string)");
    process.exit(1);
  }

  if (!manifest.version || typeof manifest.version !== "string") {
    console.error("Error: Manifest must have a 'version' field (string, semver)");
    process.exit(1);
  }

  if (!manifest.description || typeof manifest.description !== "string") {
    console.error("Error: Manifest must have a 'description' field (string)");
    process.exit(1);
  }

  if (!Array.isArray(manifest.tools) || manifest.tools.length === 0) {
    console.error("Error: Manifest must have at least one tool in the 'tools' array");
    process.exit(1);
  }

  const communityId = options?.community ?? (manifest.communityId as string | undefined);
  if (!communityId) {
    console.error(
      "Error: Community ID is required. Use --community <id> or set 'communityId' in the manifest.",
    );
    process.exit(1);
  }

  if (options?.dryRun) {
    console.log(`[DRY RUN] Would publish skill "${manifest.name}" v${manifest.version}`);
    console.log(`  Community: ${communityId}`);
    console.log(`  Description: ${manifest.description}`);
    console.log(
      `  Tools: ${(manifest.tools as Array<{ name: string }>).map((t) => t.name).join(", ")}`,
    );
    if (manifest.tags) console.log(`  Tags: ${(manifest.tags as string[]).join(", ")}`);
    if (manifest.category) console.log(`  Category: ${manifest.category}`);
    return;
  }

  console.log(`Publishing skill "${manifest.name}" v${manifest.version}...`);

  try {
    const client = createClient();
    const result = await client.publishSkill({
      communityId,
      name: manifest.name as string,
      description: manifest.description as string,
      version: manifest.version as string,
      sourceCode: fs.readFileSync(resolvedPath, "utf-8"),
      inputSchema:
        ((manifest.tools as Array<Record<string, unknown>>)[0]?.inputSchema as Record<
          string,
          unknown
        >) ?? {},
      outputSchema:
        ((manifest.tools as Array<Record<string, unknown>>)[0]?.outputSchema as Record<
          string,
          unknown
        >) ?? {},
      category: manifest.category as string | undefined,
      tags: manifest.tags as string[] | undefined,
    });

    console.log("\nSkill published successfully!");
    console.log(`  ID: ${result.id}`);
    console.log(`  Name: ${result.name}`);
    console.log(`  Version: ${result.version}`);
  } catch (error) {
    console.error(`\nPublish failed: ${error instanceof Error ? error.message : error}`);
    console.error("  Make sure the ADK server is running (aizona dev) and you are authenticated.");
    process.exit(1);
  }
}
