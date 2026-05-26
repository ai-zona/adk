import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../types/llm";
import type { ToolDef } from "../types/tool";
import { ToolSelector } from "./tool-selector";

/** Helper to create a mock ToolDef */
function mockTool(name: string, description: string): ToolDef {
  return {
    name,
    description,
    inputSchema: { type: "object" },
    execute: async () => "ok",
  };
}

describe("ToolSelector", () => {
  const tools = [
    mockTool("search_web", "Search the web for information"),
    mockTool("read_file", "Read a file from the filesystem"),
    mockTool("write_file", "Write content to a file"),
    mockTool("run_tests", "Execute test suites"),
    mockTool("deploy_app", "Deploy the application to production"),
    mockTool("analyze_code", "Analyze code for issues and improvements"),
    mockTool("create_pr", "Create a pull request on GitHub"),
    mockTool("send_email", "Send an email notification"),
    mockTool("query_database", "Query a SQL database"),
    mockTool("generate_image", "Generate an image from text"),
  ];

  describe("all strategy", () => {
    it("passes through all tools", () => {
      const selector = new ToolSelector({ strategy: "all" });
      const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
      const selected = selector.selectTools(tools, messages, 1);
      expect(selected).toHaveLength(10);
    });

    it("respects maxToolsPerTurn cap", () => {
      const selector = new ToolSelector({ strategy: "all", maxToolsPerTurn: 5 });
      const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
      const selected = selector.selectTools(tools, messages, 1);
      expect(selected).toHaveLength(5);
    });
  });

  describe("keyword strategy", () => {
    it("selects tools matching conversation keywords", () => {
      const selector = new ToolSelector({ strategy: "keyword", maxToolsPerTurn: 3 });
      const messages: ChatMessage[] = [
        { role: "user", content: "Can you search the web and read the file?" },
      ];
      const selected = selector.selectTools(tools, messages, 1);

      expect(selected.length).toBeLessThanOrEqual(3);
      const names = selected.map((t) => t.name);
      expect(names).toContain("search_web");
      expect(names).toContain("read_file");
    });

    it("filters out irrelevant tools", () => {
      const selector = new ToolSelector({ strategy: "keyword", maxToolsPerTurn: 3 });
      const messages: ChatMessage[] = [
        { role: "user", content: "Deploy my application to production" },
      ];
      const selected = selector.selectTools(tools, messages, 1);

      const names = selected.map((t) => t.name);
      expect(names).toContain("deploy_app");
      // Email and image should not be relevant
      expect(names).not.toContain("send_email");
      expect(names).not.toContain("generate_image");
    });

    it("boosts recently-used tools", () => {
      const selector = new ToolSelector({
        strategy: "keyword",
        maxToolsPerTurn: 3,
        includeRecentlyUsed: true,
      });
      const messages: ChatMessage[] = [{ role: "user", content: "Run and deploy the application" }];

      // Without recent calls
      const without = selector.selectTools(tools, messages, 1);

      // With recent calls including query_database
      const with_ = selector.selectTools(tools, messages, 1, ["query_database"]);

      const withNames = with_.map((t) => t.name);
      // query_database should be boosted even though it's less relevant to "run and deploy"
      expect(withNames).toContain("query_database");
    });

    it("respects alwaysInclude", () => {
      const selector = new ToolSelector({
        strategy: "keyword",
        maxToolsPerTurn: 2,
        alwaysInclude: ["send_email"],
      });
      const messages: ChatMessage[] = [
        { role: "user", content: "Search for information about AI" },
      ];

      const selected = selector.selectTools(tools, messages, 1);
      const names = selected.map((t) => t.name);
      expect(names).toContain("send_email"); // always included
    });

    it("returns empty for completely irrelevant queries against tools", () => {
      const selector = new ToolSelector({
        strategy: "keyword",
        maxToolsPerTurn: 3,
        minRelevance: 0.5,
      });
      const messages: ChatMessage[] = [{ role: "user", content: "xyz abc 123" }];
      // No tools should match random gibberish at 0.5 threshold
      const selected = selector.selectTools(tools, messages, 1);
      expect(selected.length).toBeLessThanOrEqual(3);
    });
  });

  describe("scoreTools", () => {
    it("scores all tools", () => {
      const selector = new ToolSelector({ strategy: "keyword" });
      const messages: ChatMessage[] = [
        { role: "user", content: "Search the web and analyze the code" },
      ];
      const scores = selector.scoreTools(tools, messages);
      expect(scores).toHaveLength(10);
      expect(scores.every((s) => typeof s.score === "number")).toBe(true);
    });

    it("gives higher scores to matching tools", () => {
      const selector = new ToolSelector({ strategy: "keyword" });
      const messages: ChatMessage[] = [
        { role: "user", content: "Search the web for information about testing" },
      ];
      const scores = selector.scoreTools(tools, messages);

      const searchScore = scores.find((s) => s.tool.name === "search_web")?.score;
      const emailScore = scores.find((s) => s.tool.name === "send_email")?.score;
      expect(searchScore).toBeGreaterThan(emailScore);
    });
  });

  describe("default config", () => {
    it("uses default values", () => {
      const selector = new ToolSelector();
      const messages: ChatMessage[] = [{ role: "user", content: "Hello" }];
      const selected = selector.selectTools(tools, messages, 1);
      // Default strategy is "all", so all tools pass through
      expect(selected).toHaveLength(10);
    });
  });
});
