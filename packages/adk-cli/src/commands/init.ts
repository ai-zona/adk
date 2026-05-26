// ──────────────────────────────────────────────────────
// aizona init — Scaffold a new ADK project
// ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { getTemplate } from "../templates/index";

export type TemplateType = "basic" | "multi-agent" | "mcp";

export interface InitOptions {
  template?: string;
  dir?: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  const template = (options.template ?? "basic") as TemplateType;
  const dir = path.resolve(options.dir ?? ".");

  console.log(`Initializing ADK project with "${template}" template in ${dir}...`);

  const files = getTemplate(template);

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(dir, filename);
    const fileDir = path.dirname(filePath);

    // Ensure directory exists
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`  Created ${filename}`);
  }

  console.log("\nDone! Run 'pnpm install' and 'aizona dev' to get started.");
}
