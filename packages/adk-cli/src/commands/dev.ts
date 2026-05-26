// ──────────────────────────────────────────────────────
// aizona dev — Local development server
// ──────────────────────────────────────────────────────
//
// `@aizona/adk-server` is lazy-loaded so the CLI works for every other command
// (init / agent / keys / test / validate / login / skill-install / skill-publish)
// even when adk-server is not installed. When a user runs `aizona dev` without
// adk-server installed, we print an actionable error pointing at the install cmd.

export interface DevOptions {
  port?: string;
}

export async function devCommand(options: DevOptions): Promise<void> {
  const port = Number(options?.port ?? "3456");

  console.log("Starting ADK development server...\n");

  let startStandaloneServer: typeof import("@aizona/adk-server").startStandaloneServer;
  try {
    ({ startStandaloneServer } = await import("@aizona/adk-server"));
  } catch (err) {
    console.error(
      [
        "Error: `@aizona/adk-server` is not installed.",
        "",
        "The `aizona dev` command runs a local REST API server that requires the",
        "@aizona/adk-server package. Install it alongside the CLI:",
        "",
        "  npm i -D @aizona/adk-server",
        "  # or",
        "  pnpm add -D @aizona/adk-server",
        "",
        "Then re-run `aizona dev`.",
      ].join("\n"),
    );
    if (process.env.AIZONA_CLI_DEBUG === "1") {
      console.error("\nUnderlying error:", err);
    }
    process.exit(1);
  }

  const handle = startStandaloneServer({ port });

  console.log("\nPress Ctrl+C to stop.");

  // Graceful shutdown
  process.on("SIGINT", () => {
    handle.close();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    handle.close();
    process.exit(0);
  });

  // Keep process alive
  await new Promise(() => {});
}
