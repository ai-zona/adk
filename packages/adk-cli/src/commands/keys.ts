// ──────────────────────────────────────────────────────
// aizona keys — API key management
// ──────────────────────────────────────────────────────

import { createClient } from "../http-client";

export interface KeysOptions {
  name?: string;
  type?: string;
}

export async function keysCommand(options: KeysOptions): Promise<void> {
  const type = (options?.type === "test" ? "test" : "live") as "live" | "test";
  const name = options?.name ?? "API Key";

  try {
    const client = createClient();
    const result = await client.createKey({ name, type });

    console.log(`Created ${type} API key: "${name}"`);
    console.log(`\n  Key: ${result.key}`);
    console.log(`  ID: ${result.id}`);
    console.log(`  Prefix: ${result.prefix}`);
    console.log("\n  IMPORTANT: Save this key securely. It will not be shown again.");
  } catch (error) {
    console.error(`Failed to create key: ${error instanceof Error ? error.message : error}`);
    console.error("  Make sure the ADK server is running (aizona dev)");
    process.exit(1);
  }
}
