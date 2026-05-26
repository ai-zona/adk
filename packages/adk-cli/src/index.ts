// ──────────────────────────────────────────────────────
// @aizonaai/adk-cli — AIZona Agent Development Kit CLI
// ──────────────────────────────────────────────────────

export { createCLI } from "./cli";
export { initCommand } from "./commands/init";
export {
  agentInitCommand,
  buildScaffoldFiles,
  generateAgentKeypair,
  sanitizeName,
  toSkillIdentifier,
} from "./commands/agent-init";
export type {
  AgentInitAnswers,
  AgentInitOptions,
  AgentInitResult,
  ScaffoldFiles,
} from "./commands/agent-init";
export { agentCreateCommand } from "./commands/agent-create";
export { agentDeployCommand } from "./commands/agent-deploy";
export { agentTestCommand } from "./commands/agent-test";
export { devCommand } from "./commands/dev";
export { keysCommand } from "./commands/keys";
export { loginCommand } from "./commands/login";
