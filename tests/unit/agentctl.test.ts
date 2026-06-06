import { describe, expect, it } from "vitest";
import { runAgentctl } from "../../src/cli/agentctl.js";
import type {
  JobEventRecord,
  JobRecord,
  JobStore,
  RetryJobInput,
} from "../../src/db/index.js";
import type { RepoProfile, WorkItem } from "../../src/core/types.js";

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
        "--title",
        "Refresh home page",
        "--brief-path",
        "briefs/personal-site-20260606-a/brief.md",
      ],
      { store, stdout: (line) => output.push(line) },
    );

    expect(exitCode).toBe(0);
    expect(store.jobs.get("personal-site-20260606-a")?.item.payload).toEqual({
      briefPath: "briefs/personal-site-20260606-a/brief.md",
      kind: "brief",
    });
    expect(output).toEqual(["queued personal-site-20260606-a"]);
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
    expect(store.retries).toEqual([
      { attemptsLeft: 4, from: "IMPL", jobId: "DEMO-3003" },
    ]);
    expect(output).toEqual(["retry queued DEMO-3003 from IMPL"]);
  });

  it("rejects invalid retry stages and malformed numeric options", async () => {
    const stderr: string[] = [];

    await expect(
      runAgentctl(["retry", "DEMO-3004", "--from", "UNKNOWN"], {
        stderr: (line) => stderr.push(line),
        store: new AgentctlMemoryStore(),
      }),
    ).resolves.toBe(1);
    await expect(
      runAgentctl(["submit", "jira", "DEMO-3004", "--repo", "web", "--attempts", "0"], {
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
