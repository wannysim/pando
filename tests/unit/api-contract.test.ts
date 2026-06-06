import { describe, expect, it } from "vitest";
import { createPandoApiApp } from "../../src/api/app";
import type {
  ApiBriefSubmitResponse,
  ApiJobActionResponse,
  ApiJobCleanupResponse,
  ApiJobList,
  ApiResponse,
} from "../../src/api/schema";
import type {
  CancelJobInput,
  EnqueueJobInput,
  JobEventRecord,
  JobRecord,
  RequestJobCleanupInput,
  RetryJobInput,
} from "../../src/db/index";
import type { JobStatus, StageName, WorkItem } from "../../src/core/types";

describe("Pando Hono API", () => {
  it("returns stable daemon and store health without leaking secrets", async () => {
    const store = new ApiMemoryStore([
      jobRecord(workItem("DEMO-4001"), {
        createdAt: "2026-06-06T00:00:00.000Z",
        status: "QUEUED",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }),
    ]);
    const app = createPandoApiApp({ store });

    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        apiVersion: "v1",
        auth: { mode: "private-network" },
        daemon: { status: "ok" },
        service: "pando",
        status: "ok",
        store: { jobCount: 1, status: "ok" },
      },
      ok: true,
    });
  });

  it("returns ordered jobs with operational summary fields", async () => {
    const store = new ApiMemoryStore([
      jobRecord(workItem("DEMO-4001"), {
        attemptsLeft: 3,
        createdAt: "2026-06-06T00:00:00.000Z",
        status: "QUEUED",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }),
      jobRecord(workItem("DEMO-4002", "brief"), {
        attemptsLeft: 1,
        cancelRequestedAt: "2026-06-06T00:02:00.000Z",
        createdAt: "2026-06-06T00:01:00.000Z",
        status: "IMPL",
        updatedAt: "2026-06-06T00:03:00.000Z",
        worktreePath: "/worktrees/web/feat-DEMO-4002",
      }),
    ]);
    const app = createPandoApiApp({ store });

    const response = await app.request("/jobs");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        jobs: [
          {
            attemptsLeft: 1,
            branch: null,
            cancelRequestedAt: "2026-06-06T00:02:00.000Z",
            createdAt: "2026-06-06T00:01:00.000Z",
            finishedAt: null,
            jobId: "DEMO-4002",
            repo: "web",
            source: "brief",
            startedAt: null,
            status: "IMPL",
            title: "Example job DEMO-4002",
            updatedAt: "2026-06-06T00:03:00.000Z",
            worktreePath: "/worktrees/web/feat-DEMO-4002",
          },
          {
            attemptsLeft: 3,
            branch: null,
            cancelRequestedAt: null,
            createdAt: "2026-06-06T00:00:00.000Z",
            finishedAt: null,
            jobId: "DEMO-4001",
            repo: "web",
            source: "jira",
            startedAt: null,
            status: "QUEUED",
            title: "Example job DEMO-4001",
            updatedAt: "2026-06-06T00:00:00.000Z",
            worktreePath: null,
          },
        ],
      },
      ok: true,
    });
  });

  it("filters jobs by status deterministically and rejects invalid status", async () => {
    const store = new ApiMemoryStore([
      jobRecord(workItem("DEMO-4001"), {
        createdAt: "2026-06-06T00:00:00.000Z",
        status: "FAILED",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }),
      jobRecord(workItem("DEMO-4002"), {
        createdAt: "2026-06-06T00:01:00.000Z",
        status: "DONE",
        updatedAt: "2026-06-06T00:01:00.000Z",
      }),
      jobRecord(workItem("DEMO-4003"), {
        createdAt: "2026-06-06T00:02:00.000Z",
        status: "FAILED",
        updatedAt: "2026-06-06T00:02:00.000Z",
      }),
    ]);
    const app = createPandoApiApp({ store });

    const filtered = await app.request("/jobs?status=FAILED");
    const invalid = await app.request("/jobs?status=UNKNOWN");

    expect(filtered.status).toBe(200);
    const filteredBody = await responseJson<ApiResponse<ApiJobList>>(filtered);
    if (!filteredBody.ok) throw new Error(filteredBody.error.message);
    expect(filteredBody.data.jobs.map((job) => job.jobId)).toEqual(["DEMO-4003", "DEMO-4001"]);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: {
        code: "invalid_status",
        message:
          "status must be one of QUEUED, SPEC, PLAN, TEST, IMPL, REVIEW, PR, DONE, FAILED, ESCALATED, CANCELED",
      },
      ok: false,
    });
  });

  it("returns job detail with work item, attempts, worktree path, and recent events", async () => {
    const job = jobRecord(workItem("DEMO-4004", "github_issue"), {
      attemptsLeft: 2,
      createdAt: "2026-06-06T00:00:00.000Z",
      status: "REVIEW",
      updatedAt: "2026-06-06T00:01:00.000Z",
      worktreePath: "/worktrees/web/feat-DEMO-4004",
    });
    const store = new ApiMemoryStore(
      [job],
      [
        eventRecord("DEMO-4004", 1, {
          payload: { durationMs: 100 },
          stage: "REVIEW",
          type: "stage-completed",
        }),
      ],
    );
    const app = createPandoApiApp({ store });

    const response = await app.request("/jobs/DEMO-4004");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        job: {
          attemptsLeft: 2,
          branch: null,
          cancelRequestedAt: null,
          createdAt: "2026-06-06T00:00:00.000Z",
          finishedAt: null,
          jobId: "DEMO-4004",
          repo: "web",
          source: "github_issue",
          startedAt: null,
          status: "REVIEW",
          title: "Example job DEMO-4004",
          updatedAt: "2026-06-06T00:01:00.000Z",
          workItem: job.item,
          worktreePath: "/worktrees/web/feat-DEMO-4004",
        },
        recentEvents: [
          {
            createdAt: "2026-06-06T00:00:01.000Z",
            evidence: null,
            gateName: null,
            jobId: "DEMO-4004",
            payload: { durationMs: 100 },
            reason: null,
            sequence: 1,
            stage: "REVIEW",
            status: null,
            type: "stage-completed",
          },
        ],
      },
      ok: true,
    });
  });

  it("returns ordered events including telemetry payload_json values", async () => {
    const store = new ApiMemoryStore(
      [
        jobRecord(workItem("DEMO-4005"), {
          createdAt: "2026-06-06T00:00:00.000Z",
          status: "FAILED",
          updatedAt: "2026-06-06T00:01:00.000Z",
        }),
      ],
      [
        eventRecord("DEMO-4005", 2, {
          payload: { costUsd: 0.125, durationMs: 250, engine: "codex", model: "impl-model" },
          stage: "IMPL",
          type: "worker-cost",
        }),
        eventRecord("DEMO-4005", 1, {
          evidence: '{"changed":["src/example.test.ts"]}',
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
        }),
      ],
    );
    const app = createPandoApiApp({ store });

    const response = await app.request("/jobs/DEMO-4005/events");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        events: [
          expect.objectContaining({
            payload: {
              durationMs: 40,
              evidence: '{"changed":["src/example.test.ts"]}',
              failureKind: "gate-fail",
              gateName: "checksum",
              reason: "test checksum changed",
            },
            sequence: 1,
          }),
          expect.objectContaining({
            payload: { costUsd: 0.125, durationMs: 250, engine: "codex", model: "impl-model" },
            sequence: 2,
          }),
        ],
      },
      ok: true,
    });
  });

  it("returns stable 404 JSON for missing jobs", async () => {
    const app = createPandoApiApp({ store: new ApiMemoryStore([]) });

    const response = await app.request("/jobs/missing");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "job_not_found", message: "job not found: missing" },
      ok: false,
    });
  });

  it("validates retry stage and delegates to the store retry contract", async () => {
    const store = new ApiMemoryStore([
      jobRecord(workItem("DEMO-4006"), {
        attemptsLeft: 0,
        createdAt: "2026-06-06T00:00:00.000Z",
        status: "FAILED",
        updatedAt: "2026-06-06T00:01:00.000Z",
      }),
    ]);
    const app = createPandoApiApp({ defaultRetryBudget: 5, store });

    const retried = await app.request("/jobs/DEMO-4006/retry", {
      body: JSON.stringify({ from: "IMPL" }),
      method: "POST",
    });
    const invalid = await app.request("/jobs/DEMO-4006/retry", {
      body: JSON.stringify({ from: "UNKNOWN" }),
      method: "POST",
    });

    expect(retried.status).toBe(200);
    expect(store.retries).toEqual([{ attemptsLeft: 5, from: "IMPL", jobId: "DEMO-4006" }]);
    const retriedBody = await responseJson<ApiResponse<ApiJobActionResponse>>(retried);
    if (!retriedBody.ok) throw new Error(retriedBody.error.message);
    expect(retriedBody.data.job).toMatchObject({
      attemptsLeft: 5,
      jobId: "DEMO-4006",
      status: "IMPL",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: {
        code: "invalid_stage",
        message: "from must be one of SPEC, PLAN, TEST, IMPL, REVIEW, PR",
      },
      ok: false,
    });
  });

  it("handles queued and active cancellation through the store cancel contract", async () => {
    const store = new ApiMemoryStore([
      jobRecord(workItem("DEMO-4007"), {
        createdAt: "2026-06-06T00:00:00.000Z",
        status: "QUEUED",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }),
      jobRecord(workItem("DEMO-4008"), {
        createdAt: "2026-06-06T00:01:00.000Z",
        status: "IMPL",
        updatedAt: "2026-06-06T00:01:00.000Z",
      }),
    ]);
    const app = createPandoApiApp({ store });

    const queued = await app.request("/jobs/DEMO-4007/cancel", { method: "POST" });
    const active = await app.request("/jobs/DEMO-4008/cancel", {
      body: JSON.stringify({ reason: "operator requested" }),
      method: "POST",
    });

    expect(queued.status).toBe(200);
    expect(active.status).toBe(202);
    expect(store.cancellations).toEqual([
      { jobId: "DEMO-4007", requestedBy: "api" },
      { jobId: "DEMO-4008", reason: "operator requested", requestedBy: "api" },
    ]);
    const queuedBody = await responseJson<ApiResponse<ApiJobActionResponse>>(queued);
    const activeBody = await responseJson<ApiResponse<ApiJobActionResponse>>(active);
    if (!queuedBody.ok) throw new Error(queuedBody.error.message);
    if (!activeBody.ok) throw new Error(activeBody.error.message);
    expect(queuedBody.data.action).toEqual({ status: "canceled", type: "cancel" });
    expect(activeBody.data.action).toEqual({
      status: "cancel_requested",
      type: "cancel",
    });
  });

  it("requests terminal job cleanup through the store cleanup contract", async () => {
    const store = new ApiMemoryStore([
      jobRecord(workItem("DEMO-4010"), {
        createdAt: "2026-06-06T00:00:00.000Z",
        status: "DONE",
        updatedAt: "2026-06-06T00:01:00.000Z",
        worktreePath: "/worktrees/web/feat-DEMO-4010",
      }),
    ]);
    const app = createPandoApiApp({ store });

    const response = await app.request("/jobs/DEMO-4010/cleanup", { method: "POST" });

    expect(response.status).toBe(202);
    expect(store.cleanups).toEqual([{ jobId: "DEMO-4010", requestedBy: "api" }]);
    const body = await responseJson<ApiResponse<ApiJobCleanupResponse>>(response);
    if (!body.ok) throw new Error(body.error.message);
    expect(body.data).toEqual({
      action: {
        status: "cleanup_requested",
        type: "cleanup",
        worktreePath: "/worktrees/web/feat-DEMO-4010",
      },
      job: expect.objectContaining({
        jobId: "DEMO-4010",
        status: "DONE",
        worktreePath: "/worktrees/web/feat-DEMO-4010",
      }),
    });
  });

  it("enqueues brief submissions as brief work items", async () => {
    const store = new ApiMemoryStore([]);
    const app = createPandoApiApp({ defaultRetryBudget: 7, store });

    const response = await app.request("/briefs", {
      body: JSON.stringify({
        branch: "feat/dashboard-brief",
        briefPath: "briefs/dashboard/brief.md",
        id: "dashboard-brief",
        repo: "pando",
        title: "Dashboard brief",
      }),
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(store.enqueues).toEqual([
      {
        item: {
          branch: "feat/dashboard-brief",
          id: "dashboard-brief",
          payload: { briefPath: "briefs/dashboard/brief.md", kind: "brief" },
          repo: "pando",
          source: "brief",
          title: "Dashboard brief",
        },
        retryBudget: 7,
      },
    ]);
    const body = await responseJson<ApiResponse<ApiBriefSubmitResponse>>(response);
    if (!body.ok) throw new Error(body.error.message);
    expect(body.data.job).toMatchObject({
      jobId: "dashboard-brief",
      repo: "pando",
      source: "brief",
      status: "QUEUED",
      title: "Dashboard brief",
    });
  });

  it("rejects invalid brief submissions before enqueueing", async () => {
    const store = new ApiMemoryStore([]);
    const app = createPandoApiApp({ store });

    const response = await app.request("/briefs", {
      body: JSON.stringify({ id: "missing-repo" }),
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(store.enqueues).toEqual([]);
    expect(await response.json()).toEqual({
      error: { code: "invalid_request", message: "repo is required" },
      ok: false,
    });
  });

  it("materializes an inline brief, then enqueues it with the written path and assets", async () => {
    const store = new ApiMemoryStore([]);
    const writer = new RecordingBriefWriter();
    const app = createPandoApiApp({
      briefMaterializer: { inboxRoot: "/tmp/pando-inbox", writer },
      defaultRetryBudget: 5,
      store,
    });

    const response = await app.request("/briefs", {
      body: JSON.stringify({
        brief: {
          title: "Make the footer year dynamic",
          goal: "Keep the copyright year correct without manual edits.",
          userStory: "As a visitor, I want the footer to show the current year.",
          acceptanceCriteria: ["The footer renders the current year."],
          screensOrBehavior: "Footer reads the current year at render time.",
          nonGoals: ["Do not redesign the footer."],
          assets: ["src/footer.tsx", "docs/spec.md"],
          openQuestions: [],
        },
        id: "footer-year",
        repo: "pando",
      }),
      method: "POST",
    });

    expect(response.status).toBe(201);
    expect(writer.writes).toHaveLength(1);
    expect(writer.writes[0]?.path).toBe("/tmp/pando-inbox/footer-year/brief.md");
    expect(writer.writes[0]?.content).toContain("# Make the footer year dynamic");
    expect(store.enqueues).toEqual([
      {
        item: {
          id: "footer-year",
          payload: {
            assets: ["src/footer.tsx", "docs/spec.md"],
            briefPath: "/tmp/pando-inbox/footer-year/brief.md",
            kind: "brief",
          },
          repo: "pando",
          source: "brief",
          title: "Make the footer year dynamic",
        },
        retryBudget: 5,
      },
    ]);
  });

  it("rejects schema-invalid inline briefs with 400 before writing or enqueueing", async () => {
    const store = new ApiMemoryStore([]);
    const writer = new RecordingBriefWriter();
    const app = createPandoApiApp({
      briefMaterializer: { inboxRoot: "/tmp/pando-inbox", writer },
      store,
    });

    const response = await app.request("/briefs", {
      body: JSON.stringify({
        brief: { title: "", body: "do something" },
        id: "bad-brief",
        repo: "pando",
      }),
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(writer.writes).toEqual([]);
    expect(store.enqueues).toEqual([]);
    const body = await response.json();
    expect(body).toMatchObject({ error: { code: "invalid_brief" }, ok: false });
  });

  it("rejects inline briefs when no materializer is configured", async () => {
    const store = new ApiMemoryStore([]);
    const app = createPandoApiApp({ store });

    const response = await app.request("/briefs", {
      body: JSON.stringify({
        brief: { title: "Inline", body: "x", acceptanceCriteria: ["y"] },
        id: "inline",
        repo: "pando",
      }),
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(store.enqueues).toEqual([]);
    expect(await response.json()).toMatchObject({
      error: { code: "inline_brief_unavailable" },
      ok: false,
    });
  });

  it("returns stable JSON errors instead of thrown stack traces", async () => {
    const store = new ApiMemoryStore([
      jobRecord(workItem("DEMO-4009"), {
        createdAt: "2026-06-06T00:00:00.000Z",
        status: "IMPL",
        updatedAt: "2026-06-06T00:00:00.000Z",
      }),
    ]);
    const app = createPandoApiApp({ store });

    const response = await app.request("/jobs/DEMO-4009/retry", {
      body: JSON.stringify({ from: "TEST" }),
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: {
        code: "invalid_job_state",
        message: "job DEMO-4009 is not terminal: IMPL",
      },
      ok: false,
    });
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("returns stable JSON for unknown routes", async () => {
    const app = createPandoApiApp({ store: new ApiMemoryStore([]) });

    const response = await app.request("/unknown");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "route_not_found", message: "route not found" },
      ok: false,
    });
  });
});

class RecordingBriefWriter {
  readonly writes: Array<{ content: string; path: string }> = [];

  async writeBrief(path: string, content: string): Promise<void> {
    this.writes.push({ content, path });
  }
}

class ApiMemoryStore {
  readonly cancellations: CancelJobInput[] = [];
  readonly cleanups: RequestJobCleanupInput[] = [];
  readonly enqueues: EnqueueJobInput[] = [];
  readonly retries: RetryJobInput[] = [];

  private readonly jobs = new Map<string, JobRecord>();
  private readonly events = new Map<string, JobEventRecord[]>();

  constructor(jobs: readonly JobRecord[], events: readonly JobEventRecord[] = []) {
    for (const job of jobs) this.jobs.set(job.item.id, job);
    for (const event of events) {
      this.events.set(event.jobId, [...(this.events.get(event.jobId) ?? []), event]);
    }
  }

  listJobs(input?: { status?: JobStatus }): JobRecord[] {
    return [...this.jobs.values()]
      .filter((job) => input?.status === undefined || job.status === input.status)
      .sort(compareJobs);
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  listEvents(jobId: string): JobEventRecord[] {
    return [...(this.events.get(jobId) ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
  }

  retryJob(input: RetryJobInput): JobRecord {
    const job = this.requireJob(input.jobId);
    if (!["DONE", "FAILED", "ESCALATED", "CANCELED"].includes(job.status)) {
      throw new Error(`job ${input.jobId} is not terminal: ${job.status}`);
    }

    const next = {
      ...job,
      attemptsLeft: input.attemptsLeft,
      cancelRequestedAt: undefined,
      status: input.from,
      updatedAt: "2026-06-06T00:02:00.000Z",
    };
    this.retries.push(input);
    this.jobs.set(input.jobId, next);
    return next;
  }

  cancelJob(input: CancelJobInput): JobRecord {
    const job = this.requireJob(input.jobId);
    if (["DONE", "FAILED", "ESCALATED", "CANCELED"].includes(job.status)) {
      throw new Error(`job ${input.jobId} is terminal: ${job.status}`);
    }

    this.cancellations.push(input);
    const next =
      job.status === "QUEUED"
        ? {
            ...job,
            finishedAt: "2026-06-06T00:02:00.000Z",
            status: "CANCELED" as const,
            updatedAt: "2026-06-06T00:02:00.000Z",
          }
        : {
            ...job,
            cancelRequestedAt: "2026-06-06T00:02:00.000Z",
            updatedAt: "2026-06-06T00:02:00.000Z",
          };
    this.jobs.set(input.jobId, next);
    return next;
  }

  requestJobCleanup(input: RequestJobCleanupInput) {
    const job = this.requireJob(input.jobId);
    if (!["DONE", "FAILED", "ESCALATED", "CANCELED"].includes(job.status)) {
      throw new Error(`job ${input.jobId} is not terminal: ${job.status}`);
    }
    if (job.worktreePath === undefined) {
      throw new Error(`job ${input.jobId} has no worktree path to cleanup`);
    }

    this.cleanups.push(input);
    return { job, worktreePath: job.worktreePath };
  }

  enqueueJob(input: EnqueueJobInput): JobRecord {
    this.enqueues.push(input);
    const record = jobRecord(input.item, {
      attemptsLeft: input.retryBudget,
      createdAt: "2026-06-06T00:04:00.000Z",
      status: "QUEUED",
      updatedAt: "2026-06-06T00:04:00.000Z",
    });
    this.jobs.set(input.item.id, record);
    return record;
  }

  private requireJob(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (job === undefined) throw new Error(`job not found: ${jobId}`);
    return job;
  }
}

function compareJobs(left: JobRecord, right: JobRecord): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.item.id.localeCompare(right.item.id)
  );
}

function workItem(id: string, source: WorkItem["source"] = "jira"): WorkItem {
  if (source === "brief") {
    return {
      id,
      payload: { briefPath: `briefs/${id}/brief.md`, kind: "brief" },
      repo: "web",
      source,
      title: `Example job ${id}`,
    };
  }
  if (source === "github_issue") {
    return {
      id,
      payload: { issueNumber: 42, kind: "github_issue", owner: "wannysim", repo: "pando" },
      repo: "web",
      source,
      title: `Example job ${id}`,
    };
  }

  return {
    id,
    payload: { kind: "jira", ticketKey: id },
    repo: "web",
    source,
    title: `Example job ${id}`,
  };
}

function jobRecord(
  item: WorkItem,
  overrides: {
    attemptsLeft?: number;
    cancelRequestedAt?: string;
    createdAt: string;
    finishedAt?: string;
    startedAt?: string;
    status: JobStatus;
    updatedAt: string;
    worktreePath?: string;
  },
): JobRecord {
  return {
    attemptsLeft: overrides.attemptsLeft ?? 1,
    cancelRequestedAt: overrides.cancelRequestedAt,
    createdAt: overrides.createdAt,
    finishedAt: overrides.finishedAt,
    item,
    startedAt: overrides.startedAt,
    status: overrides.status,
    updatedAt: overrides.updatedAt,
    worktreePath: overrides.worktreePath,
  };
}

function eventRecord(
  jobId: string,
  sequence: number,
  overrides: {
    evidence?: string;
    gateName?: string;
    payload?: Record<string, unknown>;
    reason?: string;
    stage?: StageName;
    status?: JobStatus;
    type: string;
  },
): JobEventRecord {
  return {
    createdAt: `2026-06-06T00:00:0${sequence}.000Z`,
    evidence: overrides.evidence,
    gateName: overrides.gateName,
    jobId,
    payload: overrides.payload ?? {},
    reason: overrides.reason,
    sequence,
    stage: overrides.stage,
    status: overrides.status,
    type: overrides.type,
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
