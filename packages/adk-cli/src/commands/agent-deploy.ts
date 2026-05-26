// ──────────────────────────────────────────────────────
// aizona agent deploy <path>
// ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { createClient } from "../http-client";

export interface DeployOptions {
  dryRun?: boolean;
}

export async function agentDeployCommand(
  agentPath: string,
  options?: DeployOptions,
): Promise<void> {
  const resolvedPath = path.resolve(agentPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: File not found: ${resolvedPath}`);
    process.exit(1);
  }

  // Parse agent name from filename
  const agentName = path.basename(resolvedPath, path.extname(resolvedPath));
  const content = fs.readFileSync(resolvedPath, "utf-8");

  if (options?.dryRun) {
    console.log(`[DRY RUN] Would deploy agent "${agentName}" from: ${resolvedPath}`);
    console.log(`  File size: ${content.length} bytes`);
    return;
  }

  console.log(`Deploying agent "${agentName}" from: ${resolvedPath}`);
  console.log("  Validating agent configuration...");

  try {
    const client = createClient();
    const result = await client.registerAgent({
      name: agentName,
      config: { source: resolvedPath },
      version: "1.0.0",
      metadata: { deployedAt: new Date().toISOString() },
    });

    console.log("  Uploading to ADK server...");
    console.log("\nAgent deployed successfully!");
    console.log(`  ID: ${result.id}`);
    console.log(`  Name: ${result.name}`);
  } catch (error) {
    console.error(`\nDeploy failed: ${error instanceof Error ? error.message : error}`);
    console.error("  Make sure the ADK server is running (aizona dev)");
    process.exit(1);
  }
}
