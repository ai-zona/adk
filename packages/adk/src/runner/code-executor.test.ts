import { describe, expect, it } from "vitest";
import type { ToolDef } from "../types/tool";
import { CodeExecutor } from "./code-executor";

function makeTool(name: string, fn: (input: any) => Promise<unknown>): ToolDef {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    execute: fn as any,
  };
}

const stubCtx = { runContext: {} as any, toolCallId: "tc1", agentName: "test" };

describe("CodeExecutor", () => {
  it("executes simple code and returns result", async () => {
    const executor = new CodeExecutor();
    const result = await executor.execute("return 1 + 2", [], stubCtx);
    expect(result.success).toBe(true);
    expect(result.result).toBe(3);
  });

  it("calls tools via bindings", async () => {
    const executor = new CodeExecutor();
    const addTool = makeTool("add", async (input: { a: number; b: number }) => input.a + input.b);
    const result = await executor.execute(
      "const sum = await tools.add({ a: 3, b: 4 }); return sum;",
      [addTool],
      stubCtx,
    );
    expect(result.success).toBe(true);
    expect(result.result).toBe(7);
    expect(result.toolCallsPerformed).toEqual(["add"]);
  });

  it("calls multiple tools in parallel", async () => {
    const executor = new CodeExecutor();
    const callOrder: string[] = [];
    const toolA = makeTool("tool_a", async () => {
      callOrder.push("a");
      return "A";
    });
    const toolB = makeTool("tool_b", async () => {
      callOrder.push("b");
      return "B";
    });

    const result = await executor.execute(
      "const [a, b] = await Promise.all([tools.tool_a({}), tools.tool_b({})]); return { a, b };",
      [toolA, toolB],
      stubCtx,
    );
    expect(result.success).toBe(true);
    expect((result.result as any).a).toBe("A");
    expect((result.result as any).b).toBe("B");
    expect(result.toolCallsPerformed.sort()).toEqual(["tool_a", "tool_b"]);
  });

  it("handles code errors gracefully", async () => {
    const executor = new CodeExecutor();
    const result = await executor.execute("throw new Error('oops')", [], stubCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("oops");
  });

  it("blocks access to dangerous APIs", async () => {
    const executor = new CodeExecutor();

    // process should be undefined
    const r1 = await executor.execute("return typeof process", [], stubCtx);
    expect(r1.success).toBe(true);
    expect(r1.result).toBe("undefined");

    // require should be undefined
    const r2 = await executor.execute("return typeof require", [], stubCtx);
    expect(r2.success).toBe(true);
    expect(r2.result).toBe("undefined");
  });

  it("respects timeout", async () => {
    const executor = new CodeExecutor({ timeoutMs: 100 });
    const result = await executor.execute("while(true) {}", [], stubCtx);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
