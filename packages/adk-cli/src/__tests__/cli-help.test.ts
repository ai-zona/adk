import { describe, expect, it } from "vitest";
import { createCLI } from "../cli";

describe("CLI help and metadata", () => {
  it("reports the version", () => {
    const program = createCLI();
    expect(program.version()).toBe("0.1.0");
  });

  it("reports the program name and description", () => {
    const program = createCLI();
    expect(program.name()).toBe("aizona");
    expect(program.description()).toContain("AIZona");
  });

  it("emits help text covering every top-level command", () => {
    const program = createCLI();
    const help = program.helpInformation();

    for (const cmd of [
      "init",
      "agent-init",
      "agent",
      "dev",
      "keys",
      "skill",
      "validate",
      "login",
      "usage",
    ]) {
      expect(help).toContain(cmd);
    }
  });

  it("provides a description for each top-level command", () => {
    const program = createCLI();
    for (const cmd of program.commands) {
      expect(cmd.description().length).toBeGreaterThan(0);
    }
  });

  it("agent subcommand exposes help for create/test/deploy/list", () => {
    const program = createCLI();
    const agent = program.commands.find((c) => c.name() === "agent");
    expect(agent).toBeTruthy();
    const help = agent!.helpInformation();
    for (const sub of ["create", "test", "deploy", "list"]) {
      expect(help).toContain(sub);
    }
  });

  it("keys subcommand exposes help for create/list/revoke", () => {
    const program = createCLI();
    const keys = program.commands.find((c) => c.name() === "keys");
    expect(keys).toBeTruthy();
    const help = keys!.helpInformation();
    for (const sub of ["create", "list", "revoke"]) {
      expect(help).toContain(sub);
    }
  });

  it("skill subcommand exposes help for publish/install/search", () => {
    const program = createCLI();
    const skill = program.commands.find((c) => c.name() === "skill");
    expect(skill).toBeTruthy();
    const help = skill!.helpInformation();
    for (const sub of ["publish", "install", "search"]) {
      expect(help).toContain(sub);
    }
  });

  it("init command advertises template and dir options", () => {
    const program = createCLI();
    const init = program.commands.find((c) => c.name() === "init");
    expect(init).toBeTruthy();
    const help = init!.helpInformation();
    expect(help).toContain("--template");
    expect(help).toContain("--dir");
  });

  it("dev command advertises a port option", () => {
    const program = createCLI();
    const dev = program.commands.find((c) => c.name() === "dev");
    expect(dev).toBeTruthy();
    expect(dev!.helpInformation()).toContain("--port");
  });

  it("validate command advertises a strict option", () => {
    const program = createCLI();
    const validate = program.commands.find((c) => c.name() === "validate");
    expect(validate).toBeTruthy();
    expect(validate!.helpInformation()).toContain("--strict");
  });
});
