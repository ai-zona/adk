// ──────────────────────────────────────────────────────
// ADK Artifact Tool — Built-in tool for agents to create A2UI artifacts
// ──────────────────────────────────────────────────────

import type { UIArtifactPart } from "../types/content";
import type { ToolContext, ToolDef } from "../types/tool";
import type { ArtifactStore } from "./artifact-store";

let artifactCounter = 0;

/**
 * Create the built-in `create_artifact` tool.
 * When an agent calls this tool, it creates a UIArtifactPart
 * and optionally persists it to an ArtifactStore.
 */
export function createArtifactTool(store?: ArtifactStore): ToolDef {
  return {
    name: "create_artifact",
    description:
      "Create a visual artifact (HTML page, SVG, code block, or markdown document) that will be rendered in the user's browser. Use this when the user asks for visual output, charts, interactive demos, or formatted code.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the artifact",
        },
        kind: {
          type: "string",
          enum: ["html", "react", "svg", "markdown", "code"],
          description:
            "Type of artifact: html (full page), react (JSX component), svg (vector graphic), markdown (formatted text), code (syntax-highlighted code block)",
        },
        content: {
          type: "string",
          description:
            "The content of the artifact. For html: full HTML with inline CSS/JS. For code: the source code. For svg: SVG markup.",
        },
        language: {
          type: "string",
          description: "Programming language (for code kind only)",
        },
        css: {
          type: "string",
          description: "Optional CSS styles (for html kind)",
        },
      },
      required: ["title", "kind", "content"],
    },
    execute: async (rawInput: unknown, ctx: ToolContext) => {
      const input = rawInput as {
        title: string;
        kind: "html" | "react" | "svg" | "markdown" | "code";
        content: string;
        language?: string;
        css?: string;
      };

      const artifactId = `artifact-${++artifactCounter}-${Date.now()}`;

      const part: UIArtifactPart = {
        type: "ui_artifact",
        artifactId,
        version: 1,
        title: input.title,
        kind: input.kind,
        content: input.content,
        language: input.language,
        css: input.css,
      };

      // Persist if store is available
      if (store) {
        store.upsert(part, ctx.agentName, ctx.runContext.runId);
      }

      return {
        artifactId,
        version: 1,
        title: input.title,
        kind: input.kind,
      };
    },
  };
}
