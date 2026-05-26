import { beforeEach, describe, expect, it } from "vitest";
import type { ToolDef } from "../types/tool";
import { createToolSearchTool } from "./built-in/tool-search";
import { ToolRegistry } from "./tool-registry";

function makeTool(name: string, description: string, opts?: Partial<ToolDef>): ToolDef {
  return {
    name,
    description,
    inputSchema: { type: "object", properties: {} },
    execute: async () => `result from ${name}`,
    ...opts,
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it("register and get a tool", () => {
    const tool = makeTool("read_file", "Read a file from disk");
    registry.register(tool);
    expect(registry.get("read_file")).toBe(tool);
    expect(registry.has("read_file")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("registerAll adds multiple tools", () => {
    const tools = [makeTool("tool_a", "Tool A"), makeTool("tool_b", "Tool B")];
    registry.registerAll(tools);
    expect(registry.getAllNames()).toEqual(["tool_a", "tool_b"]);
  });

  describe("search", () => {
    beforeEach(() => {
      registry.registerAll([
        makeTool("read_file", "Read a file from the filesystem"),
        makeTool("write_file", "Write content to a file"),
        makeTool("search_code", "Search codebase for patterns"),
        makeTool("run_command", "Execute a shell command"),
        makeTool("query_database", "Run SQL query against a database"),
      ]);
    });

    it("returns relevant tools for file queries", () => {
      const results = registry.search("file");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.name).toMatch(/file/);
    });

    it("returns relevant tools for database queries", () => {
      const results = registry.search("database query");
      expect(results.some((r) => r.name === "query_database")).toBe(true);
    });

    it("respects limit parameter", () => {
      const results = registry.search("file", 1);
      expect(results.length).toBe(1);
    });

    it("returns empty for no match", () => {
      const results = registry.search("xyznonexistent");
      expect(results).toEqual([]);
    });

    it("ranks by relevance", () => {
      const results = registry.search("read file");
      expect(results[0]?.name).toBe("read_file");
    });
  });

  describe("deferred loading", () => {
    it("getEager excludes deferred tools", () => {
      registry.register(makeTool("eager_tool", "Always available"));
      registry.register(makeTool("deferred_tool", "Load on demand", { deferLoading: true }));
      const eager = registry.getEager();
      expect(eager.length).toBe(1);
      expect(eager[0]?.name).toBe("eager_tool");
    });

    it("getAvailable includes only eager + loaded deferred", () => {
      registry.register(makeTool("eager_tool", "Always available"));
      registry.register(makeTool("deferred_a", "Deferred A", { deferLoading: true }));
      registry.register(makeTool("deferred_b", "Deferred B", { deferLoading: true }));

      expect(registry.getAvailable().length).toBe(1);

      registry.load("deferred_a");
      expect(registry.getAvailable().length).toBe(2);
      expect(registry.isLoaded("deferred_a")).toBe(true);
      expect(registry.isLoaded("deferred_b")).toBe(false);
    });

    it("load returns the tool definition", () => {
      const tool = makeTool("deferred_tool", "Load me", { deferLoading: true });
      registry.register(tool);
      const loaded = registry.load("deferred_tool");
      expect(loaded).toBe(tool);
    });

    it("load returns undefined for nonexistent tool", () => {
      expect(registry.load("nonexistent")).toBeUndefined();
    });
  });

  describe("clear", () => {
    it("removes all tools and loaded state", () => {
      registry.register(makeTool("tool", "A tool"));
      registry.register(makeTool("deferred", "Deferred", { deferLoading: true }));
      registry.load("deferred");
      registry.clear();
      expect(registry.getAllNames()).toEqual([]);
      expect(registry.isLoaded("deferred")).toBe(false);
    });
  });
});

describe("createToolSearchTool", () => {
  it("searches registry and auto-loads deferred tools", async () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("read_file", "Read a file", { deferLoading: true }));
    registry.register(makeTool("write_file", "Write a file", { deferLoading: true }));

    const searchTool = createToolSearchTool(registry);
    const ctx = { runContext: {} as any, toolCallId: "tc1", agentName: "test" };
    const result = await searchTool.execute({ query: "read file" }, ctx);

    expect(result.tools.length).toBeGreaterThan(0);
    expect(result.tools[0]?.name).toBe("read_file");
    // Should be auto-loaded now
    expect(registry.isLoaded("read_file")).toBe(true);
  });
});
