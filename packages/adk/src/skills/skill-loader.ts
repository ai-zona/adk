// ──────────────────────────────────────────────────────
// ADK Skill Loader — Converts SkillManifest → ToolDef[]
// ──────────────────────────────────────────────────────

import type { JsonSchema } from "../types/agent";
import type { ToolContext, ToolDef } from "../types/tool";
import type { SkillManifest, SkillToolEntry } from "./define-skill";
import { SkillManifestSchema } from "./define-skill";

/** Result of loading a skill */
export interface LoadedSkill {
  /** Tool definitions ready to use in an agent */
  tools: ToolDef[];
  /** Agent configuration hints from the manifest */
  agentConfig?: Record<string, unknown>;
  /** Original manifest metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Create a ToolDef from a SkillToolEntry.
 * The resulting tool has a stub execute that returns
 * a message indicating it was loaded from a skill manifest.
 * Callers should override `execute` with actual implementations.
 */
function createToolFromEntry(skillName: string, entry: SkillToolEntry): ToolDef {
  const inputSchema: JsonSchema = {
    type: "object",
    ...entry.inputSchema,
  };

  const outputSchema: JsonSchema | undefined = entry.outputSchema
    ? { type: "object", ...entry.outputSchema }
    : undefined;

  return {
    name: entry.name,
    description: entry.description,
    inputSchema,
    outputSchema,
    execute: async (input: unknown, _ctx: ToolContext) => {
      // Default stub — real implementations should replace this
      return {
        _skill: skillName,
        _tool: entry.name,
        _stub: true,
        message: `Tool "${entry.name}" from skill "${skillName}" executed with stub. Provide a real execute function.`,
        input,
      };
    },
    metadata: {
      _fromSkill: skillName,
      _skillTool: true,
    },
  };
}

/**
 * Load a skill manifest and produce ToolDef instances.
 *
 * @param manifest - A validated SkillManifest
 * @param toolImplementations - Optional map of tool name → execute function overrides
 * @returns LoadedSkill with ToolDef[] and agentConfig
 */
export function loadSkill(
  manifest: SkillManifest,
  toolImplementations?: Record<string, (input: unknown, ctx: ToolContext) => Promise<unknown>>,
): LoadedSkill {
  // Validate manifest
  const parsed = SkillManifestSchema.safeParse(manifest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid skill manifest:\n${issues.join("\n")}`);
  }

  const tools: ToolDef[] = manifest.tools.map((entry) => {
    const tool = createToolFromEntry(manifest.name, entry);

    // Override execute if an implementation was provided
    if (toolImplementations?.[entry.name]) {
      tool.execute = toolImplementations[entry.name]!;
    }

    return tool;
  });

  return {
    tools,
    agentConfig: manifest.agentConfig,
    metadata: manifest.metadata,
  };
}

/**
 * Merge tools from multiple loaded skills into a single array.
 * Throws if tool name collisions are detected across skills.
 */
export function mergeSkillTools(...loadedSkills: LoadedSkill[]): ToolDef[] {
  const nameMap = new Map<string, string>(); // tool name → skill name
  const allTools: ToolDef[] = [];

  for (const loaded of loadedSkills) {
    for (const tool of loaded.tools) {
      const existingSkill = nameMap.get(tool.name);
      if (existingSkill) {
        throw new Error(
          `Tool name collision: "${tool.name}" exists in both skill "${existingSkill}" ` +
            `and skill "${(tool.metadata as Record<string, unknown>)?._fromSkill ?? "unknown"}"`,
        );
      }
      nameMap.set(
        tool.name,
        ((tool.metadata as Record<string, unknown>)?._fromSkill as string) ?? "unknown",
      );
      allTools.push(tool);
    }
  }

  return allTools;
}
