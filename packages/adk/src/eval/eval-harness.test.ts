import { describe, expect, it } from "vitest";
import { defineEvalSuite, runEval } from "./eval-harness";
import type { EvalSuite } from "./eval-harness";

describe("defineEvalSuite", () => {
  it("returns a valid suite", () => {
    const suite = defineEvalSuite({
      name: "Basic",
      cases: [{ name: "ping", input: "ping" }],
    });
    expect(suite.name).toBe("Basic");
    expect(suite.cases).toHaveLength(1);
  });

  it("throws when name is empty", () => {
    expect(() => defineEvalSuite({ name: "", cases: [{ name: "a", input: "x" }] })).toThrow(
      "Eval suite must have a name",
    );
  });

  it("throws when cases is empty", () => {
    expect(() => defineEvalSuite({ name: "Empty", cases: [] })).toThrow(
      "Eval suite must have at least one case",
    );
  });

  it("preserves optional description", () => {
    const suite = defineEvalSuite({
      name: "Described",
      description: "A test suite",
      cases: [{ name: "c1", input: "i1" }],
    });
    expect(suite.description).toBe("A test suite");
  });
});

describe("runEval", () => {
  const echoExecutor = async (input: string) => input;
  const upperExecutor = async (input: string) => input.toUpperCase();

  it("passes with exact match (trimmed)", async () => {
    const suite: EvalSuite = {
      name: "Exact",
      cases: [{ name: "echo", input: "hello", expectedOutput: "hello" }],
    };
    const results = await runEval(suite, echoExecutor);
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
    expect(results[0]?.caseName).toBe("echo");
    expect(results[0]?.actualOutput).toBe("hello");
    expect(results[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("fails with exact mismatch", async () => {
    const suite: EvalSuite = {
      name: "Mismatch",
      cases: [{ name: "case1", input: "hello", expectedOutput: "HELLO" }],
    };
    const results = await runEval(suite, echoExecutor);
    expect(results[0]?.passed).toBe(false);
  });

  it("passes with regex pattern match", async () => {
    const suite: EvalSuite = {
      name: "Regex",
      cases: [
        {
          name: "upper-check",
          input: "hello",
          expectedOutputPattern: /^HELLO$/,
        },
      ],
    };
    const results = await runEval(suite, upperExecutor);
    expect(results[0]?.passed).toBe(true);
  });

  it("fails with regex mismatch", async () => {
    const suite: EvalSuite = {
      name: "Regex Fail",
      cases: [
        {
          name: "lower-check",
          input: "hello",
          expectedOutputPattern: /^hello$/,
        },
      ],
    };
    const results = await runEval(suite, upperExecutor);
    expect(results[0]?.passed).toBe(false);
  });

  it("passes with custom validator", async () => {
    const suite: EvalSuite = {
      name: "Validator",
      cases: [
        {
          name: "length-check",
          input: "abc",
          validator: (output) => output.length === 3,
        },
      ],
    };
    const results = await runEval(suite, echoExecutor);
    expect(results[0]?.passed).toBe(true);
  });

  it("handles executor errors gracefully", async () => {
    const failingExecutor = async () => {
      throw new Error("Provider down");
    };
    const suite: EvalSuite = {
      name: "Error",
      cases: [{ name: "boom", input: "anything" }],
    };
    const results = await runEval(suite, failingExecutor);
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.error).toBe("Provider down");
    expect(results[0]?.actualOutput).toBe("");
  });

  it("runs multiple cases sequentially", async () => {
    const order: number[] = [];
    const trackedExecutor = async (input: string) => {
      order.push(Number(input));
      return input;
    };
    const suite: EvalSuite = {
      name: "Multi",
      cases: [
        { name: "c1", input: "1", expectedOutput: "1" },
        { name: "c2", input: "2", expectedOutput: "2" },
        { name: "c3", input: "3", expectedOutput: "3" },
      ],
    };
    const results = await runEval(suite, trackedExecutor);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.passed)).toBe(true);
    expect(order).toEqual([1, 2, 3]);
  });

  it("preserves expectedOutput in result", async () => {
    const suite: EvalSuite = {
      name: "Preserve",
      cases: [{ name: "p1", input: "x", expectedOutput: "x" }],
    };
    const results = await runEval(suite, echoExecutor);
    expect(results[0]?.expectedOutput).toBe("x");
  });

  it("defaults to pass when no assertion is specified", async () => {
    const suite: EvalSuite = {
      name: "NoAssert",
      cases: [{ name: "open", input: "anything" }],
    };
    const results = await runEval(suite, echoExecutor);
    expect(results[0]?.passed).toBe(true);
  });

  it("preserves tags in cases (smoke)", () => {
    const suite = defineEvalSuite({
      name: "Tagged",
      cases: [{ name: "t1", input: "x", tags: ["fast", "unit"] }],
    });
    expect(suite.cases[0]?.tags).toEqual(["fast", "unit"]);
  });
});
