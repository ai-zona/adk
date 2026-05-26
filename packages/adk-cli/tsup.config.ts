import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    bin: "src/bin.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    entry: { index: "src/index.ts" },
    compilerOptions: {
      incremental: false,
    },
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  // Externalize peer/runtime deps so install size stays small and consumers dedupe.
  external: ["@aizonaai/adk", "@aizonaai/adk-server", "commander"],
  target: "es2022",
  outDir: "dist",
  // `bin.ts` starts with `#!/usr/bin/env node`. tsup auto-preserves the shebang
  // for entries it detects, but we make it explicit via `banner` for the bin chunk.
});
