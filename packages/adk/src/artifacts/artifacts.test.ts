import { describe, expect, it } from "vitest";
import type { UIArtifactPart } from "../types/content";
import type { ToolContext } from "../types/tool";
import { ArtifactStore } from "./artifact-store";
import { createArtifactTool } from "./artifact-tool";

const mockCtx: ToolContext = {
  runContext: {
    runId: "run-1",
    agentName: "test-agent",
    turnNumber: 1,
    traceId: "trace-1",
    usage: { inputTokens: 0, outputTokens: 0, totalCostUsd: 0, latencyMs: 0 },
    metadata: {},
  },
  toolCallId: "tc-1",
  agentName: "test-agent",
};

describe("ArtifactStore", () => {
  it("upserts a new artifact", () => {
    const store = new ArtifactStore();
    const part: UIArtifactPart = {
      type: "ui_artifact",
      artifactId: "art-1",
      version: 1,
      title: "Test",
      kind: "html",
      content: "<div>Hello</div>",
    };

    const artifact = store.upsert(part, "agent-1", "run-1");
    expect(artifact.id).toBe("art-1");
    expect(artifact.title).toBe("Test");
    expect(artifact.version).toBe(1);
    expect(artifact.agentName).toBe("agent-1");
    expect(artifact.runId).toBe("run-1");
  });

  it("bumps version on re-upsert", () => {
    const store = new ArtifactStore();
    const part: UIArtifactPart = {
      type: "ui_artifact",
      artifactId: "art-1",
      version: 1,
      title: "Test",
      kind: "html",
      content: "<div>v1</div>",
    };

    store.upsert(part, "agent-1", "run-1");
    const v2 = store.upsert({ ...part, content: "<div>v2</div>" }, "agent-1", "run-1");
    expect(v2.version).toBe(2);
    expect(v2.content).toBe("<div>v2</div>");
  });

  it("gets artifact by id", () => {
    const store = new ArtifactStore();
    store.upsert(
      {
        type: "ui_artifact",
        artifactId: "art-1",
        version: 1,
        title: "Test",
        kind: "html",
        content: "<div>Hello</div>",
      },
      "agent-1",
      "run-1",
    );

    expect(store.get("art-1")).toBeTruthy();
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("gets artifacts by run", () => {
    const store = new ArtifactStore();
    store.upsert(
      {
        type: "ui_artifact",
        artifactId: "art-1",
        version: 1,
        title: "A1",
        kind: "html",
        content: "<div>A1</div>",
      },
      "agent-1",
      "run-1",
    );
    store.upsert(
      {
        type: "ui_artifact",
        artifactId: "art-2",
        version: 1,
        title: "A2",
        kind: "code",
        content: "console.log()",
      },
      "agent-1",
      "run-1",
    );
    store.upsert(
      {
        type: "ui_artifact",
        artifactId: "art-3",
        version: 1,
        title: "A3",
        kind: "svg",
        content: "<svg></svg>",
      },
      "agent-2",
      "run-2",
    );

    expect(store.getByRun("run-1")).toHaveLength(2);
    expect(store.getByRun("run-2")).toHaveLength(1);
    expect(store.getByRun("run-3")).toHaveLength(0);
  });

  it("clears all artifacts", () => {
    const store = new ArtifactStore();
    store.upsert(
      {
        type: "ui_artifact",
        artifactId: "art-1",
        version: 1,
        title: "Test",
        kind: "html",
        content: "<div>Hello</div>",
      },
      "agent-1",
      "run-1",
    );

    expect(store.size).toBe(1);
    store.clear();
    expect(store.size).toBe(0);
  });

  it("preserves createdAt on re-upsert", () => {
    const store = new ArtifactStore();
    const part: UIArtifactPart = {
      type: "ui_artifact",
      artifactId: "art-1",
      version: 1,
      title: "Test",
      kind: "html",
      content: "<div>Hello</div>",
    };

    const first = store.upsert(part, "agent-1", "run-1");
    const createdAt = first.createdAt;

    const second = store.upsert({ ...part, content: "updated" }, "agent-1", "run-1");
    expect(second.createdAt).toBe(createdAt);
    expect(second.updatedAt).toBeGreaterThanOrEqual(createdAt);
  });
});

describe("createArtifactTool", () => {
  it("creates a tool definition", () => {
    const tool = createArtifactTool();
    expect(tool.name).toBe("create_artifact");
    expect(tool.description).toBeTruthy();
    expect(tool.inputSchema).toBeTruthy();
  });

  it("executes and returns artifact info", async () => {
    const tool = createArtifactTool();
    const result = await tool.execute(
      {
        title: "My Page",
        kind: "html",
        content: "<h1>Hello</h1>",
      } as never,
      mockCtx,
    );

    const output = result as { artifactId: string; version: number; title: string; kind: string };
    expect(output.artifactId).toContain("artifact-");
    expect(output.version).toBe(1);
    expect(output.title).toBe("My Page");
    expect(output.kind).toBe("html");
  });

  it("persists to store when provided", async () => {
    const store = new ArtifactStore();
    const tool = createArtifactTool(store);

    await tool.execute(
      {
        title: "Chart",
        kind: "svg",
        content: "<svg></svg>",
      } as never,
      mockCtx,
    );

    expect(store.size).toBe(1);
    const artifacts = store.getByRun("run-1");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.title).toBe("Chart");
  });

  it("works without store", async () => {
    const tool = createArtifactTool();
    const result = await tool.execute(
      {
        title: "Code",
        kind: "code",
        content: "console.log('hello')",
        language: "javascript",
      } as never,
      mockCtx,
    );

    expect((result as { artifactId: string }).artifactId).toBeTruthy();
  });
});
