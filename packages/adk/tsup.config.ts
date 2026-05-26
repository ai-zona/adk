import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    // tsup's dts worker calls tsc; the workspace base tsconfig sets `incremental: true`,
    // which tsc rejects unless `--tsBuildInfoFile` is specified for single-file emit.
    // Override here so dts emission works without polluting the workspace base config.
    dts: {
      compilerOptions: {
        incremental: false,
      },
    },
    sourcemap: true,
    clean: true,
    splitting: false,
    // zod is the only runtime dep — let consumers dedupe it.
    external: ["zod"],
    target: "es2022",
    outDir: "dist",
  },
  {
    entry: { "bin/adk-cli": "bin/adk-cli.ts" },
    format: ["esm"],
    sourcemap: false,
    clean: false,
    splitting: false,
    external: ["zod"],
    target: "node18",
    outDir: "dist",
  },
]);
