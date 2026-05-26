// ──────────────────────────────────────────────────────
// ADK Eval Harness — lightweight agent evaluation framework
// ──────────────────────────────────────────────────────
// Provides a simple but extensible evaluation harness for testing
// agent outputs against expected results. Supports exact match,
// regex pattern matching, and custom validators.
// ──────────────────────────────────────────────────────

/** A single evaluation test case. */
export interface EvalCase {
  /** Human-readable name for this case. */
  name: string;
  /** Input to send to the agent/executor. */
  input: string;
  /** If set, output must exactly match this string (after trim). */
  expectedOutput?: string;
  /** If set, output must match this regex pattern. */
  expectedOutputPattern?: RegExp;
  /** If set, this function determines pass/fail. */
  validator?: (output: string) => boolean;
  /** Optional agent config overrides for this case. */
  agentConfig?: Record<string, unknown>;
  /** Optional tags for filtering/grouping. */
  tags?: string[];
}

/** Result of running a single eval case. */
export interface EvalResult {
  /** Name of the eval case. */
  caseName: string;
  /** Whether the case passed. */
  passed: boolean;
  /** Actual output from the executor. */
  actualOutput: string;
  /** Expected output (if specified). */
  expectedOutput?: string;
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** Error message if the executor threw. */
  error?: string;
}

/** A suite of eval cases. */
export interface EvalSuite {
  /** Suite name. */
  name: string;
  /** Optional description. */
  description?: string;
  /** The eval cases to run. */
  cases: EvalCase[];
}

/**
 * Define an eval suite with validation.
 * Throws if the suite has no name or no cases.
 */
export function defineEvalSuite(config: EvalSuite): EvalSuite {
  if (!config.name) throw new Error("Eval suite must have a name");
  if (!config.cases.length) throw new Error("Eval suite must have at least one case");
  return config;
}

/**
 * Run an eval suite against an executor function.
 * The executor receives an input string and should return the agent's output.
 * Cases are run sequentially to avoid overwhelming LLM providers.
 */
export async function runEval(
  suite: EvalSuite,
  executor: (input: string) => Promise<string>,
): Promise<EvalResult[]> {
  const results: EvalResult[] = [];

  for (const testCase of suite.cases) {
    const start = Date.now();
    try {
      const output = await executor(testCase.input);
      let passed = true;

      if (testCase.expectedOutput !== undefined) {
        passed = output.trim() === testCase.expectedOutput.trim();
      } else if (testCase.expectedOutputPattern) {
        passed = testCase.expectedOutputPattern.test(output);
      } else if (testCase.validator) {
        passed = testCase.validator(output);
      }

      results.push({
        caseName: testCase.name,
        passed,
        actualOutput: output,
        expectedOutput: testCase.expectedOutput,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      results.push({
        caseName: testCase.name,
        passed: false,
        actualOutput: "",
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
