// ──────────────────────────────────────────────────────
// ADK Skill — defineSkill()
// Community skill manifests for publishing & loading
// ──────────────────────────────────────────────────────

import { z } from "zod";

/** A single tool definition within a skill manifest */
export interface SkillToolEntry {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** JSON Schema for tool input */
  inputSchema: Record<string, unknown>;
  /** JSON Schema for tool output (optional) */
  outputSchema?: Record<string, unknown>;
}

/** Skill manifest — the core portable definition */
export interface SkillManifest {
  /** Unique skill name (scoped to community) */
  name: string;
  /** Semver version string */
  version: string;
  /** Human-readable description */
  description: string;
  /** Category for marketplace browsing */
  category?: string;
  /** Tags for search/filter */
  tags?: string[];
  /** Tool definitions included in this skill */
  tools: SkillToolEntry[];
  /** Optional agent configuration hints (model, temperature, etc.) */
  agentConfig?: Record<string, unknown>;
  /** Other skills this skill depends on */
  dependencies?: string[];
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

/** Zod schema for a single tool entry */
const SkillToolEntrySchema = z.object({
  name: z.string().min(1, "Tool name is required"),
  description: z.string().min(1, "Tool description is required"),
  inputSchema: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()).optional(),
});

/** Zod schema for full skill manifest validation */
export const SkillManifestSchema = z.object({
  name: z
    .string()
    .min(1, "Skill name is required")
    .max(128, "Skill name must be at most 128 characters")
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "Skill name must contain only alphanumeric characters, hyphens, and underscores",
    ),
  version: z
    .string()
    .min(1, "Version is required")
    .regex(/^\d+\.\d+\.\d+$/, "Version must be valid semver (e.g. 1.0.0)"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(2000, "Description must be at most 2000 characters"),
  category: z.string().max(64).optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  tools: z.array(SkillToolEntrySchema).min(1, "At least one tool is required"),
  agentConfig: z.record(z.unknown()).optional(),
  dependencies: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Define and validate a skill manifest.
 * Throws if the manifest is invalid.
 */
export function defineSkill(manifest: SkillManifest): SkillManifest {
  const result = SkillManifestSchema.safeParse(manifest);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid skill manifest:\n${issues.join("\n")}`);
  }

  // Check for duplicate tool names
  const toolNames = new Set<string>();
  for (const tool of manifest.tools) {
    if (toolNames.has(tool.name)) {
      throw new Error(`Duplicate tool name in skill manifest: "${tool.name}"`);
    }
    toolNames.add(tool.name);
  }

  return result.data;
}
