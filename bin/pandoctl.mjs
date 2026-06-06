#!/usr/bin/env node
// Thin shim so the global `pandoctl` command runs the operational CLI via tsx, mirroring `pnpm pandoctl`.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const entry = join(repoRoot, "src", "cli", "agentctl.ts");
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
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
