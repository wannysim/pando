import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  FullDaemonSmokeEvidence,
  FullDaemonSmokeOptions,
} from "../../src/daemon/full-daemon-smoke";
import type { TerminalRunSummary, TerminalStatusLabel } from "../../src/daemon/failure-analytics";
import { runSoakNightly } from "../../src/daemon/soak-nightly";
import type { SoakNightlySummary } from "../../src/daemon/soak-analytics";

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "pando-soak-nightly-test-"));
});

afterEach(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

describe("runSoakNightly", () => {
  it("runs the configured number of iterations and aggregates them into a nightly summary", async () => {
    const calls: FullDaemonSmokeOptions[] = [];
    const result = await runSoakNightly({
      iterations: 2,
      jobCount: 3,
      mode: "contract",
      now: () => "2026-06-07T00:00:00.000Z",
      outputDir,
      runId: "nightly-test",
      runSmoke: async (opts) => {
        calls.push(opts);
        const failed = calls.length === 2;
        return fakeEvidence(opts, [
          job("A", "success"),
          job("B", "success"),
          job("C", failed ? "failure" : "success"),
        ]);
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.jobCount).toBe(3);
    expect(calls[0]?.mode).toBe("contract");
    expect(calls[0]?.runId).toBe("nightly-test-iter-1");
    expect(calls[1]?.runId).toBe("nightly-test-iter-2");
    expect(calls[0]?.evidencePath).toBe(join(outputDir, "iteration-1", "full-daemon-smoke.json"));
    expect(calls[0]?.dbPath).toBe(join(outputDir, "iteration-1", "pando.sqlite"));

    expect(result.summary.iterations).toBe(2);
    expect(result.summary.totalJobs).toBe(6);
    expect(result.summary.totals.success).toBe(5);
    expect(result.summary.totals.failure).toBe(1);
    expect(result.summary.ok).toBe(false);
    expect(result.summaryPath).toBe(join(outputDir, "nightly-summary.json"));

    const persisted = JSON.parse(await readFile(result.summaryPath, "utf8")) as SoakNightlySummary;
    expect(persisted).toEqual(result.summary);
    expect(persisted.failureReasons).toEqual([
      { count: 1, reason: "test gate failed with exit code 1", terminalStatus: "failure" },
    ]);
  });

  it("rejects an out-of-range iteration count", async () => {
    await expect(
      runSoakNightly({
        iterations: 0,
        outputDir,
        runSmoke: async (opts) => fakeEvidence(opts, []),
      }),
    ).rejects.toThrow("iterations must be an integer");
  });

  it("defaults to three iterations of three jobs in contract mode", async () => {
    const calls: FullDaemonSmokeOptions[] = [];
    const result = await runSoakNightly({
      now: () => "2026-06-07T00:00:00.000Z",
      outputDir,
      runId: "nightly-default",
      runSmoke: async (opts) => {
        calls.push(opts);
        return fakeEvidence(opts, [job("A", "success"), job("B", "success"), job("C", "success")]);
      },
    });

    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.jobCount === 3)).toBe(true);
    expect(result.summary.mode).toBe("contract");
    expect(result.summary.ok).toBe(true);
  });
});

function fakeEvidence(
  opts: FullDaemonSmokeOptions,
  jobs: ReturnType<typeof job>[],
): FullDaemonSmokeEvidence {
  const totals: TerminalRunSummary["totals"] = {
    cancel: 0,
    escalated: 0,
    failure: 0,
    retried: 0,
    running: 0,
    success: 0,
    timeout: 0,
  };
  for (const entry of jobs) totals[entry.terminalStatus] += 1;
  const summary: TerminalRunSummary = {
    generatedAt: "2026-06-07T00:00:00.000Z",
    jobs,
    schemaVersion: 1,
    totals,
  };

  return {
    checks: {
      gateEvidence: { pass: true },
      globalConcurrency: { value: opts.globalConcurrency ?? 2, withinLiveCap: true },
      jobsClaimed: { actual: jobs.length, expected: jobs.length, pass: true },
      providerCap: { pass: true, usage: {} },
      worktreeCollision: { pass: true },
    },
    failureSummary: {
      path: opts.failureSummaryPath ?? "",
      summary,
      totals,
    },
    jobs: [],
    mode: opts.mode ?? "contract",
    runId: opts.runId ?? "fake",
    schemaVersion: 1,
    target: "host",
  };
}

function job(suffix: string, terminalStatus: TerminalStatusLabel) {
  const reason =
    terminalStatus === "success"
      ? "job completed successfully"
      : "test gate failed with exit code 1";
  return {
    durationMs: 1000,
    evidence: {
      path: `/tmp/evidence/${suffix}.json`,
      summary: {
        eventSequence: 1,
        eventType: "stage-completed",
        evidence: { kind: "none" as const },
        gateName: null,
        payload: {},
        reason,
        stage: "PR" as const,
        status: terminalStatus === "success" ? ("DONE" as const) : ("FAILED" as const),
      },
    },
    finalStatus: terminalStatus === "success" ? ("DONE" as const) : ("FAILED" as const),
    jobId: suffix,
    reason,
    retryCount: 0,
    stage: "PR" as const,
    terminalStatus,
  };
}
