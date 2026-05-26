import { describe, expect, it, vi } from "vitest";
import { createCLI } from "./cli";
import { getAvailableTemplates, getTemplate } from "./templates/index";

describe("createCLI", () => {
  it("creates a Commander program", () => {
    const program = createCLI();
    expect(program.name()).toBe("aizona");
    expect(program.version()).toBe("0.1.0");
  });

  it("has init command", () => {
    const program = createCLI();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("init");
  });

  it("has agent command with subcommands", () => {
    const program = createCLI();
    const agentCmd = program.commands.find((c) => c.name() === "agent");
    expect(agentCmd).toBeTruthy();
    const subcommands = agentCmd?.commands.map((c) => c.name());
    expect(subcommands).toContain("create");
    expect(subcommands).toContain("deploy");
    expect(subcommands).toContain("test");
    expect(subcommands).toContain("list");
  });

  it("has dev command", () => {
    const program = createCLI();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("dev");
  });

  it("has keys command with subcommands", () => {
    const program = createCLI();
    const keysCmd = program.commands.find((c) => c.name() === "keys");
    expect(keysCmd).toBeTruthy();
    const subcommands = keysCmd?.commands.map((c) => c.name());
    expect(subcommands).toContain("create");
    expect(subcommands).toContain("list");
    expect(subcommands).toContain("revoke");
  });

  it("has login command", () => {
    const program = createCLI();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("login");
  });

  it("has usage command", () => {
    const program = createCLI();
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("usage");
  });
});

describe("Templates", () => {
  it("returns basic template", () => {
    const files = getTemplate("basic");
    expect(files["package.json"]).toBeTruthy();
    expect(files["agents/my-agent.ts"]).toBeTruthy();
    expect(files["tsconfig.json"]).toBeTruthy();
  });

  it("returns multi-agent template", () => {
    const files = getTemplate("multi-agent");
    expect(files["agents/coordinator.ts"]).toBeTruthy();
    expect(files["agents/researcher.ts"]).toBeTruthy();
    expect(files["agents/writer.ts"]).toBeTruthy();
  });

  it("returns mcp template", () => {
    const files = getTemplate("mcp");
    expect(files["agents/mcp-agent.ts"]).toBeTruthy();
  });

  it("lists available templates", () => {
    const templates = getAvailableTemplates();
    expect(templates).toContain("basic");
    expect(templates).toContain("multi-agent");
    expect(templates).toContain("mcp");
  });

  it("falls back to basic for unknown template", () => {
    const files = getTemplate("unknown" as any);
    expect(files["package.json"]).toBeTruthy();
  });

  it("basic template package.json is valid JSON", () => {
    const files = getTemplate("basic");
    const parsed = JSON.parse(files["package.json"]!);
    expect(parsed.name).toBe("my-adk-project");
    expect(parsed.dependencies["@aizona/adk"]).toBeTruthy();
  });
});
