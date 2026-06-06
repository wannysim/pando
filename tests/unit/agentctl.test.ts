import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAgentctl } from "../../src/cli/agentctl";
import type { JobEventRecord, JobRecord, JobStore, RetryJobInput } from "../../src/db/index";
import type { RepoProfile, WorkItem } from "../../src/core/types";

describe("runAgentctl", () => {
  it("submits a jira work item", async () => {
    const store = new AgentctlMemoryStore();
    const output: string[] = [];

    const exitCode = await runAgentctl(
      ["submit", "jira", "DEMO-3001", "--repo", "web", "--title", "Demo ticket"],
      { defaultRetryBudget: 5, store, stdout: (line) => output.push(line) },
    );

    expect(exitCode).toBe(0);
    expect(store.jobs.get("DEMO-3001")).toMatchObject({
      attemptsLeft: 5,
      item: {
        id: "DEMO-3001",
        payload: { kind: "jira", ticketKey: "DEMO-3001" },
        repo: "web",
        source: "jira",
        title: "Demo ticket",
      },
      status: "QUEUED",
    });
    expect(output).toEqual(["queued DEMO-3001"]);
  });

  it("uses safe defaults for jira title and retry budget", async () => {
    const store = new AgentctlMemoryStore();

    const exitCode = await runAgentctl(
      ["submit", "jira", "DEMO-3001", "--repo", "web", "--branch", "feat/demo"],
      { store },
    );

    expect(exitCode).toBe(0);
    expect(store.jobs.get("DEMO-3001")).toMatchObject({
      attemptsLeft: 10,
      item: {
        branch: "feat/demo",
        title: "DEMO-3001",
      },
    });
  });

  it("submits a brief work item", async () => {
    const store = new AgentctlMemoryStore();
    const output: string[] = [];

    const exitCode = await runAgentctl(
      [
        "submit",
        "brief",
        "--repo",
        "personal-site",
        "--id",
        "personal-site-20260606-a",
        "--brief-path",
        "briefs/personal-site-20260606-a/brief.md",
      ],
      {
        briefReader: briefReader({
          "briefs/personal-site-20260606-a/brief.md": VALID_BRIEF,
        }),
        store,
        stdout: (line) => output.push(line),
      },
    );

    expect(exitCode).toBe(0);
    expect(store.jobs.get("personal-site-20260606-a")?.item).toMatchObject({
      payload: {
        assets: ["assets/home-reference.png"],
        briefPath: "briefs/personal-site-20260606-a/brief.md",
        kind: "brief",
      },
      title: "Refresh home page",
    });
    expect(output).toEqual(["queued personal-site-20260606-a"]);
  });

  it("uses the conventional brief path when --brief-path is omitted", async () => {
    const store = new AgentctlMemoryStore();

    const exitCode = await runAgentctl(
      ["submit", "brief", "--repo", "personal-site", "--id", "personal-site-20260606-a"],
      {
        briefReader: briefReader({
          "briefs/personal-site-20260606-a/brief.md": VALID_BRIEF,
        }),
        store,
      },
    );

    expect(exitCode).toBe(0);
    expect(store.jobs.get("personal-site-20260606-a")?.item.payload).toMatchObject({
      briefPath: "briefs/personal-site-20260606-a/brief.md",
      kind: "brief",
    });
  });

  it("reads brief files from disk when no test reader is injected", async () => {
    const store = new AgentctlMemoryStore();
    const dir = mkdtempSync(join(tmpdir(), "pando-agentctl-"));
    const briefPath = join(dir, "brief.md");
    writeFileSync(briefPath, VALID_BRIEF);

    const exitCode = await runAgentctl(
      [
        "submit",
        "brief",
        "--repo",
        "personal-site",
        "--id",
        "personal-site-20260606-a",
        "--brief-path",
        briefPath,
      ],
      { store },
    );

    expect(exitCode).toBe(0);
    expect(store.jobs.get("personal-site-20260606-a")?.item.title).toBe("Refresh home page");
  });

  it("reports missing brief files from the default disk reader", async () => {
    const stderr: string[] = [];

    const exitCode = await runAgentctl(
      [
        "submit",
        "brief",
        "--repo",
        "personal-site",
        "--id",
        "missing",
        "--brief-path",
        "/definitely/missing/brief.md",
      ],
      { stderr: (line) => stderr.push(line), store: new AgentctlMemoryStore() },
    );

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["brief not found: /definitely/missing/brief.md"]);
  });

  it("rejects invalid brief files before enqueueing", async () => {
    const store = new AgentctlMemoryStore();
    const stderr: string[] = [];

    const exitCode = await runAgentctl(
      ["submit", "brief", "--repo", "personal-site", "--id", "personal-site-20260606-a"],
      {
        briefReader: briefReader({
          "briefs/personal-site-20260606-a/brief.md": "# Missing sections\n",
        }),
        stderr: (line) => stderr.push(line),
        store,
      },
    );

    expect(exitCode).toBe(1);
    expect(store.jobs.size).toBe(0);
    expect(stderr.join("\n")).toContain("brief.md must contain a Goal section");
  });

  it("shows job status and event history", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3002"), retryBudget: 2 });
    store.updateJobStatus({ attemptsLeft: 1, jobId: "DEMO-3002", status: "IMPL" });
    store.appendEvent({
      jobId: "DEMO-3002",
      reason: "test gate passed",
      stage: "TEST",
      type: "stage-pass",
    });
    store.appendEvent({
      jobId: "DEMO-3002",
      type: "heartbeat",
    });
    const output: string[] = [];

    const exitCode = await runAgentctl(["show", "DEMO-3002"], {
      store,
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      "DEMO-3002 IMPL repo=web attemptsLeft=1",
      "#1 TEST stage-pass test gate passed",
      "#2 - heartbeat",
    ]);
  });

  it("renders telemetry details in job event history", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3010"), retryBudget: 2 });
    store.updateJobStatus({ attemptsLeft: 1, jobId: "DEMO-3010", status: "FAILED" });
    store.appendEvent({
      jobId: "DEMO-3010",
      payload: { durationMs: 250, engine: "codex", model: "impl-model" },
      stage: "IMPL",
      type: "stage-completed",
    });
    store.appendEvent({
      jobId: "DEMO-3010",
      payload: { costUsd: 0.125, engine: "codex", model: "impl-model" },
      stage: "IMPL",
      type: "worker-cost",
    });
    store.appendEvent({
      evidence: '{"changed":["src/example.test.ts"]}',
      jobId: "DEMO-3010",
      payload: {
        durationMs: 40,
        evidence: '{"changed":["src/example.test.ts"]}',
        failureKind: "gate-fail",
        gateName: "checksum",
        reason: "test checksum changed",
      },
      reason: "test checksum changed",
      stage: "IMPL",
      type: "stage-failed",
    });
    const output: string[] = [];

    const exitCode = await runAgentctl(["show", "DEMO-3010"], {
      store,
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      "DEMO-3010 FAILED repo=web attemptsLeft=1",
      "#1 IMPL stage-completed durationMs=250 engine=codex model=impl-model",
      "#2 IMPL worker-cost costUsd=0.125 engine=codex model=impl-model",
      '#3 IMPL stage-failed reason="test checksum changed" evidence="{\\"changed\\":[\\"src/example.test.ts\\"]}" durationMs=40 failureKind=gate-fail gateName=checksum',
    ]);
  });

  it("returns a non-zero exit code when a job is missing", async () => {
    const stderr: string[] = [];

    const exitCode = await runAgentctl(["show", "DEMO-404"], {
      stderr: (line) => stderr.push(line),
      store: new AgentctlMemoryStore(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["job not found: DEMO-404"]);
  });

  it("retries a terminal job from the requested stage", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3003"), retryBudget: 1 });
    store.updateJobStatus({ attemptsLeft: 0, jobId: "DEMO-3003", status: "FAILED" });
    const output: string[] = [];

    const exitCode = await runAgentctl(
      ["retry", "DEMO-3003", "--from", "IMPL", "--attempts", "4"],
      { store, stdout: (line) => output.push(line) },
    );

    expect(exitCode).toBe(0);
    expect(store.retries).toEqual([{ attemptsLeft: 4, from: "IMPL", jobId: "DEMO-3003" }]);
    expect(output).toEqual(["retry queued DEMO-3003 from IMPL"]);
  });

  it("cancels queued jobs from the CLI", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3004"), retryBudget: 2 });
    const output: string[] = [];

    const exitCode = await runAgentctl(["cancel", "DEMO-3004"], {
      store,
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(store.jobs.get("DEMO-3004")).toMatchObject({
      status: "CANCELED",
    });
    expect(store.listEvents("DEMO-3004").map((event) => event.type)).toEqual([
      "cancel-requested",
      "canceled",
    ]);
    expect(output).toEqual(["canceled DEMO-3004"]);
  });

  it("stores running cancel requests from the CLI", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3005"), retryBudget: 2 });
    store.updateJobStatus({ attemptsLeft: 2, jobId: "DEMO-3005", status: "IMPL" });
    const output: string[] = [];

    const exitCode = await runAgentctl(["cancel", "DEMO-3005"], {
      store,
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(store.jobs.get("DEMO-3005")).toMatchObject({
      cancelRequestedAt: "2026-06-06T00:00:00.000Z",
      status: "IMPL",
    });
    expect(store.listEvents("DEMO-3005").at(-1)).toMatchObject({
      payload: { previousStatus: "IMPL", requestedBy: "agentctl" },
      status: "IMPL",
      type: "cancel-requested",
    });
    expect(output).toEqual(["cancel requested DEMO-3005"]);
  });

  it("cleans up terminal job worktrees from the CLI", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3006"), retryBudget: 1 });
    store.updateJobStatus({
      attemptsLeft: 1,
      jobId: "DEMO-3006",
      status: "DONE",
      worktreePath: "/worktrees/web/feat-DEMO-3006",
    });
    const cleaned: string[] = [];
    const output: string[] = [];

    const exitCode = await runAgentctl(["cleanup", "DEMO-3006"], {
      store,
      stdout: (line) => output.push(line),
      worktreeCleaner: {
        async cleanup(input) {
          cleaned.push(`${input.jobId}:${input.worktreePath}`);
        },
      },
    });

    expect(exitCode).toBe(0);
    expect(cleaned).toEqual(["DEMO-3006:/worktrees/web/feat-DEMO-3006"]);
    expect(store.jobs.get("DEMO-3006")).toMatchObject({
      status: "DONE",
      worktreePath: undefined,
    });
    expect(store.listEvents("DEMO-3006").map((event) => event.type)).toEqual([
      "cleanup-requested",
      "cleanup-completed",
    ]);
    expect(output).toEqual(["cleaned up DEMO-3006 /worktrees/web/feat-DEMO-3006"]);
  });

  it("records cleanup failures from the CLI", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3007"), retryBudget: 1 });
    store.updateJobStatus({
      attemptsLeft: 0,
      jobId: "DEMO-3007",
      status: "FAILED",
      worktreePath: "/worktrees/web/feat-DEMO-3007",
    });
    const stderr: string[] = [];

    const exitCode = await runAgentctl(["cleanup", "DEMO-3007"], {
      stderr: (line) => stderr.push(line),
      store,
      worktreeCleaner: {
        async cleanup() {
          throw new Error("remove failed");
        },
      },
    });

    expect(exitCode).toBe(1);
    expect(store.jobs.get("DEMO-3007")?.worktreePath).toBe("/worktrees/web/feat-DEMO-3007");
    expect(store.listEvents("DEMO-3007").at(-1)).toMatchObject({
      reason: "remove failed",
      type: "cleanup-failed",
    });
    expect(stderr).toEqual(["remove failed"]);
  });

  it("rejects invalid retry stages and malformed numeric options", async () => {
    const stderr: string[] = [];

    await expect(
      runAgentctl(["retry", "DEMO-3008", "--from", "UNKNOWN"], {
        stderr: (line) => stderr.push(line),
        store: new AgentctlMemoryStore(),
      }),
    ).resolves.toBe(1);
    await expect(
      runAgentctl(["submit", "jira", "DEMO-3008", "--repo", "web", "--attempts", "0"], {
        stderr: (line) => stderr.push(line),
        store: new AgentctlMemoryStore(),
      }),
    ).resolves.toBe(1);

    expect(stderr).toEqual([
      "--from: expected one of SPEC, PLAN, TEST, IMPL, REVIEW, PR",
      "--attempts: expected positive integer",
    ]);
  });

  it("prints usage for unknown commands and rejects missing option values", async () => {
    const stderr: string[] = [];

    await expect(
      runAgentctl(["list"], {
        stderr: (line) => stderr.push(line),
        store: new AgentctlMemoryStore(),
      }),
    ).resolves.toBe(1);
    await expect(
      runAgentctl(["submit", "jira", "DEMO-3005", "--repo"], {
        stderr: (line) => stderr.push(line),
        store: new AgentctlMemoryStore(),
      }),
    ).resolves.toBe(1);

    expect(stderr[0]).toContain("agentctl submit jira");
    expect(stderr[1]).toBe("--repo: expected value");
  });
});

class AgentctlMemoryStore implements JobStore {
  readonly events = new Map<string, JobEventRecord[]>();
  readonly jobs = new Map<string, JobRecord>();
  readonly retries: RetryJobInput[] = [];
  private now = "2026-06-06T00:00:00.000Z";

  enqueueJob(input: Parameters<JobStore["enqueueJob"]>[0]): JobRecord {
    const job: JobRecord = {
      attemptsLeft: input.retryBudget,
      createdAt: "2026-06-06T00:00:00.000Z",
      item: input.item,
      status: "QUEUED",
      updatedAt: "2026-06-06T00:00:00.000Z",
    };
    this.jobs.set(input.item.id, job);
    return job;
  }

  claimNextRunnable(): JobRecord | undefined {
    return undefined;
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  updateJobStatus(input: Parameters<JobStore["updateJobStatus"]>[0]): JobRecord {
    const job = this.requiredJob(input.jobId);
    const updated: JobRecord = {
      ...job,
      attemptsLeft: input.attemptsLeft,
      status: input.status,
      worktreePath: input.worktreePath ?? job.worktreePath,
    };
    this.jobs.set(input.jobId, updated);
    return updated;
  }

  retryJob(input: RetryJobInput): JobRecord {
    this.retries.push(input);
    return this.updateJobStatus({
      attemptsLeft: input.attemptsLeft,
      jobId: input.jobId,
      status: input.from,
    });
  }

  cancelJob(input: { jobId: string; reason?: string; requestedBy?: string }): JobRecord {
    const job = this.requiredJob(input.jobId);
    const payload = {
      previousStatus: job.status,
      reason: input.reason,
      requestedBy: input.requestedBy,
    };
    this.appendEvent({
      jobId: input.jobId,
      payload,
      status: job.status,
      type: "cancel-requested",
    });
    if (job.status === "QUEUED") {
      const canceled = {
        ...job,
        status: "CANCELED" as const,
      };
      this.jobs.set(input.jobId, canceled);
      this.appendEvent({
        jobId: input.jobId,
        payload,
        status: "CANCELED",
        type: "canceled",
      });
      return canceled;
    }

    const requested = {
      ...job,
      cancelRequestedAt: this.now,
    };
    this.jobs.set(input.jobId, requested);
    return requested;
  }

  listCancelRequestedJobs(): JobRecord[] {
    return [...this.jobs.values()].filter((job) => job.cancelRequestedAt !== undefined);
  }

  completeJobCancellation(input: { jobId: string; stoppedBy?: string }): JobRecord {
    const job = this.requiredJob(input.jobId);
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

  requestJobCleanup(input: { jobId: string; requestedBy?: string }): {
    job: JobRecord;
    worktreePath: string;
  } {
    const job = this.requiredJob(input.jobId);
    if (!["DONE", "FAILED", "ESCALATED", "CANCELED"].includes(job.status)) {
      throw new Error(`job ${input.jobId} is not terminal: ${job.status}`);
    }
    if (job.worktreePath === undefined) {
      throw new Error(`job ${input.jobId} has no worktree path to cleanup`);
    }
    this.appendEvent({
      jobId: input.jobId,
      payload: {
        requestedBy: input.requestedBy,
        status: job.status,
        worktreePath: job.worktreePath,
      },
      status: job.status,
      type: "cleanup-requested",
    });
    return { job, worktreePath: job.worktreePath };
  }

  completeJobCleanup(input: { jobId: string; worktreePath: string }): JobRecord {
    const job = this.requiredJob(input.jobId);
    const cleaned = { ...job, worktreePath: undefined };
    this.jobs.set(input.jobId, cleaned);
    this.appendEvent({
      jobId: input.jobId,
      payload: { worktreePath: input.worktreePath },
      status: job.status,
      type: "cleanup-completed",
    });
    return cleaned;
  }

  failJobCleanup(input: {
    evidence?: string;
    jobId: string;
    reason: string;
    worktreePath: string;
  }): JobRecord {
    const job = this.requiredJob(input.jobId);
    this.appendEvent({
      evidence: input.evidence,
      jobId: input.jobId,
      payload: { worktreePath: input.worktreePath },
      reason: input.reason,
      status: job.status,
      type: "cleanup-failed",
    });
    return job;
  }

  appendEvent(input: Parameters<JobStore["appendEvent"]>[0]): JobEventRecord {
    const events = this.events.get(input.jobId) ?? [];
    const event: JobEventRecord = {
      createdAt: "2026-06-06T00:00:00.000Z",
      evidence: input.evidence,
      gateName: input.gateName,
      jobId: input.jobId,
      payload: input.payload ?? {},
      reason: input.reason,
      sequence: events.length + 1,
      stage: input.stage,
      status: input.status,
      type: input.type,
    };
    this.events.set(input.jobId, [...events, event]);
    return event;
  }

  listEvents(jobId: string): JobEventRecord[] {
    return this.events.get(jobId) ?? [];
  }

  upsertRepoProfile(): void {}

  getRepoProfile(): RepoProfile | undefined {
    return undefined;
  }

  close(): void {}

  private requiredJob(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`job not found: ${jobId}`);
    return job;
  }
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

const VALID_BRIEF = `# Refresh home page

## Goal

Make the home page clearer.

## User Story

As a visitor, I want to understand the offer quickly.

## Acceptance Criteria

- [ ] The hero names the offer.

## Screens or Behavior

Show a compact hero and contact CTA.

## Non-Goals

- Do not migrate blog posts.

## Assets

- assets/home-reference.png

## Open Questions

- None
`;

function briefReader(files: Record<string, string>) {
  return {
    async readText(path: string) {
      return files[path];
    },
  };
}
