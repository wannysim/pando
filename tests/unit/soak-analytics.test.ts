import { describe, expect, it } from "vitest";
import { aggregateSoakRuns, type SoakIterationInput } from "../../src/daemon/soak-analytics";
import type {
  TerminalJobSummary,
  TerminalRunSummary,
  TerminalStatusLabel,
} from "../../src/daemon/failure-analytics";

describe("aggregateSoakRuns", () => {
  it("aggregates totals, pass rate, and a sorted failure-reason histogram across iterations", () => {
    const summary = aggregateSoakRuns({
      generatedAt: "2026-06-07T00:00:00.000Z",
      iterations: [
        iteration(1, "soak-1", [
          jobSummary("SOAK-1-A", "success", "job completed successfully"),
          jobSummary("SOAK-1-B", "success", "job completed successfully"),
          jobSummary("SOAK-1-C", "failure", "test gate failed with exit code 1"),
        ]),
        iteration(2, "soak-2", [
          jobSummary("SOAK-2-A", "success", "job completed successfully"),
          jobSummary("SOAK-2-B", "failure", "test gate failed with exit code 1"),
          jobSummary("SOAK-2-C", "timeout", "worker timed out"),
        ]),
      ],
      jobsPerIteration: 3,
      mode: "contract",
    });

    expect(summary.schemaVersion).toBe(1);
    expect(summary.mode).toBe("contract");
    expect(summary.iterations).toBe(2);
    expect(summary.jobsPerIteration).toBe(3);
    expect(summary.totalJobs).toBe(6);
    expect(summary.totals).toEqual({
      cancel: 0,
      escalated: 0,
      failure: 2,
      retried: 0,
      running: 0,
      success: 3,
      timeout: 1,
    });
    expect(summary.passRate).toBe(0.5);
    expect(summary.ok).toBe(false);
    expect(summary.failureReasons).toEqual([
      { count: 2, reason: "test gate failed with exit code 1", terminalStatus: "failure" },
      { count: 1, reason: "worker timed out", terminalStatus: "timeout" },
    ]);
    expect(summary.iterationsBreakdown).toEqual([
      expect.objectContaining({
        evidencePath: "/tmp/soak-1/full-daemon-smoke.json",
        failureSummaryPath: "/tmp/soak-1/failure-summary.json",
        iteration: 1,
        passRate: 0.6667,
        runId: "soak-1",
      }),
      expect.objectContaining({
        iteration: 2,
        passRate: 0.3333,
        runId: "soak-2",
      }),
    ]);
  });

  it("reports a fully green soak as ok with a pass rate of 1 and no failure reasons", () => {
    const summary = aggregateSoakRuns({
      generatedAt: "2026-06-07T00:00:00.000Z",
      iterations: [
        iteration(1, "soak-1", [
          jobSummary("SOAK-1-A", "success", "job completed successfully"),
          jobSummary("SOAK-1-B", "success", "job completed successfully"),
        ]),
      ],
      jobsPerIteration: 2,
      mode: "live",
    });

    expect(summary.ok).toBe(true);
    expect(summary.passRate).toBe(1);
    expect(summary.failureReasons).toEqual([]);
    expect(summary.totalJobs).toBe(2);
  });

  it("treats an empty soak as not ok with a zero pass rate", () => {
    const summary = aggregateSoakRuns({
      generatedAt: "2026-06-07T00:00:00.000Z",
      iterations: [],
      jobsPerIteration: 3,
      mode: "contract",
    });

    expect(summary.ok).toBe(false);
    expect(summary.passRate).toBe(0);
    expect(summary.totalJobs).toBe(0);
    expect(summary.iterationsBreakdown).toEqual([]);
  });
});

function iteration(index: number, runId: string, jobs: TerminalJobSummary[]): SoakIterationInput {
  return {
    evidencePath: `/tmp/${runId}/full-daemon-smoke.json`,
    failureSummaryPath: `/tmp/${runId}/failure-summary.json`,
    iteration: index,
    runId,
    summary: runSummary(jobs),
  };
}

function runSummary(jobs: TerminalJobSummary[]): TerminalRunSummary {
  const totals: TerminalRunSummary["totals"] = {
    cancel: 0,
    escalated: 0,
    failure: 0,
    retried: 0,
    running: 0,
    success: 0,
    timeout: 0,
  };
  for (const job of jobs) {
    totals[job.terminalStatus] += 1;
    if (job.retryCount > 0) totals.retried += 1;
  }
  return { generatedAt: "2026-06-07T00:00:00.000Z", jobs, schemaVersion: 1, totals };
}

function jobSummary(
  jobId: string,
  terminalStatus: TerminalStatusLabel,
  reason: string,
): TerminalJobSummary {
  return {
    durationMs: 1000,
    evidence: {
      path: `/tmp/evidence/${jobId}.json`,
      summary: {
        eventSequence: 1,
        eventType: "stage-completed",
        evidence: { kind: "none" },
        gateName: null,
        payload: {},
        reason,
        stage: "PR",
        status: terminalStatus === "success" ? "DONE" : "FAILED",
      },
    },
    finalStatus: terminalStatus === "success" ? "DONE" : "FAILED",
    jobId,
    reason,
    retryCount: 0,
    stage: "PR",
    terminalStatus,
  };
}
