// ──────────────────────────────────────────────────────
// aizona agent-init — Scaffold a fresh A2A agent project
// Invoked as: `aizona agent-init <name>` or `npx @aizona/agent-init <name>`
// ──────────────────────────────────────────────────────

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export interface AgentInitAnswers {
  /** Agent name — used for directory + package.json name + DID subject. */
  name: string;
  description: string;
  skillName: string;
  skillDescription: string;
  /** Price in AIZ per skill invocation (decimal string). */
  pricePerCallAIZ: string;
  /** Existing DID (if the user already minted one) or undefined to generate. */
  existingDid?: string;
  /** Hex-encoded Ed25519 private key (64 hex chars) if user supplied one. */
  existingPrivateKey?: string;
}

export interface AgentInitOptions {
  /** Target directory (defaults to `./${name}`). */
  dir?: string;
  /** If true, skip prompts and use these answers verbatim. */
  answers?: AgentInitAnswers;
}

export interface AgentInitResult {
  dir: string;
  did: string;
  /** Whether the DID/keypair was freshly generated. */
  generatedKey: boolean;
}

// ──────────────────────────────────────────────────────
// Ed25519 keypair generation
//
// Mirrors the WebCrypto path used by
// apps/web/app/(marketing)/marketplace/list-agent/keygen.ts.
// We use node:crypto here because the CLI runs on Node, but the
// key format (32-byte raw seed + 32-byte raw public key, hex-encoded)
// is byte-compatible with the browser wizard.
// ──────────────────────────────────────────────────────

interface GeneratedKey {
  did: string;
  publicKeyHex: string;
  privateKeyHex: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function generateAgentKeypair(): GeneratedKey {
  // generateKeyPairSync returns KeyObject with JWK export containing raw seed.
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");

  // Export as JWK to get raw 32-byte seed (d) + public (x) — base64url encoded.
  const privJwk = privateKey.export({ format: "jwk" }) as { d?: string; x?: string };
  const pubJwk = publicKey.export({ format: "jwk" }) as { x?: string };

  if (!privJwk.d || !pubJwk.x) {
    throw new Error("Unable to export Ed25519 keypair: missing raw components");
  }

  const seed = Buffer.from(privJwk.d, "base64url");
  const pub = Buffer.from(pubJwk.x, "base64url");

  const publicKeyHex = bytesToHex(pub);
  const privateKeyHex = bytesToHex(seed);
  // DID format: did:aza:<hex public key> — matches aza-protocol canonical form.
  const did = `did:aza:${publicKeyHex}`;

  return { did, publicKeyHex, privateKeyHex };
}

// ──────────────────────────────────────────────────────
// Input validation / sanitization
// ──────────────────────────────────────────────────────

const DID_REGEX = /^did:aza:[0-9a-f]{64}$/i;
const HEX_KEY_REGEX = /^[0-9a-f]{64}$/i;

export function sanitizeName(raw: string): string {
  // npm-compatible lowercase slug, no leading dot/underscore.
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/^[-_.]+/, "")
    .replace(/-{2,}/g, "-");
}

export function toSkillIdentifier(raw: string): string {
  return raw
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function toCamelCase(raw: string): string {
  const parts = toSkillIdentifier(raw).split("-").filter(Boolean);
  if (parts.length === 0) return "run";
  const [first, ...rest] = parts as [string, ...string[]];
  return (
    first.toLowerCase() +
    rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join("")
  );
}

// ──────────────────────────────────────────────────────
// Interactive prompting
// ──────────────────────────────────────────────────────

async function promptAnswers(defaultName: string | undefined): Promise<AgentInitAnswers> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const name =
      (await rl
        .question(`Agent name${defaultName ? ` (${defaultName})` : ""}: `)
        .then((s) => s.trim())) ||
      defaultName ||
      "my-aza-agent";

    const description =
      (await rl.question("Short description: ").then((s) => s.trim())) || "An AIZona A2A agent.";

    const didAnswer = (
      await rl.question("Paste an existing DID (or leave blank to generate a fresh one): ")
    ).trim();

    let existingDid: string | undefined;
    let existingPrivateKey: string | undefined;

    if (didAnswer) {
      if (!DID_REGEX.test(didAnswer)) {
        throw new Error(`Invalid DID: "${didAnswer}". Expected form did:aza:<64 hex chars>.`);
      }
      existingDid = didAnswer;
      const keyAnswer = (
        await rl.question("Paste the matching Ed25519 private key (64 hex chars): ")
      ).trim();
      if (!HEX_KEY_REGEX.test(keyAnswer)) {
        throw new Error("Invalid private key: must be exactly 64 hex characters (32 bytes).");
      }
      existingPrivateKey = keyAnswer;
    }

    const skillName =
      (await rl.question("First skill name (e.g. greet): ").then((s) => s.trim())) || "greet";
    const skillDescription =
      (await rl.question("Skill description: ").then((s) => s.trim())) || "Respond to a greeting.";
    const pricePerCallAIZ =
      (await rl.question("Price per call in AIZ (e.g. 0.10): ").then((s) => s.trim())) || "0.10";

    return {
      name: sanitizeName(name),
      description,
      skillName: toSkillIdentifier(skillName),
      skillDescription,
      pricePerCallAIZ,
      existingDid,
      existingPrivateKey,
    };
  } finally {
    rl.close();
  }
}

// ──────────────────────────────────────────────────────
// File content builders
// ──────────────────────────────────────────────────────

export interface ScaffoldFiles {
  [relativePath: string]: string;
}

export function buildScaffoldFiles(
  answers: AgentInitAnswers,
  did: string,
  privateKeyHex: string,
): ScaffoldFiles {
  const skillCamel = toCamelCase(answers.skillName);
  const skillFile = `src/skills/${answers.skillName}.ts`;

  const pkgJson = {
    name: answers.name,
    version: "0.1.0",
    type: "module",
    description: answers.description,
    scripts: {
      dev: "tsx src/index.ts",
      build: "tsc",
      test: 'echo "Add tests with your preferred runner"',
    },
    dependencies: {
      "@aizonaai/adk": "latest",
      "@aizonaai/aza-client": "latest",
      zod: "^3.24.1",
    },
    devDependencies: {
      "@types/node": "^20.0.0",
      tsx: "^4.19.2",
      typescript: "^5.7.3",
    },
  };

  const indexTs = `// ──────────────────────────────────────────────────────
// ${answers.name} — AIZona A2A agent
// Generated by @aizona/agent-init
// ──────────────────────────────────────────────────────

import { defineAgent } from "@aizonaai/adk";
import { ${skillCamel} } from "./skills/${answers.skillName}.js";

export const agent = defineAgent({
  name: "${answers.name}",
  instructions: \`${answers.description.replace(/`/g, "\\`")}\`,
  tools: [${skillCamel}],
});

// Simple local entrypoint — replace with your preferred runtime wiring.
// See https://docs.aizona.ai/mcp for hosting your agent as an MCP server
// and https://aizona.ai/marketplace/list-agent to publish.
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  console.log(\`\${agent.name} ready. DID: \${process.env.AIZONA_DID ?? "(unset)"}\`);
  console.log("Next: run \`pnpm dev\` and register your agent via /marketplace/list-agent.");
}
`;

  const skillTs = `// ──────────────────────────────────────────────────────
// Skill: ${answers.skillName}
// ${answers.skillDescription}
// Price: ${answers.pricePerCallAIZ} AIZ per call
// ──────────────────────────────────────────────────────

import { defineTool } from "@aizonaai/adk";
import { z } from "zod";

export const ${skillCamel} = defineTool({
  name: "${answers.skillName}",
  description: ${JSON.stringify(answers.skillDescription)},
  inputSchema: z.object({
    // TODO: describe your skill's inputs here.
    input: z.string().describe("The input payload"),
  }),
  execute: async (input) => {
    // TODO: replace this stub with your real skill logic.
    return {
      skill: "${answers.skillName}",
      echo: input.input,
      priceAIZ: "${answers.pricePerCallAIZ}",
    };
  },
});
`;

  const envExample = `# AIZona A2A agent credentials.
# Copy to .env and keep private. Never commit the real key.

# Your agent's decentralized identifier (DID).
AIZONA_DID=${did}

# Ed25519 private key (32-byte seed, hex). Keep this secret.
AIZONA_PRIVATE_KEY=${privateKeyHex}

# API root for MCP + AZA task ingress.
AIZONA_API_URL=https://aizona.ai
`;

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: "./dist",
      rootDir: "./src",
    },
    include: ["src/**/*.ts"],
  };

  const gitignore = `node_modules/
dist/
.env
.env.local
.DS_Store
`;

  const readme = `# ${answers.name}

${answers.description}

## Run it locally

\`\`\`bash
pnpm install
cp .env.example .env   # then edit .env if needed
pnpm dev
\`\`\`

## Publish it

1. Visit <https://aizona.ai/marketplace/list-agent> and paste your DID:
   \`\`\`
   ${did}
   \`\`\`
2. Declare your skill \`${answers.skillName}\` with price \`${answers.pricePerCallAIZ} AIZ\` per call.
3. The wizard will verify you control the DID via a signed challenge and register your agent
   on-chain (Arbitrum Sepolia).

## What's here

| Path | What it does |
|------|--------------|
| \`src/index.ts\` | Agent definition using \`@aizonaai/adk\`. |
| \`${skillFile}\` | Stub implementation for your first skill. |
| \`.env.example\` | DID + private key + API URL placeholders. |

## Learn more

- MCP landing page: <https://aizona.ai/mcp>
- Tutorial: *Your first paid agent* — \`docs/tutorials/01-your-first-paid-agent.md\`
- Full MCP reference: <https://docs.aizona.ai/mcp>
`;

  return {
    "package.json": `${JSON.stringify(pkgJson, null, 2)}\n`,
    "tsconfig.json": `${JSON.stringify(tsconfig, null, 2)}\n`,
    ".gitignore": gitignore,
    ".env.example": envExample,
    "README.md": readme,
    "src/index.ts": indexTs,
    [skillFile]: skillTs,
  };
}

// ──────────────────────────────────────────────────────
// Main scaffolder
// ──────────────────────────────────────────────────────

export async function agentInitCommand(
  nameArg: string | undefined,
  options: AgentInitOptions = {},
): Promise<AgentInitResult> {
  const answers = options.answers ?? (await promptAnswers(nameArg));

  // Decide DID + private key
  let did: string;
  let privateKeyHex: string;
  let generatedKey = false;

  if (answers.existingDid && answers.existingPrivateKey) {
    did = answers.existingDid;
    privateKeyHex = answers.existingPrivateKey;
  } else {
    const kp = generateAgentKeypair();
    did = kp.did;
    privateKeyHex = kp.privateKeyHex;
    generatedKey = true;
  }

  const targetDir = path.resolve(options.dir ?? path.join(process.cwd(), answers.name));

  const files = buildScaffoldFiles(answers, did, privateKeyHex);

  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(targetDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf-8");
  }

  console.log("");
  console.log(`  Scaffolded ${answers.name} at ${targetDir}`);
  if (generatedKey) {
    console.log("  Generated a fresh Ed25519 keypair — see .env.example for the private key.");
    console.log("  Store it somewhere safe. You cannot recover it from the DID alone.");
  }
  console.log("");
  console.log("  Next steps:");
  console.log(`    cd ${path.relative(process.cwd(), targetDir) || "."}`);
  console.log("    pnpm install");
  console.log("    pnpm dev");
  console.log("");
  console.log(
    "  Then visit https://aizona.ai/marketplace/list-agent to publish your agent and start earning AIZ.",
  );

  return { dir: targetDir, did, generatedKey };
}
