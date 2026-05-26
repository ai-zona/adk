import { describe, expect, it, vi } from "vitest";
import {
  MCPServerConnector,
  discoverMCPTools,
  mcpSelectTools,
  mcpServerTools,
} from "./mcp-tool-adapter";
import type { MCPToolInfo } from "./mcp-tool-adapter";

// ── MCPServerConnector ──

describe("MCPServerConnector", () => {
  it("creates connector with config", () => {
    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "streamable-http",
    });
    expect(connector).toBeTruthy();
  });

  it("converts MCP tool to ADK ToolDef", () => {
    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "sse",
    });

    const mcpTool: MCPToolInfo = {
      name: "search_files",
      description: "Search for files in the workspace",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
    };

    const toolDef = connector.toToolDef(mcpTool);
    expect(toolDef.name).toBe("search_files");
    expect(toolDef.description).toBe("Search for files in the workspace");
    expect(toolDef.inputSchema).toEqual(mcpTool.inputSchema);
    expect(toolDef.metadata?.source).toBe("mcp");
    expect(toolDef.metadata?.transport).toBe("sse");
  });

  it("throws on stdio transport discover", async () => {
    const connector = new MCPServerConnector({
      serverUrl: "my-mcp-server",
      transport: "stdio",
    });

    await expect(connector.discover()).rejects.toThrow("Stdio transport requires");
  });

  it("throws on stdio transport invoke", async () => {
    const connector = new MCPServerConnector({
      serverUrl: "my-mcp-server",
      transport: "stdio",
    });

    await expect(connector.invokeTool("test", {})).rejects.toThrow("Stdio transport requires");
  });

  it("discovers tools via HTTP with mock fetch", async () => {
    const mockTools: MCPToolInfo[] = [
      { name: "tool_a", description: "Tool A", inputSchema: { type: "object" } },
      { name: "tool_b", description: "Tool B", inputSchema: { type: "object" } },
    ];

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { tools: mockTools } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "streamable-http",
    });

    const tools = await connector.discover();
    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe("tool_a");

    vi.unstubAllGlobals();
  });

  it("applies tool filter during discovery", async () => {
    const mockTools: MCPToolInfo[] = [
      { name: "allowed_tool", description: "Allowed", inputSchema: { type: "object" } },
      { name: "blocked_tool", description: "Blocked", inputSchema: { type: "object" } },
    ];

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
      toolFilter: (tool) => tool.name.startsWith("allowed"),
    });

    const tools = await connector.discover();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("allowed_tool");

    vi.unstubAllGlobals();
  });

  it("invokes tool via HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: { content: [{ type: "text", text: "Search results: found 3 files" }] },
        }),
      }),
    );

    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "streamable-http",
    });

    const result = await connector.invokeTool("search", { query: "test" });
    expect(result).toBe("Search results: found 3 files");

    vi.unstubAllGlobals();
  });

  it("handles MCP tool error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          error: { message: "Tool not found" },
        }),
      }),
    );

    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "sse",
    });

    await expect(connector.invokeTool("missing", {})).rejects.toThrow("Tool not found");

    vi.unstubAllGlobals();
  });

  it("handles HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "sse",
    });

    await expect(connector.discover()).rejects.toThrow("500");

    vi.unstubAllGlobals();
  });

  it("includes bearer auth headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { tools: [] } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "sse",
      authConfig: { type: "bearer", token: "my-secret-token" },
    });

    await connector.discover();

    const fetchCall = mockFetch.mock.calls[0]!;
    expect(fetchCall[1].headers.Authorization).toBe("Bearer my-secret-token");

    vi.unstubAllGlobals();
  });

  it("includes API key auth headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { tools: [] } }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "sse",
      authConfig: { type: "api-key", apiKey: "key-123", headerName: "X-Custom-Key" },
    });

    await connector.discover();

    const fetchCall = mockFetch.mock.calls[0]!;
    expect(fetchCall[1].headers["X-Custom-Key"]).toBe("key-123");

    vi.unstubAllGlobals();
  });

  it("selectTools returns ToolDefs for named subset", () => {
    const connector = new MCPServerConnector({
      serverUrl: "http://localhost:3002",
      transport: "sse",
    });

    const discovered: MCPToolInfo[] = [
      { name: "tool_a", description: "A", inputSchema: { type: "object" } },
      { name: "tool_b", description: "B", inputSchema: { type: "object" } },
      { name: "tool_c", description: "C", inputSchema: { type: "object" } },
    ];

    const selected = connector.selectTools(discovered, ["tool_a", "tool_c"]);
    expect(selected).toHaveLength(2);
    expect(selected[0]?.name).toBe("tool_a");
    expect(selected[1]?.name).toBe("tool_c");
  });

  it("discoverMetadata returns tool info", async () => {
    const mockTools: MCPToolInfo[] = [
      { name: "t1", description: "T1", inputSchema: { type: "object" }, category: "files" },
    ];
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
    const metadata = await connector.discoverMetadata();
    expect(metadata).toHaveLength(1);
    expect(metadata[0]?.name).toBe("t1");

    vi.unstubAllGlobals();
  });
});

// ── mcpServerTools (integration) ──

describe("mcpServerTools", () => {
  it("returns ToolDef array from MCP server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            tools: [
              {
                name: "read_file",
                description: "Read a file",
                inputSchema: { type: "object", properties: { path: { type: "string" } } },
              },
            ],
          },
        }),
      }),
    );

    const tools = await mcpServerTools({
      serverUrl: "http://localhost:3002",
      transport: "streamable-http",
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("read_file");
    expect(typeof tools[0]?.execute).toBe("function");

    vi.unstubAllGlobals();
  });

  it("filters by toolNames in config", async () => {
    const mockTools: MCPToolInfo[] = [
      { name: "tool_a", description: "A", inputSchema: { type: "object" } },
      { name: "tool_b", description: "B", inputSchema: { type: "object" } },
      { name: "tool_c", description: "C", inputSchema: { type: "object" } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const tools = await mcpServerTools({
      serverUrl: "http://localhost:3002",
      transport: "sse",
      toolNames: ["tool_a", "tool_c"],
    });

    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe("tool_a");
    expect(tools[1]?.name).toBe("tool_c");

    vi.unstubAllGlobals();
  });

  it("caps results with maxTools", async () => {
    const mockTools: MCPToolInfo[] = [
      { name: "t1", description: "T1", inputSchema: { type: "object" } },
      { name: "t2", description: "T2", inputSchema: { type: "object" } },
      { name: "t3", description: "T3", inputSchema: { type: "object" } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const tools = await mcpServerTools({
      serverUrl: "http://localhost:3002",
      transport: "sse",
      maxTools: 2,
    });

    expect(tools).toHaveLength(2);

    vi.unstubAllGlobals();
  });

  it("filters by categories", async () => {
    const mockTools: MCPToolInfo[] = [
      { name: "read", description: "Read", inputSchema: { type: "object" }, category: "files" },
      { name: "search", description: "Search", inputSchema: { type: "object" }, category: "web" },
      { name: "write", description: "Write", inputSchema: { type: "object" }, category: "files" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const tools = await mcpServerTools({
      serverUrl: "http://localhost:3002",
      transport: "sse",
      categories: ["files"],
    });

    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["read", "write"]);

    vi.unstubAllGlobals();
  });
});

// ── discoverMCPTools ──

describe("discoverMCPTools", () => {
  it("returns metadata without creating ToolDefs", async () => {
    const mockTools: MCPToolInfo[] = [
      {
        name: "tool_a",
        description: "A",
        inputSchema: { type: "object" },
        category: "cat1",
        tags: ["t1"],
      },
      { name: "tool_b", description: "B", inputSchema: { type: "object" } },
    ];
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

    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe("tool_a");
    expect(tools[0]?.category).toBe("cat1");
    // These are raw MCPToolInfo, not ToolDef (no execute function)
    expect((tools[0] as any).execute).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

// ── mcpSelectTools ──

describe("mcpSelectTools", () => {
  it("loads only named tools", async () => {
    const mockTools: MCPToolInfo[] = [
      { name: "tool_a", description: "A", inputSchema: { type: "object" } },
      { name: "tool_b", description: "B", inputSchema: { type: "object" } },
      { name: "tool_c", description: "C", inputSchema: { type: "object" } },
      { name: "tool_d", description: "D", inputSchema: { type: "object" } },
      { name: "tool_e", description: "E", inputSchema: { type: "object" } },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: { tools: mockTools } }),
      }),
    );

    const tools = await mcpSelectTools({ serverUrl: "http://localhost:3002", transport: "sse" }, [
      "tool_b",
      "tool_d",
    ]);

    expect(tools).toHaveLength(2);
    expect(tools[0]?.name).toBe("tool_b");
    expect(tools[1]?.name).toBe("tool_d");
    expect(typeof tools[0]?.execute).toBe("function");

    vi.unstubAllGlobals();
  });
});
