import { describe, expect, it } from "vitest";
import { workspaceManifestSchema } from "../zod";

// Verbatim copy of sampleManifest from
// packages/api/src/__tests__/contracts/workspace-architect-procedures.test.ts (lines 31-70)
const base = {
  apiVersion: "aizona.dev/v1" as const,
  kind: "WorkspaceManifest" as const,
  metadata: {
    workspaceId: "ws_abc12345abcdef123456",
    title: "Author Publishing",
    summary: "End-to-end self-publishing pipeline for novelists.",
    goalStatement: "Build a workspace for self-publishing a sci-fi trilogy.",
  },
  spec: {
    agents: [],
    teams: [],
    skills: [],
    tools: [],
    dataApis: [],
    knowledge: [],
    sops: [],
    channels: [{ name: "general", kind: "GENERAL" as const }],
    secrets: [],
    sandbox: {
      memoryLimitMb: 128,
      cpuLimitMs: 5000,
      hostFnAllowlist: ["kb.read" as const],
    },
  },
  entitlements: {
    required: [],
    optional: [],
  },
  loadingSequence: {
    steps: [
      {
        id: "init",
        label: "Initialising workspace",
        icon: "loader",
        estimatedMs: 2000,
      },
    ],
  },
} as Record<string, unknown>;

describe("Wave 2 manifest additions", () => {
  it("accepts agent.config", () => {
    const m = JSON.parse(JSON.stringify(base));
    m.spec.agents.push({ slug: "x", source: "PLATFORM", config: { temperature: 0.7 } });
    expect(workspaceManifestSchema.safeParse(m).success).toBe(true);
  });

  it("accepts skill.kind + coolingOff", () => {
    const m = JSON.parse(JSON.stringify(base));
    m.spec.skills.push({
      skillRef: "x",
      provenance: "LLM_GENERATED",
      kind: "PROMPT_TEMPLATE",
      coolingOff: { state: "PENDING", until: new Date().toISOString() },
    });
    expect(workspaceManifestSchema.safeParse(m).success).toBe(true);
  });

  it("accepts top-level voice + duplicatedFrom", () => {
    const m = JSON.parse(JSON.stringify(base));
    m.voice = { inputProvider: "BROWSER_NATIVE", outputProvider: "BROWSER_NATIVE" };
    m.duplicatedFrom = "ws_abc12345abcdef123456";
    expect(workspaceManifestSchema.safeParse(m).success).toBe(true);
  });
});
