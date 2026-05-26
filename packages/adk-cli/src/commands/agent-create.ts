// ──────────────────────────────────────────────────────
// aizona agent create <name>
// ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";

export async function agentCreateCommand(name: string): Promise<void> {
  const agentCode = `import { defineAgent, defineTool } from "@aizona/adk";
import { z } from "zod";

export const ${toCamelCase(name)}Agent = defineAgent({
  name: "${name}",
  instructions: "You are a helpful ${name} agent.",
  tools: [],
});
`;

  const dir = path.resolve("agents");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${name}.ts`);
  fs.writeFileSync(filePath, agentCode, "utf-8");

  console.log(`Created agent: ${name}`);
  console.log(`  ${filePath}`);
  console.log(`\nEdit agents/${name}.ts to customize.`);
}

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
