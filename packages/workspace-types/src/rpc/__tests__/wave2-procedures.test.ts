import { describe, expect, it } from "vitest";
import { workspaceArchitectProcedures } from "../workspace-architect";
const expectedNew = [
  "revertToSnapshot",
  "listSnapshots",
  "importAgent",
  "importWorkspace",
  "exportAgent",
  "exportWorkspace",
  "duplicateAgent",
  "duplicateWorkspace",
  "testAgent",
  "testWorkspace",
  "testTool",
  "createTool",
  "promoteAgent",
  "listVoiceProviders",
  "getVoiceConfig",
  "setVoiceConfig",
];
describe("Wave 2 procedures", () => {
  for (const name of expectedNew) {
    it(`declares ${name} with input+output schemas`, () => {
      const proc = (workspaceArchitectProcedures as Record<string, unknown>)[name];
      expect(proc).toBeDefined();
      expect((proc as { input: unknown }).input).toBeDefined();
      expect((proc as { output: unknown }).output).toBeDefined();
    });
  }
});
