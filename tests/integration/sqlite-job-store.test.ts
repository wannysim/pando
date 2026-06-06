import { describe, expect, it } from "vitest";
import { createSqliteJobStore } from "../../src/db/index";
import type { RepoProfile, WorkItem } from "../../src/core/types";

describe("SqliteJobStore", () => {
  it("enqueues jobs and claims exactly one runnable job", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock(["2026-06-06T00:00:00.000Z", "2026-06-06T00:00:01.000Z"]),
    });

    store.enqueueJob({ item: workItem("DEMO-1001"), retryBudget: 3 });

    const claimed = store.claimNextRunnable();

    expect(claimed).toMatchObject({
      attemptsLeft: 3,
      status: "SPEC",
      item: { id: "DEMO-1001" },
    });
    expect(store.getJob("DEMO-1001")?.status).toBe("SPEC");
    expect(store.claimNextRunnable()?.item.id).toBe("DEMO-1001");

    store.close();
  });

  it("skips excluded in-flight jobs when claiming the next runnable job", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock(["2026-06-06T00:00:00.000Z", "2026-06-06T00:00:01.000Z"]),
    });

    store.enqueueJob({ item: workItem("DEMO-1001"), retryBudget: 3 });
    store.enqueueJob({ item: workItem("DEMO-1002"), retryBudget: 3 });

    expect(store.claimNextRunnable()?.item.id).toBe("DEMO-1001");
    expect(store.claimNextRunnable({ excludeJobIds: ["DEMO-1001"] })?.item.id).toBe("DEMO-1002");

    store.close();
  });

  it("returns undefined when no queued or active jobs exist", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock(["2026-06-06T00:00:00.000Z"]),
    });

    expect(store.claimNextRunnable()).toBeUndefined();
    expect(store.getJob("missing")).toBeUndefined();
    expect(store.getRepoProfile("missing")).toBeUndefined();
    expect(store.listEvents("missing")).toEqual([]);

    store.close();
  });

  it("persists events in insertion order with structured details", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
        "2026-06-06T00:00:02.000Z",
      ]),
    });

    store.enqueueJob({ item: workItem("DEMO-1002"), retryBudget: 2 });
    store.appendEvent({
      jobId: "DEMO-1002",
      payload: { exitCode: 1 },
      reason: "tests failed",
      stage: "IMPL",
      type: "gate-fail",
    });

    expect(store.listEvents("DEMO-1002")).toEqual([
      {
        createdAt: "2026-06-06T00:00:01.000Z",
        evidence: undefined,
        gateName: undefined,
        jobId: "DEMO-1002",
        payload: { exitCode: 1 },
        reason: "tests failed",
        sequence: 1,
        stage: "IMPL",
        status: undefined,
        type: "gate-fail",
      },
    ]);

    store.close();
  });

  it("updates terminal jobs back to a retry stage", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
        "2026-06-06T00:00:02.000Z",
      ]),
    });

    store.enqueueJob({ item: workItem("DEMO-1003"), retryBudget: 1 });
    store.updateJobStatus({
      attemptsLeft: 0,
      jobId: "DEMO-1003",
      status: "FAILED",
      worktreePath: "/worktrees/web/feat-DEMO-1003",
    });

    const retried = store.retryJob({
      attemptsLeft: 4,
      from: "IMPL",
      jobId: "DEMO-1003",
    });

    expect(retried).toMatchObject({
      attemptsLeft: 4,
      status: "IMPL",
      worktreePath: "/worktrees/web/feat-DEMO-1003",
    });
    expect(store.listEvents("DEMO-1003").at(-1)).toMatchObject({
      payload: { from: "IMPL" },
      status: "IMPL",
      type: "retry",
    });

    store.close();
  });

  it("rejects retries for non-terminal jobs", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock(["2026-06-06T00:00:00.000Z"]),
    });

    store.enqueueJob({ item: workItem("DEMO-1004"), retryBudget: 1 });

    expect(() =>
      store.retryJob({
        attemptsLeft: 2,
        from: "TEST",
        jobId: "DEMO-1004",
      }),
    ).toThrow(/not terminal/i);

    store.close();
  });

  it("cancels queued jobs as terminal records with structured events", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
        "2026-06-06T00:00:02.000Z",
        "2026-06-06T00:00:03.000Z",
      ]),
    });

    store.enqueueJob({ item: workItem("DEMO-1005"), retryBudget: 2 });

    const canceled = store.cancelJob({
      jobId: "DEMO-1005",
      reason: "operator requested",
      requestedBy: "agentctl",
    });

    expect(canceled).toMatchObject({
      attemptsLeft: 2,
      status: "CANCELED",
      item: { id: "DEMO-1005" },
    });
    expect(canceled.finishedAt).toBeDefined();
    expect(store.claimNextRunnable()).toBeUndefined();
    expect(store.listEvents("DEMO-1005")).toEqual([
      expect.objectContaining({
        payload: {
          previousStatus: "QUEUED",
          reason: "operator requested",
          requestedBy: "agentctl",
        },
        status: "QUEUED",
        type: "cancel-requested",
      }),
      expect.objectContaining({
        payload: {
          previousStatus: "QUEUED",
          reason: "operator requested",
          requestedBy: "agentctl",
        },
        status: "CANCELED",
        type: "canceled",
      }),
    ]);

    store.close();
  });

  it("stores running cancel requests and excludes them from runnable claims", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
        "2026-06-06T00:00:02.000Z",
        "2026-06-06T00:00:03.000Z",
        "2026-06-06T00:00:04.000Z",
      ]),
    });

    store.enqueueJob({ item: workItem("DEMO-1006"), retryBudget: 3 });
    expect(store.claimNextRunnable()?.status).toBe("SPEC");

    const requested = store.cancelJob({
      jobId: "DEMO-1006",
      requestedBy: "agentctl",
    });

    expect(requested).toMatchObject({
      status: "SPEC",
    });
    expect(requested.cancelRequestedAt).toBeDefined();
    expect(store.claimNextRunnable()).toBeUndefined();
    expect(store.listCancelRequestedJobs().map((job) => job.item.id)).toEqual(["DEMO-1006"]);

    const completed = store.completeJobCancellation({
      jobId: "DEMO-1006",
      stoppedBy: "daemon",
    });

    expect(completed).toMatchObject({
      status: "CANCELED",
    });
    expect(completed.cancelRequestedAt).toBe(requested.cancelRequestedAt);
    expect(store.listEvents("DEMO-1006").map((event) => event.type)).toEqual([
      "cancel-requested",
      "canceled",
    ]);

    store.close();
  });

  it("cleans up terminal jobs with worktree paths and records completion events", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
        "2026-06-06T00:00:02.000Z",
        "2026-06-06T00:00:03.000Z",
      ]),
    });

    store.enqueueJob({ item: workItem("DEMO-1007"), retryBudget: 1 });
    store.updateJobStatus({
      attemptsLeft: 1,
      jobId: "DEMO-1007",
      status: "DONE",
      worktreePath: "/worktrees/web/feat-DEMO-1007",
    });

    const request = store.requestJobCleanup({
      jobId: "DEMO-1007",
      requestedBy: "agentctl",
    });
    const cleaned = store.completeJobCleanup({
      jobId: "DEMO-1007",
      worktreePath: request.worktreePath,
    });

    expect(request.worktreePath).toBe("/worktrees/web/feat-DEMO-1007");
    expect(cleaned).toMatchObject({
      status: "DONE",
      worktreePath: undefined,
    });
    expect(store.listEvents("DEMO-1007")).toEqual([
      expect.objectContaining({
        payload: {
          requestedBy: "agentctl",
          status: "DONE",
          worktreePath: "/worktrees/web/feat-DEMO-1007",
        },
        status: "DONE",
        type: "cleanup-requested",
      }),
      expect.objectContaining({
        payload: { worktreePath: "/worktrees/web/feat-DEMO-1007" },
        status: "DONE",
        type: "cleanup-completed",
      }),
    ]);

    store.close();
  });

  it("records cleanup failures without clearing the worktree path", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
        "2026-06-06T00:00:02.000Z",
        "2026-06-06T00:00:03.000Z",
      ]),
    });

    store.enqueueJob({ item: workItem("DEMO-1008"), retryBudget: 1 });
    store.updateJobStatus({
      attemptsLeft: 0,
      jobId: "DEMO-1008",
      status: "FAILED",
      worktreePath: "/worktrees/web/feat-DEMO-1008",
    });

    const request = store.requestJobCleanup({ jobId: "DEMO-1008" });
    const failed = store.failJobCleanup({
      evidence: "permission denied",
      jobId: "DEMO-1008",
      reason: "git worktree remove failed",
      worktreePath: request.worktreePath,
    });

    expect(failed.worktreePath).toBe("/worktrees/web/feat-DEMO-1008");
    expect(store.listEvents("DEMO-1008").at(-1)).toMatchObject({
      evidence: "permission denied",
      payload: { worktreePath: "/worktrees/web/feat-DEMO-1008" },
      reason: "git worktree remove failed",
      status: "FAILED",
      type: "cleanup-failed",
    });

    store.close();
  });

  it("rejects cleanup for non-terminal jobs and terminal jobs without worktree paths", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock(["2026-06-06T00:00:00.000Z", "2026-06-06T00:00:01.000Z"]),
    });

    store.enqueueJob({ item: workItem("DEMO-1009"), retryBudget: 1 });
    expect(() => store.requestJobCleanup({ jobId: "DEMO-1009" })).toThrow(/not terminal/i);

    store.updateJobStatus({ attemptsLeft: 0, jobId: "DEMO-1009", status: "FAILED" });
    expect(() => store.requestJobCleanup({ jobId: "DEMO-1009" })).toThrow(/worktree path/i);

    store.close();
  });

  it("allows canceled and cleaned up terminal jobs to be retried", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
        "2026-06-06T00:00:02.000Z",
        "2026-06-06T00:00:03.000Z",
        "2026-06-06T00:00:04.000Z",
        "2026-06-06T00:00:05.000Z",
      ]),
    });

    store.enqueueJob({ item: workItem("DEMO-1010"), retryBudget: 1 });
    store.cancelJob({ jobId: "DEMO-1010", requestedBy: "agentctl" });
    const retriedCanceled = store.retryJob({
      attemptsLeft: 2,
      from: "TEST",
      jobId: "DEMO-1010",
    });

    expect(retriedCanceled).toMatchObject({
      cancelRequestedAt: undefined,
      status: "TEST",
    });

    store.updateJobStatus({
      attemptsLeft: 0,
      jobId: "DEMO-1010",
      status: "FAILED",
      worktreePath: "/worktrees/web/feat-DEMO-1010",
    });
    const cleanup = store.requestJobCleanup({ jobId: "DEMO-1010" });
    store.completeJobCleanup({ jobId: "DEMO-1010", worktreePath: cleanup.worktreePath });
    const retriedCleaned = store.retryJob({
      attemptsLeft: 3,
      from: "IMPL",
      jobId: "DEMO-1010",
    });

    expect(retriedCleaned).toMatchObject({
      status: "IMPL",
      worktreePath: undefined,
    });

    store.close();
  });

  it("round-trips brief jobs with branches and dependencies", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock(["2026-06-06T00:00:00.000Z"]),
    });
    const item: WorkItem = {
      branch: "feat/personal",
      dependsOn: ["DEMO-1001"],
      id: "personal-site-20260606-a",
      payload: { briefPath: "briefs/personal-site-20260606-a/brief.md", kind: "brief" },
      repo: "personal-site",
      source: "brief",
      title: "Refresh home page",
    };

    store.enqueueJob({ item, retryBudget: 2 });

    expect(store.getJob(item.id)?.item).toEqual(item);

    store.close();
  });

  it("stores repo profiles by name for daemon lookup", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock(["2026-06-06T00:00:00.000Z"]),
    });

    store.upsertRepoProfile("web", repoProfile());

    expect(store.getRepoProfile("web")).toMatchObject({
      baseBranch: "develop",
      packageManager: "pnpm",
      path: "/repo",
    });

    store.close();
  });
});

function fixedClock(values: readonly string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? values[0] ?? "";
}

function workItem(id: string): WorkItem {
  return {
    id,
    payload: { kind: "jira", ticketKey: id },
    repo: "web",
    source: "jira",
    title: "Example job",
  };
}

function repoProfile(): RepoProfile {
  return {
    baseBranch: "develop",
    concurrency: 1,
    context: { policyRefs: [], providers: [] },
    contextProviders: [],
    conventions: "repo-local",
    gates: { test: "test" },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
    packageManager: "pnpm",
    path: "/repo",
    portRange: [3000, 3099],
    scope: "external",
    setup: "install",
    intake: { sources: ["jira"] },
    workItemSource: "jira",
  };
}
