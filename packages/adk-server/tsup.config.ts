import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    compilerOptions: {
      incremental: false,
    },
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  // Externalize all peer/runtime deps so consumers control them.
  external: ["@aizonaai/adk", "@aizona/db", "hono", "@hono/node-server", "zod"],
  target: "es2022",
  outDir: "dist",
});
