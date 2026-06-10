import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FullDaemonSmokeEvidence } from "../../src/daemon/full-daemon-smoke";
import type { TerminalRunSummary } from "../../src/daemon/failure-analytics";
import { runSelfBenchmark } from "../../src/daemon/self-benchmark";

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "pando-self-benchmark-test-"));
});

afterEach(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

describe("runSelfBenchmark", () => {
  it("runs a one-job pando smoke benchmark and writes JSON plus Markdown summaries", async () => {
    const calls: Array<{ jobCount?: number; runId?: string; evidencePath?: string }> = [];
    const result = await runSelfBenchmark({
      now: () => "2026-06-10T00:00:00.000Z",
      outputDir,
      packageManager: "pnpm@11.5.2",
      runId: "ci benchmark/1",
      runSmoke: async (opts) => {
        calls.push(opts);
        return fakeEvidence(opts.evidencePath ?? "", opts.failureSummaryPath ?? "");
      },
      timer: sequenceTimer([100, 2350]),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      jobCount: 1,
      mode: "contract",
      runId: "ci-benchmark-1",
    });
    expect(calls[0]?.evidencePath).toBe(join(outputDir, "full-daemon-smoke.json"));

    expect(result.summary).toMatchObject({
      generatedAt: "2026-06-10T00:00:00.000Z",
      mode: "contract",
      ok: true,
      packageManager: "pnpm@11.5.2",
      runId: "ci-benchmark-1",
      schemaVersion: 1,
      totals: {
        jobs: 1,
        success: 1,
        totalMs: 2250,
      },
    });
    expect(result.summary.stageDurations).toEqual([
      {
        completed: 1,
        count: 1,
        failed: 0,
        maxMs: 10,
        meanMs: 10,
        minMs: 10,
        stage: "SPEC",
        totalMs: 10,
      },
      {
        completed: 1,
        count: 1,
        failed: 0,
        maxMs: 20,
        meanMs: 20,
        minMs: 20,
        stage: "TEST",
        totalMs: 20,
      },
      {
        completed: 1,
        count: 1,
        failed: 0,
        maxMs: 30,
        meanMs: 30,
        minMs: 30,
        stage: "PR",
        totalMs: 30,
      },
    ]);
    expect(result.summary.jobs).toEqual([
      {
        durationMs: 60,
        finalStatus: "DONE",
        id: "PANDO-FULL-SMOKE-1",
        stages: [
          { durationMs: 10, eventType: "stage-completed", stage: "SPEC" },
          { durationMs: 20, eventType: "stage-completed", stage: "TEST" },
          { durationMs: 30, eventType: "stage-completed", stage: "PR" },
        ],
      },
    ]);

    const persisted = JSON.parse(await readFile(result.summaryPath, "utf8")) as unknown;
    expect(persisted).toEqual(result.summary);
    const markdown = await readFile(result.markdownPath, "utf8");
    expect(markdown).toContain("# Pando self-benchmark");
    expect(markdown).toContain("| Total duration | 2250 ms |");
    expect(markdown).toContain("| TEST | 1 | 20 | 20 | 20 | 20 | 1 | 0 |");
  });

  it("clears the previous sqlite database before reusing an output directory", async () => {
    await writeFile(join(outputDir, "pando.sqlite"), "previous run");

    await runSelfBenchmark({
      now: () => "2026-06-10T00:00:00.000Z",
      outputDir,
      packageManager: "pnpm@11.5.2",
      runId: "reuse",
      runSmoke: async (opts) => {
        await expect(stat(opts.dbPath ?? "")).rejects.toMatchObject({ code: "ENOENT" });
        return fakeEvidence(opts.evidencePath ?? "", opts.failureSummaryPath ?? "");
      },
      timer: sequenceTimer([100, 200]),
    });
  });
});

function sequenceTimer(values: number[]) {
  let index = 0;
  return {
    nowMs() {
      const value = values[index];
      index += 1;
      if (value === undefined) throw new Error("timer exhausted");
      return value;
    },
  };
}

function fakeEvidence(evidencePath: string, failureSummaryPath: string): FullDaemonSmokeEvidence {
  const summary: TerminalRunSummary = {
    generatedAt: "2026-06-10T00:00:00.000Z",
    jobs: [
      {
        durationMs: 60,
        evidence: {
          path: "/tmp/pando-self-benchmark/job.json",
          summary: {
            eventSequence: 3,
            eventType: "stage-completed",
            evidence: { kind: "none" },
            gateName: null,
            payload: { durationMs: 30 },
            reason: "job completed successfully",
            stage: "PR",
            status: "DONE",
          },
        },
        finalStatus: "DONE",
        jobId: "PANDO-FULL-SMOKE-1",
        reason: "job completed successfully",
        retryCount: 0,
        stage: "PR",
        terminalStatus: "success",
      },
    ],
    schemaVersion: 1,
    totals: {
      cancel: 0,
      escalated: 0,
      failure: 0,
      retried: 0,
      running: 0,
      success: 1,
      timeout: 0,
    },
  };

  return {
    checks: {
      gateEvidence: { pass: true },
      globalConcurrency: { value: 2, withinLiveCap: true },
      jobsClaimed: { actual: 1, expected: 1, pass: true },
      providerCap: { pass: true, usage: {} },
      worktreeCollision: { pass: true },
    },
    failureSummary: {
      path: failureSummaryPath,
      summary,
      totals: summary.totals,
    },
    jobs: [
      {
        finalStatus: "DONE",
        gateEvidence: [],
        id: "PANDO-FULL-SMOKE-1",
        repo: "pando",
        stageEvents: [
          { payload: {}, stage: "SPEC", type: "stage-started" },
          { payload: { durationMs: 10 }, stage: "SPEC", type: "stage-completed" },
          { payload: { durationMs: 20 }, stage: "TEST", type: "stage-completed" },
          { payload: { durationMs: 30 }, stage: "PR", type: "stage-completed" },
        ],
        worktreePath: "/tmp/pando-self-benchmark/worktree",
      },
    ],
    mode: "contract",
    runId: "ci-benchmark-1",
    schemaVersion: 1,
    target: "host",
  };
}
