#!/usr/bin/env bun

import { readFileSync } from "node:fs";

export interface CoverageMetric {
  covered: number;
  total: number;
  percent: number;
}

export interface CoverageSummary {
  functions: CoverageMetric;
  lines: CoverageMetric;
}

const DEFAULT_THRESHOLDS = {
  functions: 85,
  lines: 85,
} satisfies Record<keyof CoverageSummary, number>;

function metric(covered: number, total: number): CoverageMetric {
  return {
    covered,
    total,
    percent: total === 0 ? 100 : (covered / total) * 100,
  };
}

export function parseLcovSummary(lcov: string): CoverageSummary {
  let functionsTotal = 0;
  let functionsCovered = 0;
  let linesTotal = 0;
  let linesCovered = 0;

  for (const rawLine of lcov.split(/\r?\n/)) {
    const line = rawLine.trim();
    const [key, value] = line.split(":");
    const count = Number(value);

    if (!Number.isFinite(count)) {
      continue;
    }

    if (key === "FNF") {
      functionsTotal += count;
    }

    if (key === "FNH") {
      functionsCovered += count;
    }

    if (key === "LF") {
      linesTotal += count;
    }

    if (key === "LH") {
      linesCovered += count;
    }
  }

  return {
    functions: metric(functionsCovered, functionsTotal),
    lines: metric(linesCovered, linesTotal),
  };
}

export function coverageFailures(
  summary: CoverageSummary,
  thresholds: Record<keyof CoverageSummary, number> = DEFAULT_THRESHOLDS,
): string[] {
  return (Object.keys(thresholds) as Array<keyof CoverageSummary>)
    .filter((key) => summary[key].percent < thresholds[key])
    .map(
      (key) =>
        `${key} coverage ${formatPercent(summary[key].percent)}% is below ${formatPercent(thresholds[key])}%`,
    );
}

export function formatCoverageSummary(summary: CoverageSummary): string {
  return [
    "Coverage thresholds:",
    ...(["lines", "functions"] as const).map((key) => {
      const value = summary[key];
      return `- ${key}: ${formatPercent(value.percent)}% (${value.covered}/${value.total})`;
    }),
  ].join("\n");
}

function formatPercent(value: number): string {
  return value.toFixed(2);
}

function main(args: string[]): number {
  const coveragePath = args[0] ?? "coverage/lcov.info";
  const summary = parseLcovSummary(readFileSync(coveragePath, "utf8"));
  const failures = coverageFailures(summary);

  console.log(formatCoverageSummary(summary));

  if (failures.length === 0) {
    return 0;
  }

  for (const failure of failures) {
    console.error(failure);
  }

  return 1;
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
