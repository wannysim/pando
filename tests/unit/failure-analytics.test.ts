import { describe, expect, it } from "bun:test";
import type { JobEventRecord, JobRecord } from "../../src/db/index";
import {
  aggregateFailureReasons,
  buildFailureAnalytics,
  summarizeTerminalJobs,
  type TerminalJobSummary,
  type TerminalStatusLabel,
} from "../../src/daemon/failure-analytics";
import type { JobStatus, StageName, WorkItem } from "../../src/core/types";

describe("summarizeTerminalJobs", () => {
  it("summarizes terminal success failure timeout cancel and retry evidence without raw output", () => {
    const summary = summarizeTerminalJobs({
      evidenceRoot: "/tmp/pando-soak/evidence",
      eventsByJobId: {
        "SOAK-CANCELED": [
          event({
            jobId: "SOAK-CANCELED",
            payload: { reason: "operator stopped the job", requestedBy: "agentctl" },
            status: "CANCELED",
            type: "canceled",
          }),
        ],
        "SOAK-FAILED": [
          event({
            evidence: '{"command":"pnpm test","exitCode":1}',
            gateName: "test-exit-code",
            jobId: "SOAK-FAILED",
            reason: "test gate failed with exit code 1",
            stage: "TEST",
            type: "gate-fail",
          }),
          event({
            evidence: '{"command":"pnpm test","exitCode":1}',
            gateName: "test-exit-code",
            jobId: "SOAK-FAILED",
            payload: {
              durationMs: 250,
              evidence: '{"command":"pnpm test","exitCode":1}',
              failureKind: "gate-fail",
              gateName: "test-exit-code",
              reason: "test gate failed with exit code 1",
            },
            reason: "test gate failed with exit code 1",
            stage: "TEST",
            type: "stage-failed",
          }),
        ],
        "SOAK-RETRIED": [
          event({
            jobId: "SOAK-RETRIED",
            payload: { event: "GATE_FAIL", next: "IMPL", previous: "IMPL" },
            stage: "IMPL",
            status: "IMPL",
            type: "state-change",
          }),
          event({
            jobId: "SOAK-RETRIED",
            payload: { durationMs: 400 },
            stage: "PR",
            type: "stage-completed",
          }),
        ],
        "SOAK-SUCCESS": [
          event({
            jobId: "SOAK-SUCCESS",
            payload: { durationMs: 300 },
            stage: "PR",
            type: "stage-completed",
          }),
        ],
        "SOAK-TIMEOUT": [
          event({
            evidence: "raw-worker-output-that-must-not-be-copied",
            jobId: "SOAK-TIMEOUT",
            payload: {
              durationMs: 30_000,
              evidence: "raw-worker-output-that-must-not-be-copied",
              failureKind: "engine-fail",
              timedOut: true,
            },
            reason: "worker timed out",
            stage: "IMPL",
            type: "stage-failed",
          }),
        ],
      },
      generatedAt: "2026-06-07T00:00:00.000Z",
      jobs: [
        job("SOAK-SUCCESS", "DONE"),
        job("SOAK-FAILED", "FAILED"),
        job("SOAK-TIMEOUT", "FAILED"),
        job("SOAK-CANCELED", "CANCELED"),
        job("SOAK-RETRIED", "DONE"),
      ],
    });

    expect(summary.totals).toEqual({
      cancel: 1,
      escalated: 0,
      failure: 1,
      retried: 1,
      running: 0,
      success: 2,
      timeout: 1,
    });
    expect(summary.jobs).toEqual([
      expect.objectContaining({
        durationMs: 5 * 60_000,
        evidence: expect.objectContaining({
          path: "/tmp/pando-soak/evidence/SOAK-SUCCESS.json",
        }),
        finalStatus: "DONE",
        jobId: "SOAK-SUCCESS",
        reason: "job completed successfully",
        retryCount: 0,
        stage: "PR",
        terminalStatus: "success",
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          summary: expect.objectContaining({
            evidence: { kind: "structured-json", value: { command: "pnpm test", exitCode: 1 } },
            eventType: "stage-failed",
            gateName: "test-exit-code",
          }),
        }),
        finalStatus: "FAILED",
        jobId: "SOAK-FAILED",
        reason: "test gate failed with exit code 1",
        retryCount: 0,
        stage: "TEST",
        terminalStatus: "failure",
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          summary: expect.objectContaining({
            evidence: { bytes: 41, kind: "text", omitted: true },
            payload: expect.not.objectContaining({ evidence: expect.any(String) }),
          }),
        }),
        finalStatus: "FAILED",
        jobId: "SOAK-TIMEOUT",
        reason: "worker timed out",
        stage: "IMPL",
        terminalStatus: "timeout",
      }),
      expect.objectContaining({
        finalStatus: "CANCELED",
        jobId: "SOAK-CANCELED",
        reason: "operator stopped the job",
        stage: null,
        terminalStatus: "cancel",
      }),
      expect.objectContaining({
        finalStatus: "DONE",
        jobId: "SOAK-RETRIED",
        retryCount: 1,
        terminalStatus: "success",
      }),
    ]);
    expect(JSON.stringify(summary)).not.toContain("raw-worker-output-that-must-not-be-copied");
  });

  it("covers fallback terminal evidence for running escalated timeout and cancel variants", () => {
    const summary = summarizeTerminalJobs({
      evidenceRoot: "/tmp/pando-soak/evidence",
      eventsByJobId: {
        "SOAK-CANCEL-STOP-FAILED": [
          event({
            evidence: "stop failed raw details",
            jobId: "SOAK-CANCEL-STOP-FAILED",
            reason: "running cancel request failed",
            status: "IMPL",
            type: "cancel-stop-failed",
          }),
        ],
        "SOAK-ESCALATED": [
          event({
            evidence: "",
            jobId: "SOAK-ESCALATED",
            payload: { next: "ESCALATED", previous: "PLAN" },
            stage: "PLAN",
            status: "ESCALATED",
            type: "state-change",
          }),
          event({
            evidence: '{"questions":["missing acceptance criteria"],"content":"omit me"}',
            gateName: "plan-artifact-schema",
            jobId: "SOAK-ESCALATED",
            payload: { failureKind: "blocking-questions", stdout: "omit me" },
            stage: "PLAN",
            type: "gate-blocking",
          }),
        ],
        "SOAK-RUNNING-STAGE": [
          event({
            jobId: "SOAK-RUNNING-STAGE",
            payload: { durationMs: 125 },
            stage: "SPEC",
            status: "SPEC",
            type: "stage-started",
          }),
        ],
        "SOAK-TIMEOUT-EVIDENCE": [
          event({
            evidence: '{"timedOut":true,"stderr":"omit me"}',
            jobId: "SOAK-TIMEOUT-EVIDENCE",
            payload: {},
            stage: "IMPL",
            type: "engine-fail",
          }),
        ],
      },
      generatedAt: "2026-06-07T00:00:00.000Z",
      jobs: [
        job("SOAK-RUNNING-NO-EVENT", "QUEUED", { clearTimes: true }),
        job("SOAK-RUNNING-STAGE", "SPEC", { clearTimes: true }),
        job("SOAK-ESCALATED", "ESCALATED", { clearTimes: true }),
        job("SOAK-TIMEOUT-EVIDENCE", "FAILED", { clearTimes: true }),
        job("SOAK-CANCEL-STOP-FAILED", "CANCELED", { clearTimes: true }),
      ],
    });

    expect(summary.totals).toEqual({
      cancel: 1,
      escalated: 1,
      failure: 0,
      retried: 0,
      running: 2,
      success: 0,
      timeout: 1,
    });
    expect(summary.jobs).toEqual([
      expect.objectContaining({
        durationMs: null,
        evidence: expect.objectContaining({
          summary: expect.objectContaining({
            eventSequence: null,
            eventType: "job-record",
            evidence: { kind: "none" },
            status: "QUEUED",
          }),
        }),
        jobId: "SOAK-RUNNING-NO-EVENT",
        reason: "job is not terminal: QUEUED",
        stage: null,
        terminalStatus: "running",
      }),
      expect.objectContaining({
        durationMs: 125,
        jobId: "SOAK-RUNNING-STAGE",
        reason: "job is not terminal: SPEC",
        stage: "SPEC",
        terminalStatus: "running",
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          summary: expect.objectContaining({
            evidence: {
              kind: "structured-json",
              value: { questions: ["missing acceptance criteria"] },
            },
            eventType: "gate-blocking",
            payload: { failureKind: "blocking-questions" },
          }),
        }),
        jobId: "SOAK-ESCALATED",
        reason: "blocking-questions",
        stage: "PLAN",
        terminalStatus: "escalated",
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          summary: expect.objectContaining({
            evidence: { kind: "structured-json", value: { timedOut: true } },
            eventType: "engine-fail",
          }),
        }),
        jobId: "SOAK-TIMEOUT-EVIDENCE",
        reason: "job timed out",
        terminalStatus: "timeout",
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          summary: expect.objectContaining({
            evidence: { bytes: 23, kind: "text", omitted: true },
            eventType: "cancel-stop-failed",
          }),
        }),
        jobId: "SOAK-CANCEL-STOP-FAILED",
        reason: "running cancel request failed",
        terminalStatus: "cancel",
      }),
    ]);
    expect(JSON.stringify(summary)).not.toContain("omit me");
  });
});

describe("buildFailureAnalytics", () => {
  it("derives totals, pass rate, and a sorted failure-reason histogram from a run summary", () => {
    const analytics = buildFailureAnalytics({
      generatedAt: "2026-06-07T00:00:00.000Z",
      jobs: [
        terminalJob("A", "success", "job completed successfully"),
        terminalJob("B", "success", "job completed successfully"),
        terminalJob("C", "failure", "test gate failed with exit code 1"),
        terminalJob("D", "failure", "test gate failed with exit code 1"),
        terminalJob("E", "timeout", "worker timed out"),
        terminalJob("F", "running", "job is not terminal: IMPL"),
      ],
      schemaVersion: 1,
      totals: {
        cancel: 0,
        escalated: 0,
        failure: 2,
        retried: 0,
        running: 1,
        success: 2,
        timeout: 1,
      },
    });

    expect(analytics.totalJobs).toBe(6);
    expect(analytics.passRate).toBe(0.3333);
    expect(analytics.totals.success).toBe(2);
    expect(analytics.failureReasons).toEqual([
      { count: 2, reason: "test gate failed with exit code 1", terminalStatus: "failure" },
      { count: 1, reason: "worker timed out", terminalStatus: "timeout" },
    ]);
  });

  it("returns a zero pass rate and no failure reasons for an empty run", () => {
    const analytics = buildFailureAnalytics({
      generatedAt: "2026-06-07T00:00:00.000Z",
      jobs: [],
      schemaVersion: 1,
      totals: {
        cancel: 0,
        escalated: 0,
        failure: 0,
        retried: 0,
        running: 0,
        success: 0,
        timeout: 0,
      },
    });

    expect(analytics.totalJobs).toBe(0);
    expect(analytics.passRate).toBe(0);
    expect(analytics.failureReasons).toEqual([]);
  });
});

describe("aggregateFailureReasons", () => {
  it("ignores successful jobs and sorts ties by status then reason", () => {
    const reasons = aggregateFailureReasons([
      terminalJob("A", "success", "job completed successfully"),
      terminalJob("B", "escalated", "blocking-questions"),
      terminalJob("C", "failure", "lint gate failed"),
    ]);

    expect(reasons).toEqual([
      { count: 1, reason: "blocking-questions", terminalStatus: "escalated" },
      { count: 1, reason: "lint gate failed", terminalStatus: "failure" },
    ]);
  });
});

function terminalJob(
  id: string,
  terminalStatus: TerminalStatusLabel,
  reason: string,
): TerminalJobSummary {
  return {
    durationMs: 1000,
    evidence: {
      path: `/tmp/evidence/${id}.json`,
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
    jobId: id,
    reason,
    retryCount: 0,
    stage: "PR",
    terminalStatus,
  };
}

function job(id: string, status: JobStatus, options: { clearTimes?: boolean } = {}): JobRecord {
  return {
    attemptsLeft: 0,
    createdAt: "2026-06-07T00:00:00.000Z",
    finishedAt: options.clearTimes === true ? undefined : "2026-06-07T00:05:00.000Z",
    item: workItem(id),
    startedAt: options.clearTimes === true ? undefined : "2026-06-07T00:00:00.000Z",
    status,
    updatedAt: "2026-06-07T00:05:00.000Z",
    worktreePath: `/tmp/worktrees/${id}`,
  };
}

function event(input: {
  jobId: string;
  type: string;
  stage?: StageName;
  status?: JobStatus;
  gateName?: string;
  reason?: string;
  evidence?: string;
  payload?: Record<string, unknown>;
}): JobEventRecord {
  return {
    createdAt: "2026-06-07T00:01:00.000Z",
    evidence: input.evidence,
    gateName: input.gateName,
    jobId: input.jobId,
    payload: input.payload ?? {},
    reason: input.reason,
    sequence: 1,
    stage: input.stage,
    status: input.status,
    type: input.type,
  };
}

function workItem(id: string): WorkItem {
  return {
    id,
    payload: { briefPath: `/tmp/${id}.md`, kind: "brief" },
    repo: "pando",
    source: "brief",
    title: id,
  };
}
