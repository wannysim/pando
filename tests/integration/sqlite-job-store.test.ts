import { describe, expect, it } from "vitest";
import { createSqliteJobStore } from "../../src/db/index.js";
import type { RepoProfile, WorkItem } from "../../src/core/types.js";

describe("SqliteJobStore", () => {
  it("enqueues jobs and claims exactly one runnable job", () => {
    const store = createSqliteJobStore({
      path: ":memory:",
      now: fixedClock([
        "2026-06-06T00:00:00.000Z",
        "2026-06-06T00:00:01.000Z",
      ]),
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
    contextProviders: [],
    conventions: "repo-local",
    gates: { test: "test" },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
    packageManager: "pnpm",
    path: "/repo",
    portRange: [3000, 3099],
    scope: "external",
    setup: "install",
    workItemSource: "jira",
  };
}
