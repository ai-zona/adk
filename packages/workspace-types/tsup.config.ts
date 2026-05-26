import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "manifest/types": "src/manifest/types.ts",
    "manifest/zod": "src/manifest/zod.ts",
    "events/ws": "src/events/ws.ts",
    "events/zod": "src/events/zod.ts",
    "events/hydrator": "src/events/hydrator.ts",
    "rpc/workspace-architect": "src/rpc/workspace-architect.ts",
    "rpc/workspace-channel": "src/rpc/workspace-channel.ts",
    "rpc/workspace-entitlement": "src/rpc/workspace-entitlement.ts",
    "capabilities/identifiers": "src/capabilities/identifiers.ts",
    "ipc/protocol": "src/ipc/protocol.ts",
    "test-runner/types": "src/test-runner/types.ts",
    "marketplace/promote": "src/marketplace/promote.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  outDir: "dist",
  clean: true,
  external: ["@aizona/db", "zod"],
  skipNodeModulesBundle: true,
});
