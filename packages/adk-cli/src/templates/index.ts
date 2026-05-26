// ──────────────────────────────────────────────────────
// Project Templates
// ──────────────────────────────────────────────────────

import type { TemplateType } from "../commands/init";

type TemplateFiles = Record<string, string>;

const basicTemplate: TemplateFiles = {
  "package.json": JSON.stringify(
    {
      name: "my-adk-project",
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "aizona dev",
        test: "aizona agent test ./agents",
      },
      dependencies: {
        "@aizona/adk": "latest",
        zod: "^3.24.1",
      },
    },
    null,
    2,
  ),
  "agents/my-agent.ts": `import { defineAgent, defineTool } from "@aizona/adk";
import { z } from "zod";

const greetTool = defineTool({
  name: "greet",
  description: "Greet a user by name",
  inputSchema: z.object({ name: z.string() }),
  execute: async (input) => \`Hello, \${input.name}!\`,
});

export const myAgent = defineAgent({
  name: "my-agent",
  instructions: "You are a helpful assistant. Use the greet tool to greet users.",
  tools: [greetTool],
});
`,
  "tsconfig.json": JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        esModuleInterop: true,
      },
      include: ["agents/**/*.ts"],
    },
    null,
    2,
  ),
};

const multiAgentTemplate: TemplateFiles = {
  ...basicTemplate,
  "agents/coordinator.ts": `import { defineAgent } from "@aizona/adk";

export const coordinator = defineAgent({
  name: "coordinator",
  instructions: "You coordinate tasks between team members.",
  handoffs: [
    { agent: "researcher", description: "Research tasks" },
    { agent: "writer", description: "Writing tasks" },
  ],
});
`,
  "agents/researcher.ts": `import { defineAgent } from "@aizona/adk";

export const researcher = defineAgent({
  name: "researcher",
  instructions: "You research topics and provide detailed information.",
});
`,
  "agents/writer.ts": `import { defineAgent } from "@aizona/adk";

export const writer = defineAgent({
  name: "writer",
  instructions: "You write clear, well-structured content.",
});
`,
};

const mcpTemplate: TemplateFiles = {
  ...basicTemplate,
  "agents/mcp-agent.ts": `import { defineAgent, mcpServerTools } from "@aizona/adk";

// Connect to MCP server and get tools
const tools = await mcpServerTools({
  serverUrl: "http://localhost:3002",
  transport: "streamable-http",
});

export const mcpAgent = defineAgent({
  name: "mcp-agent",
  instructions: "You use MCP tools to help the user.",
  tools,
});
`,
};

const templates: Record<TemplateType, TemplateFiles> = {
  basic: basicTemplate,
  "multi-agent": multiAgentTemplate,
  mcp: mcpTemplate,
};

export function getTemplate(type: TemplateType): TemplateFiles {
  return templates[type] ?? templates.basic;
}

export function getAvailableTemplates(): TemplateType[] {
  return Object.keys(templates) as TemplateType[];
}
