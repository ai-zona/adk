import { describe, expect, it } from "vitest";
import type { WorkspaceManifest } from "../types";
import { workspaceManifestSchema } from "../zod";

const validMinimal: WorkspaceManifest = {
  apiVersion: "aizona.dev/v1",
  kind: "WorkspaceManifest",
  metadata: {
    workspaceId: "ws_abc12345abcdef123456",
    title: "Test workspace",
    summary: "A minimal valid manifest for testing.",
    goalStatement: "Test goal.",
  },
  spec: {
    agents: [],
    teams: [],
    skills: [],
    tools: [],
    dataApis: [],
    knowledge: [],
    sops: [],
    channels: [{ name: "general", kind: "GENERAL" }],
    secrets: [],
    sandbox: {
      memoryLimitMb: 128,
      cpuLimitMs: 5000,
      hostFnAllowlist: ["kb.read"],
    },
  },
  entitlements: { required: [], optional: [] },
  loadingSequence: {
    steps: [{ id: "ready", label: "Ready", icon: "check", estimatedMs: 100 }],
  },
};

describe("workspaceManifestSchema", () => {
  it("accepts a minimal valid manifest", () => {
    const result = workspaceManifestSchema.safeParse(validMinimal);
    expect(result.success).toBe(true);
  });

  it("rejects wrong apiVersion", () => {
    const bad = { ...validMinimal, apiVersion: "aizona.dev/v0" };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects wrong kind", () => {
    const bad = { ...validMinimal, kind: "NotAManifest" };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects sandbox memory below 64 MB", () => {
    const bad = {
      ...validMinimal,
      spec: {
        ...validMinimal.spec,
        sandbox: { ...validMinimal.spec.sandbox, memoryLimitMb: 32 },
      },
    };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects sandbox cpu over 60s", () => {
    const bad = {
      ...validMinimal,
      spec: {
        ...validMinimal.spec,
        sandbox: { ...validMinimal.spec.sandbox, cpuLimitMs: 90_000 },
      },
    };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects empty channels list (must have at least one channel)", () => {
    const bad = {
      ...validMinimal,
      spec: { ...validMinimal.spec, channels: [] },
    };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects team coordinator that is not in members or in agents", () => {
    const bad = {
      ...validMinimal,
      spec: {
        ...validMinimal.spec,
        agents: [{ slug: "a", source: "PLATFORM" as const }],
        teams: [{ name: "t", coordinator: "ghost", members: ["a"] }],
      },
    };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects unknown host fn in sandbox.hostFnAllowlist", () => {
    const bad = {
      ...validMinimal,
      spec: {
        ...validMinimal.spec,
        sandbox: { ...validMinimal.spec.sandbox, hostFnAllowlist: ["fs.unlink"] },
      },
    };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects loading step with non-positive estimatedMs", () => {
    const bad = {
      ...validMinimal,
      loadingSequence: { steps: [{ id: "x", label: "x", icon: "x", estimatedMs: 0 }] },
    };
    expect(workspaceManifestSchema.safeParse(bad).success).toBe(false);
  });
});
