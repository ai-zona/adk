import { describe, expect, it, vi } from "vitest";
import { defineAgent } from "../../agent/define-agent";
import { Runner } from "../../runner/runner";
import type { ADKLLMProvider, ChatResponseWithToolCalls } from "../../types/llm";
import {
  MCPServerConnector,
  discoverMCPTools,
  mcpSelectTools,
  mcpServerTools,
} from "./mcp-tool-adapter";
import type { MCPToolInfo } from "./mcp-tool-adapter";

/** Generate N mock MCP tools */
function generateMockTools(count: number): MCPToolInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `mcp_tool_${i}`,
    description: `MCP tool ${i} for ${i % 5 === 0 ? "files" : i % 5 === 1 ? "database" : i % 5 === 2 ? "network" : i % 5 === 3 ? "auth" : "analytics"}`,
    inputSchema: { type: "object", properties: { input: { type: "string" } } },
    category:
      i % 5 === 0
        ? "files"
        : i % 5 === 1
          ? "database"
          : i % 5 === 2
            ? "network"
            : i % 5 === 3
              ? "auth"
              : "analytics",
    tags: [`tag-${i % 3}`],
  }));
}

function createMockProvider(responses: Array<Partial<ChatResponseWithToolCalls>>): ADKLLMProvider {
  let callIndex = 0;
  return {
    providerId: "mock",
    displayName: "Mock",
    isLocal: true,
    chat: vi.fn(),
    complete: vi.fn(),
    isAvailable: () => true,
    getModels: () => ["mock-model"],
    estimateCost: () => 0,
    chatWithTools: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1]!;
      callIndex++;
      return {
        content: response.content ?? "",
        model: "mock-model",
        providerId: "mock",
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        latencyMs: 100,
        costUsd: 0.001,
        finishReason: response.finishReason ?? "stop",
        toolCalls: response.toolCalls,
      };
    }),
    async *chatStream() {
      yield { type: "text_delta" as const, content: "Hello" };
      yield { type: "message_end" as const, usage: { inputTokens: 10, outputTokens: 5 } };
    },
  };
}

describe("MCP Integration", () => {
  it("discovers 50 tools from mock MCP server", async () => {
    const mockTools = generateMockTools(50);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const tools = await discoverMCPTools({
      serverUrl: "http://localhost:3002",
      transport: "sse",
    });

    expect(tools).toHaveLength(50);
    expect(tools[0]?.category).toBe("files");
    expect(tools[0]?.tags).toEqual(["tag-0"]);

    vi.unstubAllGlobals();
  });

  it("selects 5 specific tools from 50", async () => {
    const mockTools = generateMockTools(50);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const selected = await mcpSelectTools(
      { serverUrl: "http://localhost:3002", transport: "sse" },
      ["mcp_tool_0", "mcp_tool_10", "mcp_tool_20", "mcp_tool_30", "mcp_tool_40"],
    );

    expect(selected).toHaveLength(5);
    expect(selected.map((t) => t.name)).toEqual([
      "mcp_tool_0",
      "mcp_tool_10",
      "mcp_tool_20",
      "mcp_tool_30",
      "mcp_tool_40",
    ]);
    // All should be full ToolDefs with execute functions
    expect(typeof selected[0]?.execute).toBe("function");

    vi.unstubAllGlobals();
  });

  it("filters by category via mcpServerTools config", async () => {
    const mockTools = generateMockTools(50);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const fileTools = await mcpServerTools({
      serverUrl: "http://localhost:3002",
      transport: "sse",
      categories: ["files"],
    });

    // Every 5th tool is "files" category: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45 = 10 tools
    expect(fileTools).toHaveLength(10);
    expect(fileTools.every((t) => t.name.match(/mcp_tool_(0|5|10|15|20|25|30|35|40|45)/))).toBe(
      true,
    );

    vi.unstubAllGlobals();
  });

  it("caps tools with maxTools", async () => {
    const mockTools = generateMockTools(50);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const capped = await mcpServerTools({
      serverUrl: "http://localhost:3002",
      transport: "sse",
      maxTools: 5,
    });

    expect(capped).toHaveLength(5);

    vi.unstubAllGlobals();
  });

  it("creates agent with selected MCP tools + tool selection → per-turn filtering", async () => {
    const mockTools = generateMockTools(50);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    // Select 10 tools from 50
    const selectedTools = await mcpSelectTools(
      { serverUrl: "http://localhost:3002", transport: "sse" },
      Array.from({ length: 10 }, (_, i) => `mcp_tool_${i * 5}`),
    );

    expect(selectedTools).toHaveLength(10);

    // Create agent with these tools and dynamic selection
    const agent = defineAgent({
      name: "mcp-agent",
      instructions: "Use MCP tools to help users.",
      tools: selectedTools,
      toolSelection: { strategy: "keyword", maxToolsPerTurn: 4 },
    });

    // Mock LLM response
    const provider = createMockProvider([{ content: "MCP tools processed!" }]);
    const runner = new Runner({ provider });
    const result = await runner.run(agent, { input: "Search files in database" });

    expect(result.output).toBe("MCP tools processed!");

    // Verify per-turn filtering applied
    const call = (provider.chatWithTools as any).mock.calls[0][0];
    expect(call.tools.length).toBeLessThanOrEqual(4);

    vi.unstubAllGlobals();
  });

  it("connector selectTools + discoverMetadata work together", async () => {
    const mockTools = generateMockTools(20);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "sse",
    });

    // Step 1: Discover metadata
    const metadata = await connector.discoverMetadata();
    expect(metadata).toHaveLength(20);

    // Step 2: User picks 3 tools from metadata
    const pickedNames = metadata.slice(0, 3).map((t) => t.name);

    // Step 3: Create ToolDefs for picked tools
    const toolDefs = connector.selectTools(metadata, pickedNames);
    expect(toolDefs).toHaveLength(3);
    expect(typeof toolDefs[0]?.execute).toBe("function");

    vi.unstubAllGlobals();
  });
});
