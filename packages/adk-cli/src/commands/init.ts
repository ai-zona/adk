// ──────────────────────────────────────────────────────
// aizona init — Scaffold a new ADK project
// ──────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import { getAvailableTemplates, getTemplate } from "../templates/index";

export type TemplateType = "basic" | "multi-agent" | "mcp";

export interface InitOptions {
  name?: string;
  template?: string;
  dir?: string;
}

function sanitizeProjectName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/^[-_.]+/, "")
    .replace(/-{2,}/g, "-");
}

export async function initCommand(options: InitOptions): Promise<void> {
  const templateName = (options.template ?? "basic") as TemplateType;
  const available = getAvailableTemplates();

  if (!available.includes(templateName)) {
    throw new Error(
      `Unknown template "${templateName}". Available templates: ${available.join(", ")}`,
    );
  }

  // Resolve target directory: explicit --dir wins, then positional name, then cwd.
  // projectName is only set when the user explicitly provided --name; otherwise the
  // template's default package.json "name" is preserved.
  let dir: string;
  let projectName: string | undefined;
  if (options.dir) {
    dir = path.resolve(options.dir);
    if (options.name) {
      projectName = sanitizeProjectName(options.name);
    }
  } else if (options.name) {
    projectName = sanitizeProjectName(options.name);
    dir = path.resolve(process.cwd(), projectName);
  } else {
    dir = path.resolve(".");
  }

  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    // Allow scaffolding into the current directory if explicit (".") — but warn for non-empty
    // named targets to avoid overwriting unrelated files. Still proceed because the user asked.
    console.warn(`  Warning: ${dir} is not empty. Existing files may be overwritten.`);
  }

  console.log(`Initializing ADK project with "${templateName}" template in ${dir}...`);

  const files = getTemplate(templateName);

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(dir, filename);
    const fileDir = path.dirname(filePath);

    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    let finalContent = content;
    // If this is the template's package.json and the user supplied a project name,
    // rewrite the "name" field so the scaffolded project is uniquely identifiable.
    if (filename === "package.json" && projectName && projectName !== "my-adk-project") {
      try {
        const parsed = JSON.parse(content);
        parsed.name = projectName;
        finalContent = `${JSON.stringify(parsed, null, 2)}\n`;
      } catch {
        // leave content untouched if the template package.json is not valid JSON
      }
    }

    fs.writeFileSync(filePath, finalContent, "utf-8");
    console.log(`  Created ${filename}`);
  }

  console.log("\nDone! Run 'pnpm install' and 'aizona dev' to get started.");
}
