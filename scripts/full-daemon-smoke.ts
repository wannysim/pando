#!/usr/bin/env bun
import process from "node:process";
import {
  runHostFullDaemonSmoke,
  type FullDaemonSmokeMode,
  type FullDaemonSmokeOptions,
} from "../src/daemon/full-daemon-smoke";

const args = parseArgs(process.argv.slice(2));
const evidence = await runHostFullDaemonSmoke(args);
console.log(`wrote ${evidence.mode} full-daemon smoke evidence for ${evidence.jobs.length} jobs`);
console.log(`wrote terminal failure summary to ${evidence.failureSummary.path}`);

function parseArgs(argv: readonly string[]): FullDaemonSmokeOptions {
  const parsed: FullDaemonSmokeOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (token === "--mode") {
      parsed.mode = modeValue(readValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--evidence") {
      parsed.evidencePath = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--failure-summary") {
      parsed.failureSummaryPath = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--db") {
      parsed.dbPath = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--worktree-root") {
      parsed.worktreeRoot = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--repo-root") {
      parsed.repoRoot = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--config-dir") {
      parsed.configDir = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--run-id") {
      parsed.runId = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--global-concurrency") {
      parsed.globalConcurrency = positiveInteger(readValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === "--jobs") {
      parsed.jobCount = positiveInteger(readValue(argv, index, token), token);
      index += 1;
      continue;
    }

    throw new Error(`unknown option: ${token}`);
  }

  return parsed;
}

function readValue(argv: readonly string[], index: number, token: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${token}: expected value`);
  }
  return value;
}

function modeValue(value: string): FullDaemonSmokeMode {
  if (value === "contract" || value === "live") return value;
  throw new Error("--mode: expected contract or live");
}

function positiveInteger(value: string, token: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${token}: expected positive integer`);
  }
  return parsed;
}
