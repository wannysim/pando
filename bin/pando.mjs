#!/usr/bin/env node
// Thin shim so the global `pando` command runs the CLI through Bun.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const entry = join(repoRoot, "src", "cli", "pando.ts");

const child = spawn("bun", [entry, ...process.argv.slice(2)], {
  cwd: repoRoot,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
