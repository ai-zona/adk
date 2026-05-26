import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand } from "./init";

describe("initCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adk-init-test-"));
    // Suppress console output during tests
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  it("scaffolds a basic template with package.json and agent file", async () => {
    await initCommand({ template: "basic", dir: tmpDir });

    const packageJsonPath = path.join(tmpDir, "package.json");
    expect(fs.existsSync(packageJsonPath)).toBe(true);

    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    expect(pkg.name).toBe("my-adk-project");
    expect(pkg.dependencies["@aizonaai/adk"]).toBeDefined();

    const agentPath = path.join(tmpDir, "agents", "my-agent.ts");
    expect(fs.existsSync(agentPath)).toBe(true);
    const agentContent = fs.readFileSync(agentPath, "utf-8");
    expect(agentContent).toContain("defineAgent");
  });

  it("scaffolds a multi-agent template with coordinator, researcher, and writer", async () => {
    await initCommand({ template: "multi-agent", dir: tmpDir });

    expect(fs.existsSync(path.join(tmpDir, "agents", "coordinator.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "agents", "researcher.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "agents", "writer.ts"))).toBe(true);

    const coordinatorContent = fs.readFileSync(
      path.join(tmpDir, "agents", "coordinator.ts"),
      "utf-8",
    );
    expect(coordinatorContent).toContain("handoffs");
  });

  it("scaffolds an mcp template with mcp-agent file", async () => {
    await initCommand({ template: "mcp", dir: tmpDir });

    const mcpAgentPath = path.join(tmpDir, "agents", "mcp-agent.ts");
    expect(fs.existsSync(mcpAgentPath)).toBe(true);
    const content = fs.readFileSync(mcpAgentPath, "utf-8");
    expect(content).toContain("mcpServerTools");
  });

  it("defaults to basic template when no template is specified", async () => {
    await initCommand({ dir: tmpDir });

    expect(fs.existsSync(path.join(tmpDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "agents", "my-agent.ts"))).toBe(true);
  });

  it("creates nested directories as needed", async () => {
    const nestedDir = path.join(tmpDir, "deep", "nested", "project");
    await initCommand({ template: "basic", dir: nestedDir });

    expect(fs.existsSync(path.join(nestedDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(nestedDir, "agents", "my-agent.ts"))).toBe(true);
    expect(fs.existsSync(path.join(nestedDir, "tsconfig.json"))).toBe(true);
  });
});
