import { describe, expect, it } from "vitest";
import type { JobEventRecord, JobRecord, JobStore, UpdateJobStatusInput } from "../../src/db/index";
import { branchForItem, runDaemonOnce } from "../../src/daemon/loop";
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

  claimNextRunnable(): JobRecord | undefined {
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
