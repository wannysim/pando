#!/usr/bin/env bun
import process from "node:process";
import { runSoakNightly, type SoakNightlyOptions } from "../src/daemon/soak-nightly";
import type { FullDaemonSmokeMode } from "../src/daemon/full-daemon-smoke";

const args = parseArgs(process.argv.slice(2));
const result = await runSoakNightly(args);
const { summary } = result;

console.log(
  `ran ${summary.iterations} iteration(s) of ${summary.jobsPerIteration} ${summary.mode} job(s)`,
);
console.log(
  `pass rate ${summary.passRate} (${summary.totals.success}/${summary.totalJobs}), ok=${summary.ok}`,
);
for (const reason of summary.failureReasons) {
  console.log(`  ${reason.count}× ${reason.terminalStatus}: ${reason.reason}`);
}
console.log(`wrote nightly summary to ${result.summaryPath}`);

if (!summary.ok) process.exitCode = 1;

function parseArgs(argv: readonly string[]): SoakNightlyOptions {
  const parsed: SoakNightlyOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (token === "--mode") {
      parsed.mode = modeValue(readValue(argv, index, token));
      index += 1;
      continue;
    }
    if (token === "--iterations") {
      parsed.iterations = positiveInteger(readValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === "--jobs") {
      parsed.jobCount = positiveInteger(readValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === "--global-concurrency") {
      parsed.globalConcurrency = positiveInteger(readValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === "--run-id") {
      parsed.runId = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--output-dir") {
      parsed.outputDir = readValue(argv, index, token);
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
