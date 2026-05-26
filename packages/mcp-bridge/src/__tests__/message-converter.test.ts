import { describe, expect, it } from "vitest";
import { MessageConverter } from "../bridge/message-converter";
import type { AZAToolCallMessage, MCPJsonRpcResponse } from "../bridge/message-converter";

describe("MessageConverter", () => {
  // ── toMCPRequest ─────────────────────────────────

  describe("toMCPRequest", () => {
    it("produces a valid JSON-RPC 2.0 request with correct method and params", () => {
      const azaMessage: AZAToolCallMessage = {
        type: "tool.call",
        payload: {
          toolName: "file_read",
          arguments: { path: "/tmp/data.txt" },
          correlationId: "corr-123",
        },
      };

      const result = MessageConverter.toMCPRequest(azaMessage, "req-001");

      expect(result.jsonrpc).toBe("2.0");
      expect(result.id).toBe("req-001");
      expect(result.method).toBe("tools/call");
      expect(result.params).toEqual({
        name: "file_read",
        arguments: { path: "/tmp/data.txt" },
      });
    });
  });

  // ── fromMCPResponse ──────────────────────────────

  describe("fromMCPResponse", () => {
    it("returns success: true with data for a successful result", () => {
      const mcpResponse: MCPJsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-001",
        result: {
          content: [{ type: "text", text: '{"files":["a.txt","b.txt"]}' }],
        },
      };

      const result = MessageConverter.fromMCPResponse(mcpResponse);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ files: ["a.txt", "b.txt"] });
      expect(result.error).toBeUndefined();
    });

    it("returns success: false with error for a JSON-RPC error response", () => {
      const mcpResponse: MCPJsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-002",
        error: {
          code: -32601,
          message: "Method not found",
        },
      };

      const result = MessageConverter.fromMCPResponse(mcpResponse);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("METHOD_NOT_FOUND");
      expect(result.error?.message).toBe("Method not found");
    });

    it("returns error when result has isError: true", () => {
      const mcpResponse: MCPJsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-003",
        result: {
          isError: true,
          content: [{ type: "text", text: "File not found" }],
        },
      };

      const result = MessageConverter.fromMCPResponse(mcpResponse);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("TOOL_ERROR");
      expect(result.error?.message).toBe("File not found");
    });

    it("extracts text content from MCP content array", () => {
      const mcpResponse: MCPJsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-004",
        result: {
          content: [
            { type: "text", text: "line one" },
            { type: "text", text: "line two" },
          ],
        },
      };

      const result = MessageConverter.fromMCPResponse(mcpResponse);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(["line one", "line two"]);
    });

    it("returns raw text when content has a single non-JSON text part", () => {
      const mcpResponse: MCPJsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-005",
        result: {
          content: [{ type: "text", text: "plain string result" }],
        },
      };

      const result = MessageConverter.fromMCPResponse(mcpResponse);

      expect(result.success).toBe(true);
      expect(result.data).toBe("plain string result");
    });

    it("prefers structuredContent over text content", () => {
      const mcpResponse: MCPJsonRpcResponse = {
        jsonrpc: "2.0",
        id: "req-006",
        result: {
          content: [{ type: "text", text: "should be overridden" }],
          structuredContent: { key: "structured-value" },
        },
      };

      const result = MessageConverter.fromMCPResponse(mcpResponse);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: "structured-value" });
    });
  });

  // ── mapMCPErrorCode ──────────────────────────────

  describe("mapMCPErrorCode", () => {
    it("maps -32700 to PARSE_ERROR", () => {
      expect(MessageConverter.mapMCPErrorCode(-32700)).toBe("PARSE_ERROR");
    });

    it("maps -32600 to INVALID_REQUEST", () => {
      expect(MessageConverter.mapMCPErrorCode(-32600)).toBe("INVALID_REQUEST");
    });

    it("maps -32601 to METHOD_NOT_FOUND", () => {
      expect(MessageConverter.mapMCPErrorCode(-32601)).toBe("METHOD_NOT_FOUND");
    });

    it("maps -32602 to INVALID_PARAMS", () => {
      expect(MessageConverter.mapMCPErrorCode(-32602)).toBe("INVALID_PARAMS");
    });

    it("maps -32603 to INTERNAL_ERROR", () => {
      expect(MessageConverter.mapMCPErrorCode(-32603)).toBe("INTERNAL_ERROR");
    });

    it("maps -32000 to SERVER_ERROR", () => {
      expect(MessageConverter.mapMCPErrorCode(-32000)).toBe("SERVER_ERROR");
    });

    it("maps -32001 to TOOL_NOT_FOUND", () => {
      expect(MessageConverter.mapMCPErrorCode(-32001)).toBe("TOOL_NOT_FOUND");
    });

    it("maps -32002 to TOOL_EXECUTION_ERROR", () => {
      expect(MessageConverter.mapMCPErrorCode(-32002)).toBe("TOOL_EXECUTION_ERROR");
    });

    it("maps -32003 to RESOURCE_NOT_FOUND", () => {
      expect(MessageConverter.mapMCPErrorCode(-32003)).toBe("RESOURCE_NOT_FOUND");
    });

    it("maps -32004 to PERMISSION_DENIED", () => {
      expect(MessageConverter.mapMCPErrorCode(-32004)).toBe("PERMISSION_DENIED");
    });

    it("maps -32005 to RATE_LIMITED", () => {
      expect(MessageConverter.mapMCPErrorCode(-32005)).toBe("RATE_LIMITED");
    });

    it("returns MCP_ERROR_<code> for unknown codes", () => {
      expect(MessageConverter.mapMCPErrorCode(-99999)).toBe("MCP_ERROR_-99999");
    });
  });

  // ── convertToolList ──────────────────────────────

  describe("convertToolList", () => {
    it("normalizes tool entries with name, description, and inputSchema", () => {
      const mcpTools = [
        {
          name: "file_read",
          description: "Reads a file from disk",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
          extraField: "ignored",
        },
        {
          name: "web_search",
          description: "Searches the web",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      ];

      const result = MessageConverter.convertToolList(mcpTools);

      expect(result).toHaveLength(2);

      expect(result[0]).toEqual({
        name: "file_read",
        description: "Reads a file from disk",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      });

      expect(result[1]).toEqual({
        name: "web_search",
        description: "Searches the web",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      });
    });

    it("provides defaults for missing fields", () => {
      const mcpTools = [{}];
      const result = MessageConverter.convertToolList(mcpTools);

      expect(result[0]).toEqual({
        name: "unknown",
        description: "",
        inputSchema: {},
      });
    });
  });
});
