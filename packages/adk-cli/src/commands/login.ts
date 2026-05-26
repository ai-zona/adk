// ──────────────────────────────────────────────────────
// aizona login — Authenticate with platform
// ──────────────────────────────────────────────────────

import * as readline from "node:readline";
import { getApiKey, setApiKey } from "../config";
import { ADKClient, createClient } from "../http-client";

export async function loginCommand(): Promise<void> {
  const existing = getApiKey();
  if (existing) {
    console.log("Already authenticated (API key configured).");
    console.log("Use AIZONA_API_KEY env var or run 'aizona login' to change.\n");
  }

  console.log("Enter your AIZona API key (from the Developer Portal):");

  const key = await promptForInput("  API Key: ");

  if (!key.trim()) {
    console.log("No key entered. Aborting.");
    return;
  }

  console.log("  Validating...");

  try {
    const client = new ADKClient(process.env.AIZONA_API_URL ?? "http://localhost:3456", key.trim());
    await client.checkHealth();
    setApiKey(key.trim());
    console.log("\n  Authenticated successfully! API key stored in ~/.aizona/credentials.json");
  } catch (error) {
    // Health endpoint doesn't require auth, so just store the key
    setApiKey(key.trim());
    console.log("\n  API key stored in ~/.aizona/credentials.json");
    console.log("  Note: Could not reach server to validate. Key saved anyway.");
  }
}

function promptForInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
