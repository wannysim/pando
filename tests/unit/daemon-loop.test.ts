import { describe, expect, it } from "vitest";
import type { JobEventRecord, JobRecord, JobStore, UpdateJobStatusInput } from "../../src/db/index";
import { branchForItem, runDaemonOnce } from "../../src/daemon/loop";
import { createRunScheduler } from "../../src/scheduler/scheduler";
import type {
  JobStatus,
  RepoProfile,
  WorkItem,
  WorkerEngine,
  WorkerResult,
} from "../../src/core/types";
import type { StageConfig } from "../../src/core/stage-config";

describe("runDaemonOnce", () => {
  it("claims one job, provisions a worktree, runs the pipeline, and persists the final status", async () => {
    const item = workItem("DEMO-2001");
    const store = new MemoryJobStore(jobRecord(item, "SPEC", 3));
    const ensured: string[] = [];

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          ensured.push(`${input.item.id}:${input.branch}:${input.profile.baseBranch}`);
          return { branch: input.branch, path: "/worktrees/web/feat-DEMO-2001" };
        },
      },
    });

    expect(result).toEqual({
      finalStatus: "DONE",
      jobId: "DEMO-2001",
      status: "ran",
    });
    expect(ensured).toEqual(["DEMO-2001:feat/DEMO-2001:develop"]);
    expect(store.job?.status).toBe("DONE");
    expect(store.job?.worktreePath).toBe("/worktrees/web/feat-DEMO-2001");
    expect(store.events.map((event) => event.type)).toContain("engine-pass");
    expect(store.updates.at(-1)).toMatchObject({ status: "DONE" });
  });

  it("persists structured telemetry payloads emitted by the pipeline runner", async () => {
    const item = workItem("DEMO-2005");
    const store = new MemoryJobStore(jobRecord(item, "IMPL", 3));

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      runner: async (runnerOpts) => {
        await runnerOpts.onEvent?.({
          payload: { durationMs: 125, engine: "codex", model: "impl-model" },
          stage: "IMPL",
          type: "stage-completed",
        } as never);
        await runnerOpts.onEvent?.({
          payload: { costUsd: 0.35, engine: "codex", model: "impl-model" },
          stage: "IMPL",
          type: "worker-cost",
        } as never);
        return { events: [], final: { attemptsLeft: 3, status: "DONE" } };
      },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          return { branch: input.branch, path: "/worktrees/web/feat-DEMO-2005" };
        },
      },
    });

    expect(result).toEqual({
      finalStatus: "DONE",
      jobId: "DEMO-2005",
      status: "ran",
    });
    expect(store.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: { durationMs: 125, engine: "codex", model: "impl-model" },
          stage: "IMPL",
          type: "stage-completed",
        }),
        expect.objectContaining({
          payload: { costUsd: 0.35, engine: "codex", model: "impl-model" },
          stage: "IMPL",
          type: "worker-cost",
        }),
      ]),
    );
  });

  it("returns idle when no runnable job exists", async () => {
    const store = new MemoryJobStore(undefined);

    await expect(
      runDaemonOnce({
        engines: {
          "claude-code": engine("claude-code"),
          codex: engine("codex"),
        },
        profiles: { web: repoProfile() },
        stageConfig: stageConfig(),
        store,
        worktrees: {
          async ensure() {
            throw new Error("should not provision worktree");
          },
        },
      }),
    ).resolves.toEqual({ status: "idle" });
  });

  it("marks the job failed when worktree provisioning fails", async () => {
    const item = workItem("DEMO-2002");
    const store = new MemoryJobStore(jobRecord(item, "SPEC", 2));

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure() {
          throw new Error("git fetch failed");
        },
      },
    });

    expect(result).toEqual({
      finalStatus: "FAILED",
      jobId: "DEMO-2002",
      status: "failed",
    });
    expect(store.job?.status).toBe("FAILED");
    expect(store.events.at(-1)).toMatchObject({
      evidence: "git fetch failed",
      type: "daemon-error",
    });
  });

  it("marks the job failed when the repo profile cannot be resolved", async () => {
    const item = { ...workItem("DEMO-2003"), repo: "missing" };
    const store = new MemoryJobStore(jobRecord(item, "SPEC", 2));

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure() {
          throw new Error("should not provision worktree");
        },
      },
    });

    expect(result).toEqual({
      finalStatus: "FAILED",
      jobId: "DEMO-2003",
      status: "failed",
    });
    expect(store.events.at(-1)).toMatchObject({
      evidence: "repo profile not found: missing",
      type: "daemon-error",
    });
  });

  it("persists the final state when a custom runner does not emit state changes", async () => {
    const item = workItem("DEMO-2004");
    const store = new MemoryJobStore(jobRecord(item, "SPEC", 2));

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      runner: async () => ({ events: [], final: { attemptsLeft: 2, status: "DONE" } }),
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          return { branch: input.branch, path: "/worktrees/web/feat-DEMO-2004" };
        },
      },
    });

    expect(result).toEqual({
      finalStatus: "DONE",
      jobId: "DEMO-2004",
      status: "ran",
    });
    expect(store.updates.at(-1)).toMatchObject({ status: "DONE" });
  });

  it("starts multiple jobs up to the scheduler cap without reclaiming in-flight jobs", async () => {
    const first = workItem("DEMO-2101");
    const second = workItem("DEMO-2102");
    const third = workItem("DEMO-2103");
    const store = new QueueJobStore([
      jobRecord(first, "QUEUED", 2),
      jobRecord(second, "QUEUED", 2),
      jobRecord(third, "QUEUED", 2),
    ]);
    const started: string[] = [];
    let running = 0;
    let maxRunning = 0;

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile({ concurrency: 2 }) },
      runner: async (runnerOpts) => {
        started.push(runnerOpts.item.id);
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running -= 1;
        return { events: [], final: { attemptsLeft: 2, status: "DONE" } };
      },
      scheduler: createRunScheduler({
        globalConcurrency: 2,
        providerConcurrency: {},
      }),
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          return {
            branch: input.branch,
            isolation: input.isolation,
            path: `/worktrees/web/${input.item.id}`,
          };
        },
      },
    });

    expect(result).toEqual({
      jobs: [
        { finalStatus: "DONE", jobId: "DEMO-2101", status: "ran" },
        { finalStatus: "DONE", jobId: "DEMO-2102", status: "ran" },
      ],
      status: "ran",
    });
    expect(started).toEqual(["DEMO-2101", "DEMO-2102"]);
    expect(maxRunning).toBe(2);
    expect(store.getJob("DEMO-2103")?.status).toBe("QUEUED");
  });

  it("passes per-job worktree isolation into the pipeline runner", async () => {
    const item = workItem("DEMO-2201");
    const isolation = {
      cacheDir: "/worktrees/.cache/web/feat-DEMO-2201",
      env: {
        PANDO_ASSIGNED_PORT: "3001",
        PANDO_CACHE_DIR: "/worktrees/.cache/web/feat-DEMO-2201",
        PANDO_JOB_ID: "DEMO-2201",
        PORT: "3001",
        XDG_CACHE_HOME: "/worktrees/.cache/web/feat-DEMO-2201",
      },
      port: 3001,
    };
    const store = new MemoryJobStore(jobRecord(item, "SPEC", 2));
    const runnerEnv: Record<string, string>[] = [];

    await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile({ concurrency: 1 }) },
      runner: async (runnerOpts) => {
        runnerEnv.push(runnerOpts.env ?? {});
        return { events: [], final: { attemptsLeft: 2, status: "DONE" } };
      },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure() {
          return {
            branch: "feat/DEMO-2201",
            isolation,
            path: "/worktrees/web/feat-DEMO-2201",
          };
        },
      },
    });

    expect(runnerEnv).toEqual([isolation.env]);
  });

  it("sends stop requests for cancel-requested active jobs without running the pipeline", async () => {
    const item = workItem("DEMO-2301");
    const store = new MemoryJobStore({
      ...jobRecord(item, "IMPL", 2),
      cancelRequestedAt: "2026-06-06T00:00:01.000Z",
      worktreePath: "/worktrees/web/feat-DEMO-2301",
    });
    const stopRequests: Array<{
      jobId: string;
      status: JobStatus;
      worktreePath?: string;
    }> = [];

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      runner: async () => {
        throw new Error("cancel-requested jobs must not run the pipeline");
      },
      runningJobs: {
        async requestStop(input) {
          stopRequests.push({
            jobId: input.job.item.id,
            status: input.job.status,
            worktreePath: input.job.worktreePath,
          });
        },
      },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure() {
          throw new Error("cancel-requested jobs must not provision worktrees");
        },
      },
    });

    expect(result).toEqual({
      finalStatus: "CANCELED",
      jobId: "DEMO-2301",
      status: "canceled",
    });
    expect(stopRequests).toEqual([
      {
        jobId: "DEMO-2301",
        status: "IMPL",
        worktreePath: "/worktrees/web/feat-DEMO-2301",
      },
    ]);
    expect(store.job?.status).toBe("CANCELED");
    expect(store.events.at(-1)).toMatchObject({
      payload: { stoppedBy: "daemon" },
      status: "CANCELED",
      type: "canceled",
    });
  });

  it("cancels a running job when the pipeline reports cooperative cancellation", async () => {
    const item = workItem("DEMO-2401");
    const store = new MemoryJobStore(jobRecord(item, "SPEC", 3));
    let sawCancelHook = false;

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      runner: async (runnerOpts) => {
        sawCancelHook = typeof runnerOpts.shouldCancel === "function";
        return { canceled: true, events: [], final: { attemptsLeft: 3, status: "SPEC" } };
      },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          return { branch: input.branch, path: "/worktrees/web/feat-DEMO-2401" };
        },
      },
    });

    expect(sawCancelHook).toBe(true);
    expect(result).toEqual({ finalStatus: "CANCELED", jobId: "DEMO-2401", status: "canceled" });
    expect(store.job?.status).toBe("CANCELED");
    expect(store.events.at(-1)).toMatchObject({ status: "CANCELED", type: "canceled" });
  });

  it("aborts the in-flight worker when a cancel arrives mid-run", async () => {
    const item = workItem("DEMO-2402");
    const store = new MemoryJobStore(jobRecord(item, "SPEC", 3));

    const result = await runDaemonOnce({
      cancellationWatchMs: 5,
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile() },
      runner: async (runnerOpts) => {
        // Simulate a cancel request landing while the worker is running.
        store.job = { ...store.job!, cancelRequestedAt: "2026-06-06T00:00:01.000Z" };
        await new Promise<void>((resolve) => {
          if (runnerOpts.signal?.aborted === true) return resolve();
          runnerOpts.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { canceled: true, events: [], final: { attemptsLeft: 3, status: "SPEC" } };
      },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          return { branch: input.branch, path: "/worktrees/web/feat-DEMO-2402" };
        },
      },
    });

    expect(result).toEqual({ finalStatus: "CANCELED", jobId: "DEMO-2402", status: "canceled" });
    expect(store.job?.status).toBe("CANCELED");
  });

  it("resumes a persisted active stage once after a crash", async () => {
    const item = workItem("DEMO-2302");
    const store = new QueueJobStore([jobRecord(item, "IMPL", 2)]);
    const initialStates: string[] = [];
    const ensured: string[] = [];

    const result = await runDaemonOnce({
      engines: {
        "claude-code": engine("claude-code"),
        codex: engine("codex"),
      },
      profiles: { web: repoProfile({ concurrency: 2 }) },
      runner: async (runnerOpts) => {
        initialStates.push(`${runnerOpts.item.id}:${runnerOpts.initialState?.status}`);
        return { events: [], final: { attemptsLeft: 2, status: "DONE" } };
      },
      scheduler: createRunScheduler({
        globalConcurrency: 2,
        providerConcurrency: {},
      }),
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          ensured.push(input.item.id);
          return {
            branch: input.branch,
            path: "/worktrees/web/feat-DEMO-2302",
          };
        },
      },
    });

    expect(result).toEqual({
      jobs: [{ finalStatus: "DONE", jobId: "DEMO-2302", status: "ran" }],
      status: "ran",
    });
    expect(ensured).toEqual(["DEMO-2302"]);
    expect(initialStates).toEqual(["DEMO-2302:IMPL"]);
  });

  it("derives stable default branches and respects explicit branches", () => {
    expect(branchForItem(workItem("DEMO 2004/part A"))).toBe("feat/DEMO-2004-part-A");
    expect(branchForItem({ ...workItem("DEMO-2004"), branch: "fix/custom" })).toBe("fix/custom");
  });
});

class MemoryJobStore implements JobStore {
  readonly events: JobEventRecord[] = [];
  readonly updates: UpdateJobStatusInput[] = [];

  constructor(public job: JobRecord | undefined) {}

  enqueueJob(): JobRecord {
    throw new Error("not used");
  }

  listJobs(input?: Parameters<JobStore["listJobs"]>[0]): JobRecord[] {
    if (this.job === undefined) return [];
    if (input?.status !== undefined && this.job.status !== input.status) return [];
    return [this.job];
  }

  claimNextRunnable(): JobRecord | undefined {
    if (this.job?.cancelRequestedAt !== undefined) return undefined;
    return this.job;
  }

  getJob(): JobRecord | undefined {
    return this.job;
  }

  updateJobStatus(input: UpdateJobStatusInput): JobRecord {
    if (this.job === undefined) throw new Error("job not found");
    this.updates.push(input);
    this.job = {
      ...this.job,
      attemptsLeft: input.attemptsLeft,
      status: input.status,
      worktreePath: input.worktreePath ?? this.job.worktreePath,
    };
    return this.job;
  }

  retryJob(): JobRecord {
    throw new Error("not used");
  }

  cancelJob(): JobRecord {
    throw new Error("not used");
  }

  listCancelRequestedJobs(): JobRecord[] {
    return this.job?.cancelRequestedAt === undefined ? [] : [this.job];
  }

  completeJobCancellation(input: { jobId: string; stoppedBy?: string }): JobRecord {
    if (this.job === undefined) throw new Error("job not found");
    this.job = { ...this.job, status: "CANCELED" };
    this.appendEvent({
      jobId: input.jobId,
      payload: { stoppedBy: input.stoppedBy },
      status: "CANCELED",
      type: "canceled",
    });
    return this.job;
  }

  requestJobCleanup(): { job: JobRecord; worktreePath: string } {
    throw new Error("not used");
  }

  completeJobCleanup(): JobRecord {
    throw new Error("not used");
  }

  failJobCleanup(): JobRecord {
    throw new Error("not used");
  }

  appendEvent(input: Parameters<JobStore["appendEvent"]>[0]): JobEventRecord {
    const event: JobEventRecord = {
      createdAt: "2026-06-06T00:00:00.000Z",
      evidence: input.evidence,
      gateName: input.gateName,
      jobId: input.jobId,
      payload: input.payload ?? {},
      reason: input.reason,
      sequence: this.events.length + 1,
      stage: input.stage,
      status: input.status,
      type: input.type,
    };
    this.events.push(event);
    return event;
  }

  listEvents(): JobEventRecord[] {
    return this.events;
  }

  upsertRepoProfile(): void {}

  getRepoProfile(): RepoProfile | undefined {
    return undefined;
  }

  close(): void {}
}

class QueueJobStore implements JobStore {
  readonly events: JobEventRecord[] = [];
  readonly updates: UpdateJobStatusInput[] = [];
  private readonly jobs = new Map<string, JobRecord>();

  constructor(jobs: readonly JobRecord[]) {
    for (const job of jobs) this.jobs.set(job.item.id, job);
  }

  enqueueJob(): JobRecord {
    throw new Error("not used");
  }

  listJobs(input?: Parameters<JobStore["listJobs"]>[0]): JobRecord[] {
    return [...this.jobs.values()].filter(
      (job) => input?.status === undefined || job.status === input.status,
    );
  }

  claimNextRunnable(input?: { excludeJobIds?: readonly string[] }): JobRecord | undefined {
    const excluded = new Set(input?.excludeJobIds ?? []);
    const active = [...this.jobs.values()].find(
      (job) =>
        isActive(job.status) && job.cancelRequestedAt === undefined && !excluded.has(job.item.id),
    );
    if (active !== undefined) return active;

    const queued = [...this.jobs.values()].find(
      (job) => job.status === "QUEUED" && !excluded.has(job.item.id),
    );
    if (queued === undefined) return undefined;
    return this.updateJobStatus({
      attemptsLeft: queued.attemptsLeft,
      jobId: queued.item.id,
      status: "SPEC",
      worktreePath: queued.worktreePath,
    });
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  updateJobStatus(input: UpdateJobStatusInput): JobRecord {
    const job = this.jobs.get(input.jobId);
    if (job === undefined) throw new Error("job not found");
    this.updates.push(input);
    const next = {
      ...job,
      attemptsLeft: input.attemptsLeft,
      status: input.status,
      worktreePath: input.worktreePath ?? job.worktreePath,
    };
    this.jobs.set(input.jobId, next);
    return next;
  }

  retryJob(): JobRecord {
    throw new Error("not used");
  }

  cancelJob(): JobRecord {
    throw new Error("not used");
  }

  listCancelRequestedJobs(): JobRecord[] {
    return [...this.jobs.values()].filter((job) => job.cancelRequestedAt !== undefined);
  }

  completeJobCancellation(input: { jobId: string; stoppedBy?: string }): JobRecord {
    const job = this.jobs.get(input.jobId);
    if (job === undefined) throw new Error("job not found");
    const canceled = { ...job, status: "CANCELED" as const };
    this.jobs.set(input.jobId, canceled);
    this.appendEvent({
      jobId: input.jobId,
      payload: { stoppedBy: input.stoppedBy },
      status: "CANCELED",
      type: "canceled",
    });
    return canceled;
  }

  requestJobCleanup(): { job: JobRecord; worktreePath: string } {
    throw new Error("not used");
  }

  completeJobCleanup(): JobRecord {
    throw new Error("not used");
  }

  failJobCleanup(): JobRecord {
    throw new Error("not used");
  }

  appendEvent(input: Parameters<JobStore["appendEvent"]>[0]): JobEventRecord {
    const event: JobEventRecord = {
      createdAt: "2026-06-06T00:00:00.000Z",
      evidence: input.evidence,
      gateName: input.gateName,
      jobId: input.jobId,
      payload: input.payload ?? {},
      reason: input.reason,
      sequence: this.events.length + 1,
      stage: input.stage,
      status: input.status,
      type: input.type,
    };
    this.events.push(event);
    return event;
  }

  listEvents(): JobEventRecord[] {
    return this.events;
  }

  upsertRepoProfile(): void {}

  getRepoProfile(): RepoProfile | undefined {
    return undefined;
  }

  close(): void {}
}

function engine(name: WorkerEngine["name"]): WorkerEngine {
  return {
    name,
    async run(): Promise<WorkerResult> {
      return { ok: true, output: "ok" };
    },
  };
}

function stageConfig(): StageConfig {
  return {
    defaults: { retryBudget: 3, timeoutMinutes: 30 },
    stages: {
      impl: { engine: "codex", model: "gpt-5-codex" },
      plan: { engine: "claude-code", model: "opus", skill: "implement-jira" },
      pr: { engine: "claude-code", model: "sonnet", skill: "create-pr" },
      review: { engine: "claude-code", model: "opus", skill: "verifier" },
      spec: { engine: "claude-code", model: "sonnet" },
      test: { engine: "codex", model: "gpt-5-codex", skill: "test-writer" },
    },
  };
}

function workItem(id: string): WorkItem {
  return {
    id,
    payload: { kind: "jira", ticketKey: id },
    repo: "web",
    source: "jira",
    title: "Example",
  };
}

function jobRecord(item: WorkItem, status: JobStatus, attemptsLeft: number): JobRecord {
  return {
    attemptsLeft,
    createdAt: "2026-06-06T00:00:00.000Z",
    item,
    status,
    updatedAt: "2026-06-06T00:00:00.000Z",
  };
}

function repoProfile(opts?: { concurrency?: number }): RepoProfile {
  return {
    baseBranch: "develop",
    concurrency: opts?.concurrency ?? 1,
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

function isActive(status: JobStatus): boolean {
  return ["SPEC", "PLAN", "TEST", "IMPL", "REVIEW", "PR"].includes(status);
}
