import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "../commands/init";

describe("initCommand — file creation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adk-init-files-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("basic template creates package.json, tsconfig.json, and agent file", async () => {
    await initCommand({ template: "basic", dir: tmpDir });

    expect(fs.existsSync(path.join(tmpDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "agents", "my-agent.ts"))).toBe(true);
  });

  it("uses an explicit --name to rename the package", async () => {
    await initCommand({ template: "basic", dir: tmpDir, name: "Awesome Bot!" });
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("awesome-bot-");
  });

  it("preserves the template default name when no --name is provided", async () => {
    await initCommand({ template: "basic", dir: tmpDir });
    const pkg = JSON.parse(fs.readFileSync(path.join(tmpDir, "package.json"), "utf-8"));
    expect(pkg.name).toBe("my-adk-project");
  });

  it("rejects an unknown template", async () => {
    await expect(initCommand({ template: "does-not-exist", dir: tmpDir })).rejects.toThrow(
      /Unknown template/,
    );
  });

  it("tsconfig.json is valid JSON with strict mode enabled", async () => {
    await initCommand({ template: "basic", dir: tmpDir });
    const tsconfig = JSON.parse(fs.readFileSync(path.join(tmpDir, "tsconfig.json"), "utf-8"));
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("warns when the target directory is not empty", async () => {
    fs.writeFileSync(path.join(tmpDir, "existing.txt"), "hi");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await initCommand({ template: "basic", dir: tmpDir });
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0]?.[0] ?? "")).toMatch(/not empty/);
  });
});
