// ──────────────────────────────────────────────────────
// AZA <-> MCP Message Conversion
// ──────────────────────────────────────────────────────
//
// Converts between AZA Protocol tool call messages and MCP
// JSON-RPC 2.0 request/response format. This module is
// stateless and uses only static methods.

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

/**
 * An AZA Protocol tool call message as emitted by agents.
 */
export interface AZAToolCallMessage {
  type: "tool.call";
  payload: {
    toolName: string;
    arguments: Record<string, unknown>;
    correlationId: string;
  };
}

/**
 * MCP JSON-RPC 2.0 request envelope.
 */
export interface MCPJsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * MCP JSON-RPC 2.0 response envelope.
 */
export interface MCPJsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Normalized tool descriptor in AZA format.
 */
export interface AZAToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ──────────────────────────────────────────────────────
// MCP Error Code Mapping
// ──────────────────────────────────────────────────────

/**
 * Standard JSON-RPC 2.0 error codes and MCP-specific extensions.
 */
const MCP_ERROR_MAP: Record<number, string> = {
  // Standard JSON-RPC errors
  [-32700]: "PARSE_ERROR",
  [-32600]: "INVALID_REQUEST",
  [-32601]: "METHOD_NOT_FOUND",
  [-32602]: "INVALID_PARAMS",
  [-32603]: "INTERNAL_ERROR",

  // MCP-specific errors
  [-32000]: "SERVER_ERROR",
  [-32001]: "TOOL_NOT_FOUND",
  [-32002]: "TOOL_EXECUTION_ERROR",
  [-32003]: "RESOURCE_NOT_FOUND",
  [-32004]: "PERMISSION_DENIED",
  [-32005]: "RATE_LIMITED",
};

// ──────────────────────────────────────────────────────
// MessageConverter
// ──────────────────────────────────────────────────────

/**
 * Converts messages between AZA Protocol format and MCP JSON-RPC 2.0.
 *
 * All methods are static since the converter carries no state.
 */
export class MessageConverter {
  /**
   * Converts an AZA tool call message into an MCP JSON-RPC request.
   *
   * The MCP method is set to `tools/call` (the standard MCP tool
   * invocation method) with the tool name and arguments packed
   * into the `params` object.
   *
   * @param azaMessage - The AZA tool call message
   * @param requestId  - A unique request ID for the JSON-RPC envelope
   * @returns A well-formed MCP JSON-RPC 2.0 request
   */
  static toMCPRequest(azaMessage: AZAToolCallMessage, requestId: string): MCPJsonRpcRequest {
    return {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        name: azaMessage.payload.toolName,
        arguments: azaMessage.payload.arguments,
      },
    };
  }

  /**
   * Converts an MCP JSON-RPC response into a normalized AZA result.
   *
   * @param mcpResponse - The MCP JSON-RPC 2.0 response
   * @returns A normalized result with success flag, data, and/or error
   */
  static fromMCPResponse(mcpResponse: MCPJsonRpcResponse): {
    success: boolean;
    data?: unknown;
    error?: { code: string; message: string };
  } {
    if (mcpResponse.error) {
      return {
        success: false,
        error: {
          code: MessageConverter.mapMCPErrorCode(mcpResponse.error.code),
          message: mcpResponse.error.message,
        },
      };
    }

    // Check for MCP-level error in the result content
    const result = mcpResponse.result as Record<string, unknown> | undefined;
    if (result && result.isError === true) {
      // Extract error text from content array
      let errorMessage = "Tool returned an error";
      if (Array.isArray(result.content)) {
        const textParts = (result.content as Array<Record<string, unknown>>)
          .filter((c) => c.type === "text")
          .map((c) => c.text as string);
        if (textParts.length > 0) {
          errorMessage = textParts.join("\n");
        }
      }

      return {
        success: false,
        error: {
          code: "TOOL_ERROR",
          message: errorMessage,
        },
      };
    }

    // Extract data from successful response
    let data: unknown = result;

    // If the result follows MCP content format, extract text parts
    if (result && Array.isArray(result.content)) {
      const textParts = (result.content as Array<Record<string, unknown>>)
        .filter((c) => c.type === "text")
        .map((c) => c.text as string);

      if (textParts.length === 1) {
        // Try to parse as JSON, fall back to raw string
        try {
          data = JSON.parse(textParts[0]!);
        } catch {
          data = textParts[0];
        }
      } else if (textParts.length > 1) {
        data = textParts;
      }
    }

    // Prefer structured content if available
    if (result && result.structuredContent !== undefined) {
      data = result.structuredContent;
    }

    return { success: true, data };
  }

  /**
   * Maps an MCP/JSON-RPC numeric error code to an AZA string error code.
   *
   * @param code - The numeric error code from JSON-RPC
   * @returns A human-readable AZA error code string
   */
  static mapMCPErrorCode(code: number): string {
    return MCP_ERROR_MAP[code] ?? `MCP_ERROR_${code}`;
  }

  /**
   * Converts a list of MCP tool descriptors into AZA format.
   *
   * MCP tool lists come from the `tools/list` response and may include
   * extra fields. This normalizes each entry to the minimal AZA
   * descriptor format.
   *
   * @param mcpTools - Raw tool entries from an MCP `tools/list` response
   * @returns An array of normalized AZA tool descriptors
   */
  static convertToolList(mcpTools: unknown[]): AZAToolDescriptor[] {
    return mcpTools.map((tool) => {
      const t = tool as Record<string, unknown>;

      return {
        name: (t.name as string) ?? "unknown",
        description: (t.description as string) ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      };
    });
  }
}
