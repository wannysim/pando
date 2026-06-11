import { describe, expect, it } from "bun:test";

import {
  coverageFailures,
  formatCoverageSummary,
  parseLcovSummary,
} from "../../scripts/check-coverage";

describe("check-coverage", () => {
  it("aggregates LCOV function and line coverage across records", () => {
    const summary = parseLcovSummary(
      [
        "TN:",
        "SF:src/a.ts",
        "FNF:4",
        "FNH:3",
        "LF:10",
        "LH:9",
        "end_of_record",
        "TN:",
        "SF:src/b.ts",
        "FNF:6",
        "FNH:6",
        "LF:30",
        "LH:27",
        "end_of_record",
      ].join("\n"),
    );

    expect(summary.functions).toEqual({ covered: 9, total: 10, percent: 90 });
    expect(summary.lines).toEqual({ covered: 36, total: 40, percent: 90 });
  });

  it("reports metrics below the configured threshold", () => {
    const summary = parseLcovSummary(["FNF:10", "FNH:8", "LF:10", "LH:9"].join("\n"));

    expect(coverageFailures(summary, { functions: 85, lines: 85 })).toEqual([
      "functions coverage 80.00% is below 85.00%",
    ]);
  });

  it("formats the coverage summary for CI logs", () => {
    const summary = parseLcovSummary(["FNF:4", "FNH:4", "LF:2", "LH:1"].join("\n"));

    expect(formatCoverageSummary(summary)).toBe(
      ["Coverage thresholds:", "- lines: 50.00% (1/2)", "- functions: 100.00% (4/4)"].join("\n"),
    );
  });
});
