import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { createValidateCommand } from "../commands/validate";
import { initCommand } from "../commands/init";

async function runValidate(targetDir: string, ...extraArgs: string[]): Promise<{
  output: string;
  exitCode: number | undefined;
}> {
  const program = new Command();
  program.exitOverride();
  program.addCommand(createValidateCommand());

  const logs: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(" "));
  });

  const prevExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    await program.parseAsync(["node", "test", "validate", targetDir, ...extraArgs]);
  } finally {
    logSpy.mockRestore();
  }
  const exitCode = process.exitCode;
  process.exitCode = prevExitCode;
  return { output: logs.join("\n"), exitCode };
}

describe("validate command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adk-validate-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("passes for a freshly scaffolded basic project", async () => {
    await initCommand({ template: "basic", dir: tmpDir });
    const { output, exitCode } = await runValidate(tmpDir);

    expect(output).toContain("Agent Validation Report");
    expect(output).toContain("agent source file");
    expect(output).toContain("@aizonaai/adk");
    expect(exitCode).toBe(0);
  });

  it("fails when no agent config or source files are present", async () => {
    const { output, exitCode } = await runValidate(tmpDir);

    expect(output).toContain("No agent config found");
    expect(output).toContain("No package.json");
    expect(exitCode).toBe(1);
  });

  it("fails when package.json exists but is missing @aizonaai/adk", async () => {
    fs.mkdirSync(path.join(tmpDir, "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "agents", "noop.ts"),
      "export const noop = () => undefined;\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "broken", version: "0.0.0", dependencies: {} }, null, 2),
    );

    const { output, exitCode } = await runValidate(tmpDir);

    expect(output).toContain("@aizonaai/adk not found");
    expect(exitCode).toBe(1);
  });

  it("fails when package.json is unparseable", async () => {
    fs.mkdirSync(path.join(tmpDir, "agents"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "agents", "x.ts"), "// noop\n");
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{ not json");

    const { output, exitCode } = await runValidate(tmpDir);

    expect(output).toContain("Failed to parse package.json");
    expect(exitCode).toBe(1);
  });

  it("warns about a stray .env file under --strict", async () => {
    await initCommand({ template: "basic", dir: tmpDir });
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=shhh\n");

    const lenient = await runValidate(tmpDir);
    expect(lenient.output).toContain(".env file found");
    expect(lenient.exitCode).toBe(0);

    const strict = await runValidate(tmpDir, "--strict");
    expect(strict.output).toContain(".env file found");
    expect(strict.exitCode).toBe(1);
  });
});
