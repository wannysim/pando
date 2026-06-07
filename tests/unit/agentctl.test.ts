import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentctlDbPathFromEnv, runAgentctl } from "../../src/cli/agentctl";
import type { PandoApiClient } from "../../src/api/client";
import type { ApiHealth, ApiJobSummary } from "../../src/api/schema";
import type { JobEventRecord, JobRecord, JobStore, RetryJobInput } from "../../src/db/index";
import type { JobStatus, RepoProfile, WorkItem } from "../../src/core/types";

describe("runAgentctl", () => {
  it("defaults local DB access to tmp instead of creating pando.sqlite in cwd", () => {
    expect(agentctlDbPathFromEnv({})).toBe("/tmp/pando.sqlite");
    expect(agentctlDbPathFromEnv({ PANDO_DB: "" })).toBe("/tmp/pando.sqlite");
    expect(agentctlDbPathFromEnv({ PANDO_DB: "/data/pando.sqlite" })).toBe("/data/pando.sqlite");
  });

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

  it("maps --fix-version and --base-branch onto the jira work item", async () => {
    const store = new AgentctlMemoryStore();

    const exitCode = await runAgentctl(
      [
        "submit",
        "jira",
        "DEMO-3001",
        "--repo",
        "web",
        "--fix-version",
        "1.0",
        "--base-branch",
        "release/9.9",
      ],
      { store },
    );

    expect(exitCode).toBe(0);
    expect(store.jobs.get("DEMO-3001")).toMatchObject({
      item: {
        baseBranch: "release/9.9",
        payload: { fixVersion: "1.0", kind: "jira", ticketKey: "DEMO-3001" },
      },
    });
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
      "DEMO-3002 IMPL repo=web branch=- title=Example worktreePath=- attemptsLeft=1 startedAt=- cancelRequestedAt=-",
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
      "DEMO-3010 FAILED repo=web branch=- title=Example worktreePath=- attemptsLeft=1 startedAt=- cancelRequestedAt=-",
      'failure: IMPL reason="test checksum changed" evidence="{\\"changed\\":[\\"src/example.test.ts\\"]}"',
      "#1 IMPL stage-completed durationMs=250 engine=codex model=impl-model",
      "#2 IMPL worker-cost costUsd=0.125 engine=codex model=impl-model",
      '#3 IMPL stage-failed reason="test checksum changed" evidence="{\\"changed\\":[\\"src/example.test.ts\\"]}" durationMs=40 failureKind=gate-fail gateName=checksum',
    ]);
  });

  it("shows no failure summary when a failed job has no stage-failed event", async () => {
    const store = new AgentctlMemoryStore();
    store.enqueueJob({ item: workItem("DEMO-3011"), retryBudget: 1 });
    store.updateJobStatus({ attemptsLeft: 0, jobId: "DEMO-3011", status: "ESCALATED" });
    store.appendEvent({ jobId: "DEMO-3011", type: "heartbeat" });
    const output: string[] = [];

    const exitCode = await runAgentctl(["show", "DEMO-3011"], {
      store,
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      "DEMO-3011 ESCALATED repo=web branch=- title=Example worktreePath=- attemptsLeft=0 startedAt=- cancelRequestedAt=-",
      "#1 - heartbeat",
    ]);
  });

  it("lists jobs from the API client with operational fields", async () => {
    const output: string[] = [];

    const exitCode = await runAgentctl(["list"], {
      apiClient: new AgentctlApiClient({
        jobs: [
          apiJob("DEMO-3101", {
            attemptsLeft: 2,
            branch: "feat/DEMO-3101",
            cancelRequestedAt: null,
            createdAt: "2026-06-06T00:00:00.000Z",
            finishedAt: null,
            repo: "web",
            source: "jira",
            startedAt: "2026-06-06T00:00:10.000Z",
            status: "IMPL",
            updatedAt: "2026-06-06T00:02:00.000Z",
            worktreePath: "/worktrees/web/feat-DEMO-3101",
          }),
          apiJob("DEMO-3102", {
            attemptsLeft: 1,
            branch: null,
            cancelRequestedAt: "2026-06-06T00:03:00.000Z",
            createdAt: "2026-06-06T00:01:00.000Z",
            finishedAt: null,
            repo: "docs",
            source: "brief",
            startedAt: null,
            status: "QUEUED",
            updatedAt: "2026-06-06T00:03:00.000Z",
            worktreePath: null,
          }),
        ],
      }),
      store: new AgentctlMemoryStore(),
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      "DEMO-3101 IMPL repo=web branch=feat/DEMO-3101 source=jira title=Example attemptsLeft=2 createdAt=2026-06-06T00:00:00.000Z updatedAt=2026-06-06T00:02:00.000Z startedAt=2026-06-06T00:00:10.000Z finishedAt=- worktreePath=/worktrees/web/feat-DEMO-3101 cancelRequestedAt=-",
      "DEMO-3102 QUEUED repo=docs branch=- source=brief title=Example attemptsLeft=1 createdAt=2026-06-06T00:01:00.000Z updatedAt=2026-06-06T00:03:00.000Z startedAt=- finishedAt=- worktreePath=- cancelRequestedAt=2026-06-06T00:03:00.000Z",
    ]);
  });

  it("filters list jobs via the API client and rejects invalid status", async () => {
    const apiClient = new AgentctlApiClient({ jobs: [] });
    const stderr: string[] = [];

    await expect(
      runAgentctl(["list", "--status", "FAILED"], {
        apiClient,
        store: new AgentctlMemoryStore(),
      }),
    ).resolves.toBe(0);
    await expect(
      runAgentctl(["list", "--status", "UNKNOWN"], {
        apiClient,
        stderr: (line) => stderr.push(line),
        store: new AgentctlMemoryStore(),
      }),
    ).resolves.toBe(1);

    expect(apiClient.listRequests).toEqual([{ status: "FAILED" }]);
    expect(stderr).toEqual([
      "--status: expected one of QUEUED, SPEC, PLAN, TEST, IMPL, REVIEW, PR, DONE, FAILED, ESCALATED, CANCELED",
    ]);
  });

  it("renders daemon health and the private-network auth assumption", async () => {
    const output: string[] = [];

    const exitCode = await runAgentctl(["daemon", "status"], {
      apiClient: new AgentctlApiClient({
        health: {
          apiVersion: "v1",
          auth: { mode: "private-network" },
          daemon: { status: "ok" },
          service: "pando",
          status: "ok",
          store: { jobCount: 7, status: "ok" },
        },
      }),
      store: new AgentctlMemoryStore(),
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      "pando ok apiVersion=v1 daemon=ok store=ok jobCount=7 auth=private-network",
      "auth assumption: private network boundary; do not expose publicly without a new ADR",
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

  it("retries through the API client when an API base URL is configured", async () => {
    const output: string[] = [];
    const apiClient = new AgentctlApiClient({
      jobs: [
        apiJob("DEMO-3110", {
          attemptsLeft: 4,
          status: "IMPL",
        }),
      ],
    });

    const exitCode = await runAgentctl(
      ["retry", "DEMO-3110", "--from", "IMPL", "--attempts", "4"],
      {
        apiBaseUrl: "http://pando.local",
        apiClient,
        store: new AgentctlMemoryStore(),
        stdout: (line) => output.push(line),
      },
    );

    expect(exitCode).toBe(0);
    expect(apiClient.retryRequests).toEqual([
      { attemptsLeft: 4, from: "IMPL", jobId: "DEMO-3110" },
    ]);
    expect(output).toEqual(["retry queued DEMO-3110 from IMPL"]);
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

  it("cancels through the API client when an API base URL is configured", async () => {
    const output: string[] = [];
    const apiClient = new AgentctlApiClient({
      jobs: [
        apiJob("DEMO-3111", {
          attemptsLeft: 2,
          status: "IMPL",
        }),
      ],
    });

    const exitCode = await runAgentctl(["cancel", "DEMO-3111"], {
      apiBaseUrl: "http://pando.local",
      apiClient,
      store: new AgentctlMemoryStore(),
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(apiClient.cancelRequests).toEqual([{ jobId: "DEMO-3111" }]);
    expect(output).toEqual(["cancel requested DEMO-3111"]);
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

  it("renders API client errors without stack traces", async () => {
    const stderr: string[] = [];

    const exitCode = await runAgentctl(["list"], {
      apiClient: new AgentctlApiClient({
        error: Object.assign(new Error("job not found: DEMO-404"), {
          code: "job_not_found",
          status: 404,
        }),
      }),
      stderr: (line) => stderr.push(line),
      store: new AgentctlMemoryStore(),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["api error 404 job_not_found: job not found: DEMO-404"]);
    expect(stderr.join("\n")).not.toContain("stack");
  });

  it("watches a job until it reaches a terminal status", async () => {
    const apiClient = new AgentctlApiClient({
      jobSequence: [
        apiJob("DEMO-3200", { status: "IMPL" }),
        apiJob("DEMO-3200", { status: "REVIEW" }),
        apiJob("DEMO-3200", { status: "DONE", finishedAt: "2026-06-06T00:05:00.000Z" }),
      ],
    });
    const sleeps: number[] = [];
    const output: string[] = [];

    const exitCode = await runAgentctl(["watch", "DEMO-3200", "--interval", "500"], {
      apiBaseUrl: "http://pando.local",
      apiClient,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      store: new AgentctlMemoryStore(),
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(apiClient.getJobRequests).toEqual(["DEMO-3200", "DEMO-3200", "DEMO-3200"]);
    expect(sleeps).toEqual([500, 500]);
    expect(output).toEqual([
      "DEMO-3200 IMPL repo=web branch=- source=jira attemptsLeft=1 updatedAt=2026-06-06T00:00:00.000Z finishedAt=-",
      "DEMO-3200 REVIEW repo=web branch=- source=jira attemptsLeft=1 updatedAt=2026-06-06T00:00:00.000Z finishedAt=-",
      "DEMO-3200 DONE repo=web branch=- source=jira attemptsLeft=1 updatedAt=2026-06-06T00:00:00.000Z finishedAt=2026-06-06T00:05:00.000Z",
    ]);
  });

  it("requires an API base URL for watch", async () => {
    const stderr: string[] = [];

    const exitCode = await runAgentctl(["watch", "DEMO-3201"], {
      store: new AgentctlMemoryStore(),
      stderr: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["PANDO_API_URL is required for API-backed agentctl commands"]);
  });

  it("watches the job list for a bounded number of polls", async () => {
    const apiClient = new AgentctlApiClient({
      jobs: [apiJob("DEMO-3202", { status: "IMPL" })],
    });
    const sleeps: number[] = [];
    const output: string[] = [];

    const exitCode = await runAgentctl(
      ["list", "--watch", "--interval", "250", "--max-polls", "2"],
      {
        apiBaseUrl: "http://pando.local",
        apiClient,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        store: new AgentctlMemoryStore(),
        stdout: (line) => output.push(line),
      },
    );

    expect(exitCode).toBe(0);
    expect(apiClient.listRequests.length).toBe(2);
    expect(sleeps).toEqual([250]);
    expect(output.filter((line) => line.startsWith("DEMO-3202")).length).toBe(2);
  });

  it("runs the readiness smoke and surfaces the evidence path without secrets", async () => {
    const calls: Array<{ args: readonly string[] }> = [];
    const output: string[] = [];

    const exitCode = await runAgentctl(["smoke", "readiness", "--target", "host"], {
      smokeRunner: async (input) => {
        calls.push({ args: input.args });
        return { evidencePath: "/tmp/pando-readiness-smoke/host.json", exitCode: 0 };
      },
      store: new AgentctlMemoryStore(),
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "scripts/two-job-smoke.mjs",
      "--mode",
      "readiness",
      "--target",
      "host",
      "--evidence",
      "/tmp/pando-readiness-smoke/host.json",
    ]);
    expect(output).toEqual([
      "readiness smoke target=host exitCode=0 evidence=/tmp/pando-readiness-smoke/host.json",
    ]);
    expect(output.join("\n")).not.toContain("ANTHROPIC_API_KEY");
  });

  it("defaults the readiness smoke target to host", async () => {
    const calls: Array<{ args: readonly string[] }> = [];

    const exitCode = await runAgentctl(["smoke", "readiness"], {
      smokeRunner: async (input) => {
        calls.push({ args: input.args });
        return { evidencePath: "/tmp/pando-readiness-smoke/host.json", exitCode: 0 };
      },
      store: new AgentctlMemoryStore(),
    });

    expect(exitCode).toBe(0);
    expect(calls[0]?.args).toContain("host");
  });

  it("rejects unknown readiness smoke targets", async () => {
    const stderr: string[] = [];

    const exitCode = await runAgentctl(["smoke", "readiness", "--target", "cloud"], {
      smokeRunner: async () => ({ evidencePath: "/tmp/x.json", exitCode: 0 }),
      store: new AgentctlMemoryStore(),
      stderr: (line) => stderr.push(line),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toEqual(["--target: expected one of host, docker"]);
  });

  it("returns the readiness smoke exit code when blockers are present", async () => {
    const output: string[] = [];

    const exitCode = await runAgentctl(["smoke", "readiness", "--target", "docker"], {
      smokeRunner: async () => ({
        evidencePath: "/tmp/pando-readiness-smoke/docker.json",
        exitCode: 2,
      }),
      store: new AgentctlMemoryStore(),
      stdout: (line) => output.push(line),
    });

    expect(exitCode).toBe(2);
    expect(output).toEqual([
      "readiness smoke target=docker exitCode=2 evidence=/tmp/pando-readiness-smoke/docker.json",
    ]);
  });

  it("prints usage for unknown commands and rejects missing option values", async () => {
    const stderr: string[] = [];

    await expect(
      runAgentctl(["unknown"], {
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

class AgentctlApiClient implements PandoApiClient {
  readonly cancelRequests: Array<{ jobId: string; reason?: string }> = [];
  readonly getJobRequests: string[] = [];
  readonly listRequests: Array<{ status?: JobStatus } | undefined> = [];
  readonly retryRequests: Array<{ attemptsLeft?: number; from: string; jobId: string }> = [];

  private readonly error?: Error;
  private readonly healthResponse: ApiHealth;
  private readonly jobs: ApiJobSummary[];
  private readonly jobSequence: ApiJobSummary[];

  constructor(
    input: {
      error?: Error;
      health?: ApiHealth;
      jobs?: ApiJobSummary[];
      jobSequence?: ApiJobSummary[];
    } = {},
  ) {
    this.error = input.error;
    this.healthResponse =
      input.health ??
      ({
        apiVersion: "v1",
        auth: { mode: "private-network" },
        daemon: { status: "ok" },
        service: "pando",
        status: "ok",
        store: { jobCount: input.jobs?.length ?? 0, status: "ok" },
      } satisfies ApiHealth);
    this.jobs = input.jobs ?? [];
    this.jobSequence = input.jobSequence ?? [];
  }

  async health() {
    this.throwIfConfigured();
    return this.healthResponse;
  }

  async listJobs(input?: { status?: JobStatus }) {
    this.throwIfConfigured();
    this.listRequests.push(input);
    return {
      jobs: this.jobs.filter((job) => input?.status === undefined || job.status === input.status),
    };
  }

  async getJob(jobId: string) {
    this.throwIfConfigured();
    this.getJobRequests.push(jobId);
    const index = Math.min(this.getJobRequests.length - 1, this.jobSequence.length - 1);
    const job = this.jobSequence[index] ?? this.jobFor(jobId);
    return { job: { ...job, workItem: workItem(jobId) }, recentEvents: [] };
  }

  async listEvents(): Promise<never> {
    throw new Error("not used");
  }

  async retryJob(
    jobId: string,
    input: {
      attemptsLeft?: number;
      from: string;
    },
  ) {
    this.throwIfConfigured();
    this.retryRequests.push({ attemptsLeft: input.attemptsLeft, from: input.from, jobId });
    return {
      action: { status: "retried", type: "retry" } as const,
      job: this.jobFor(jobId, {
        attemptsLeft: input.attemptsLeft,
        status: input.from as JobStatus,
      }),
    };
  }

  async cancelJob(jobId: string, input?: { reason?: string }) {
    this.throwIfConfigured();
    this.cancelRequests.push({ jobId, reason: input?.reason });
    const job = this.jobFor(jobId);
    const requested = job.status !== "QUEUED";
    return {
      action: {
        status: requested ? "cancel_requested" : "canceled",
        type: "cancel",
      } as const,
      job: { ...job, status: requested ? job.status : "CANCELED" },
    };
  }

  async cleanupJob(jobId: string) {
    this.throwIfConfigured();
    const job = this.jobFor(jobId);
    return {
      action: {
        status: "cleanup_requested",
        type: "cleanup",
        worktreePath: job.worktreePath ?? "/worktrees/example",
      } as const,
      job,
    };
  }

  async submitBrief(input: Parameters<PandoApiClient["submitBrief"]>[0]) {
    this.throwIfConfigured();
    return {
      job: {
        ...apiJob(input.id),
        repo: input.repo,
        source: "brief" as const,
        title: input.title ?? input.id,
      },
    };
  }

  private jobFor(
    jobId: string,
    overrides: { attemptsLeft?: number; status?: JobStatus } = {},
  ): ApiJobSummary {
    const job = this.jobs.find((candidate) => candidate.jobId === jobId) ?? apiJob(jobId);
    return {
      ...job,
      attemptsLeft: overrides.attemptsLeft ?? job.attemptsLeft,
      status: overrides.status ?? job.status,
    };
  }

  private throwIfConfigured(): void {
    if (this.error !== undefined) throw this.error;
  }
}

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

  listJobs(input?: Parameters<JobStore["listJobs"]>[0]): JobRecord[] {
    return [...this.jobs.values()].filter(
      (job) => input?.status === undefined || job.status === input.status,
    );
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

function apiJob(
  jobId: string,
  overrides: Partial<ApiJobSummary> & Pick<Partial<ApiJobSummary>, "status"> = {},
): ApiJobSummary {
  return {
    attemptsLeft: overrides.attemptsLeft ?? 1,
    branch: overrides.branch ?? null,
    cancelRequestedAt: overrides.cancelRequestedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-06-06T00:00:00.000Z",
    finishedAt: overrides.finishedAt ?? null,
    jobId,
    repo: overrides.repo ?? "web",
    source: overrides.source ?? "jira",
    startedAt: overrides.startedAt ?? null,
    status: overrides.status ?? "QUEUED",
    title: overrides.title ?? "Example",
    updatedAt: overrides.updatedAt ?? "2026-06-06T00:00:00.000Z",
    worktreePath: overrides.worktreePath ?? null,
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
