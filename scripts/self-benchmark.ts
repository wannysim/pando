#!/usr/bin/env bun
import process from "node:process";
import { runSelfBenchmark, type SelfBenchmarkOptions } from "../src/daemon/self-benchmark";
import type { FullDaemonSmokeMode } from "../src/daemon/full-daemon-smoke";

const result = await runSelfBenchmark(parseArgs(process.argv.slice(2)));

console.log(`wrote pando self-benchmark summary to ${result.summaryPath}`);
console.log(`wrote pando self-benchmark markdown to ${result.markdownPath}`);
console.log(`wrote smoke evidence to ${result.evidencePath}`);
console.log(`total duration ${result.summary.totals.totalMs} ms, ok=${result.summary.ok}`);

if (!result.summary.ok) process.exitCode = 1;

function parseArgs(argv: readonly string[]): SelfBenchmarkOptions {
  const parsed: SelfBenchmarkOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (token === "--mode") {
      parsed.mode = modeValue(readValue(argv, index, token));
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
    if (token === "--repo-root") {
      parsed.repoRoot = readValue(argv, index, token);
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
