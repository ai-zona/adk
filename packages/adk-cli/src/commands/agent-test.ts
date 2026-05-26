// ──────────────────────────────────────────────────────
// aizona agent test <path>
// ──────────────────────────────────────────────────────

import { createClient } from "../http-client";

export interface TestOptions {
  input?: string;
}

export async function agentTestCommand(agentPath: string, options?: TestOptions): Promise<void> {
  const input = options?.input ?? "Hello, agent!";

  console.log(`Testing agent: ${agentPath}`);
  console.log(`  Input: ${input}`);
  console.log("  Running...\n");

  try {
    const client = createClient();
    const startTime = Date.now();
    const result = await client.createRun({ input, agentId: agentPath });
    const latency = Date.now() - startTime;

    const output = result.result?.output ?? "(no output)";
    const usage = result.result?.usage ?? {};

    console.log(`  Output: ${output}`);
    console.log(`  Tokens: ${usage.inputTokens ?? 0} in / ${usage.outputTokens ?? 0} out`);
    console.log(`  Cost: $${(usage.totalCostUsd ?? 0).toFixed(4)}`);
    console.log(`  Latency: ${latency}ms`);
  } catch (error) {
    console.error(`\nTest failed: ${error instanceof Error ? error.message : error}`);
    console.error("  Make sure the ADK server is running (aizona dev)");
    process.exit(1);
  }
}
