// ──────────────────────────────────────────────────────
// Tests for `aizona agent-init` / `npx @aizona/agent-init`
// ──────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentInitCommand,
  buildScaffoldFiles,
  generateAgentKeypair,
  sanitizeName,
  toSkillIdentifier,
} from "../commands/agent-init";

describe("sanitizeName", () => {
  it("lowercases and replaces invalid chars", () => {
    expect(sanitizeName("My Shiny Agent!")).toBe("my-shiny-agent-");
  });

  it("strips leading dots and underscores", () => {
    expect(sanitizeName(".__hidden")).toBe("hidden");
  });

  it("collapses consecutive dashes", () => {
    expect(sanitizeName("foo   bar")).toBe("foo-bar");
  });
});

describe("toSkillIdentifier", () => {
  it("converts spaces to dashes", () => {
    expect(toSkillIdentifier("Price Research")).toBe("Price-Research");
  });

  it("trims leading and trailing dashes", () => {
    expect(toSkillIdentifier("  hello world  ")).toBe("hello-world");
  });
});

describe("generateAgentKeypair", () => {
  it("returns a well-formed did:aza DID with 64 hex chars", () => {
    const { did, publicKeyHex, privateKeyHex } = generateAgentKeypair();
    expect(did).toMatch(/^did:aza:[0-9a-f]{64}$/);
    expect(publicKeyHex).toHaveLength(64);
    expect(privateKeyHex).toHaveLength(64);
    expect(did.endsWith(publicKeyHex)).toBe(true);
  });

  it("generates unique keys on each call", () => {
    const a = generateAgentKeypair();
    const b = generateAgentKeypair();
    expect(a.did).not.toBe(b.did);
    expect(a.privateKeyHex).not.toBe(b.privateKeyHex);
  });
});

describe("buildScaffoldFiles", () => {
  it("produces a parseable package.json and tsconfig.json", () => {
    const files = buildScaffoldFiles(
      {
        name: "test-agent",
        description: "Test agent",
        skillName: "greet",
        skillDescription: "Greet a user",
        pricePerCallAIZ: "0.10",
      },
      `did:aza:${"a".repeat(64)}`,
      "b".repeat(64),
    );

    const pkg = JSON.parse(files["package.json"]!);
    expect(pkg.name).toBe("test-agent");
    expect(pkg.dependencies["@aizona/adk"]).toBeDefined();
    expect(pkg.dependencies["@aizona/aza-client"]).toBeDefined();

    const tsconfig = JSON.parse(files["tsconfig.json"]!);
    expect(tsconfig.compilerOptions.strict).toBe(true);
  });

  it("embeds the DID and private key into .env.example", () => {
    const did = `did:aza:${"c".repeat(64)}`;
    const priv = "d".repeat(64);
    const files = buildScaffoldFiles(
      {
        name: "foo",
        description: "desc",
        skillName: "ping",
        skillDescription: "Ping",
        pricePerCallAIZ: "0.05",
      },
      did,
      priv,
    );
    expect(files[".env.example"]).toContain(`AIZONA_DID=${did}`);
    expect(files[".env.example"]).toContain(`AIZONA_PRIVATE_KEY=${priv}`);
    expect(files[".env.example"]).toContain("AIZONA_API_URL=https://aizona.ai");
  });

  it("references the skill file name consistently in src/index.ts", () => {
    const files = buildScaffoldFiles(
      {
        name: "foo",
        description: "desc",
        skillName: "price-research",
        skillDescription: "Do research",
        pricePerCallAIZ: "1.00",
      },
      `did:aza:${"e".repeat(64)}`,
      "f".repeat(64),
    );

    expect(files["src/skills/price-research.ts"]).toBeDefined();
    expect(files["src/index.ts"]).toContain('from "./skills/price-research.js"');
    // camelCased symbol name for the tool export
    expect(files["src/skills/price-research.ts"]).toContain("export const priceResearch");
  });
});

describe("agentInitCommand (non-interactive)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aizona-agent-init-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup — ignore Windows EPERM
    }
  });

  it("scaffolds a complete project tree with the expected files", async () => {
    const target = path.join(tmpDir, "my-agent");
    const result = await agentInitCommand(undefined, {
      dir: target,
      answers: {
        name: "my-agent",
        description: "My first A2A agent",
        skillName: "greet",
        skillDescription: "Greet the caller",
        pricePerCallAIZ: "0.10",
      },
    });

    expect(result.dir).toBe(target);
    expect(result.did).toMatch(/^did:aza:[0-9a-f]{64}$/);
    expect(result.generatedKey).toBe(true);

    for (const rel of [
      "package.json",
      "tsconfig.json",
      ".gitignore",
      ".env.example",
      "README.md",
      "src/index.ts",
      "src/skills/greet.ts",
    ]) {
      expect(fs.existsSync(path.join(target, rel))).toBe(true);
    }

    // package.json parses
    const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf-8"));
    expect(pkg.name).toBe("my-agent");

    // README mentions the generated DID
    const readme = fs.readFileSync(path.join(target, "README.md"), "utf-8");
    expect(readme).toContain(result.did);

    // .env.example contains a private key (64 hex chars)
    const env = fs.readFileSync(path.join(target, ".env.example"), "utf-8");
    expect(env).toMatch(/AIZONA_PRIVATE_KEY=[0-9a-f]{64}/);
  });

  it("reuses an existing DID and private key when provided", async () => {
    const existingDid = `did:aza:${"9".repeat(64)}`;
    const existingKey = "1".repeat(64);
    const target = path.join(tmpDir, "reuse");

    const result = await agentInitCommand(undefined, {
      dir: target,
      answers: {
        name: "reuse",
        description: "Reuse test",
        skillName: "echo",
        skillDescription: "Echo input",
        pricePerCallAIZ: "0.01",
        existingDid,
        existingPrivateKey: existingKey,
      },
    });

    expect(result.did).toBe(existingDid);
    expect(result.generatedKey).toBe(false);

    const env = fs.readFileSync(path.join(target, ".env.example"), "utf-8");
    expect(env).toContain(`AIZONA_DID=${existingDid}`);
    expect(env).toContain(`AIZONA_PRIVATE_KEY=${existingKey}`);
  });

  it("creates nested directories as needed", async () => {
    const nested = path.join(tmpDir, "a", "b", "c", "deep-agent");
    await agentInitCommand(undefined, {
      dir: nested,
      answers: {
        name: "deep-agent",
        description: "Deep",
        skillName: "deep",
        skillDescription: "Deep skill",
        pricePerCallAIZ: "0.50",
      },
    });
    expect(fs.existsSync(path.join(nested, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(nested, "src", "skills", "deep.ts"))).toBe(true);
  });
});
