#!/usr/bin/env node
// Placeholder entry point that reserves the `pandoctl` name on npm.
// The real CLI — daemon control for the pando orchestrator — is in active
// development at https://github.com/wannysim/pando (src/cli/agentctl.ts).
import process from "node:process";

const REPO = "https://github.com/wannysim/pando";

process.stdout.write(
  [
    "pandoctl 0.0.1 — placeholder.",
    "The real CLI (pando daemon control) is on the way.",
    `Track progress: ${REPO}`,
    "",
  ].join("\n"),
);
process.exit(0);
