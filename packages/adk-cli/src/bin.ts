#!/usr/bin/env node
// ──────────────────────────────────────────────────────
// CLI Entry Point — invoked via `aizona` command
// ──────────────────────────────────────────────────────

import { createCLI } from "./cli";

createCLI().parse(process.argv);
