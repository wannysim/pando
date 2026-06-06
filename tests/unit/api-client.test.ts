import { describe, expect, it } from "vitest";
import { createPandoApiApp } from "../../src/api/app";
import { PandoApiClientError, createPandoApiClient } from "../../src/api/client";
import type { JobRecord } from "../../src/db/index";
import type { JobStatus, WorkItem } from "../../src/core/types";

describe("Pando API client", () => {
  it("reads jobs from the shared JSON envelope", async () => {
    const app = createPandoApiApp({
      store: new ClientMemoryStore([
        jobRecord(workItem("DEMO-4010"), {
          createdAt: "2026-06-06T00:00:00.000Z",
          status: "FAILED",
          updatedAt: "2026-06-06T00:01:00.000Z",
        }),
      ]),
    });
    const client = createPandoApiClient({
      baseUrl: "http://pando.local",
      fetch: appFetch(app),
    });

    await expect(client.listJobs({ status: "FAILED" })).resolves.toEqual({
      jobs: [
        expect.objectContaining({
          jobId: "DEMO-4010",
          status: "FAILED",
        }),
      ],
    });
  });

  it("sends cleanup and brief submit mutations through the shared client", async () => {
    const app = createPandoApiApp({
      store: new ClientMemoryStore([
        jobRecord(workItem("DEMO-4011"), {
          createdAt: "2026-06-06T00:00:00.000Z",
          status: "DONE",
          updatedAt: "2026-06-06T00:01:00.000Z",
          worktreePath: "/worktrees/web/feat-DEMO-4011",
        }),
      ]),
    });
    const client = createPandoApiClient({
      baseUrl: "http://pando.local/",
      fetch: appFetch(app),
    });

    await expect(client.cleanupJob("DEMO-4011")).resolves.toMatchObject({
      action: {
        status: "cleanup_requested",
        type: "cleanup",
        worktreePath: "/worktrees/web/feat-DEMO-4011",
      },
      job: { jobId: "DEMO-4011" },
    });
    await expect(
      client.submitBrief({
        briefPath: "briefs/dashboard/brief.md",
        id: "dashboard-brief",
        repo: "pando",
        title: "Dashboard brief",
      }),
    ).resolves.toMatchObject({
      job: {
        jobId: "dashboard-brief",
        source: "brief",
        status: "QUEUED",
      },
    });
  });

  it("submits an inline brief through the client", async () => {
    const writes: Array<{ content: string; path: string }> = [];
    const app = createPandoApiApp({
      briefMaterializer: {
        inboxRoot: "/tmp/pando-inbox",
        writer: {
          async writeBrief(path, content) {
            writes.push({ content, path });
          },
        },
      },
      store: new ClientMemoryStore([]),
    });
    const client = createPandoApiClient({
      baseUrl: "http://pando.local",
      fetch: appFetch(app),
    });

    await expect(
      client.submitBrief({
        brief: {
          title: "Inline footer fix",
          body: "Make the footer year dynamic.",
          acceptanceCriteria: ["The footer shows the current year."],
          assets: ["src/footer.tsx"],
        },
        id: "inline-footer",
        repo: "pando",
      }),
    ).resolves.toMatchObject({
      job: { jobId: "inline-footer", source: "brief", status: "QUEUED" },
    });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.content).toContain("# Inline footer fix");
  });

  it("raises stable API errors with status and code", async () => {
    const app = createPandoApiApp({ store: new ClientMemoryStore([]) });
    const client = createPandoApiClient({
      baseUrl: "http://pando.local",
      fetch: appFetch(app),
    });

    await expect(client.getJob("missing")).rejects.toMatchObject({
      code: "job_not_found",
      message: "job not found: missing",
      status: 404,
    });
    await expect(client.getJob("missing")).rejects.toBeInstanceOf(PandoApiClientError);
  });
});

function appFetch(app: ReturnType<typeof createPandoApiApp>) {
  return async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    return await app.request(`${url.pathname}${url.search}`, init);
  };
}

class ClientMemoryStore {
  private readonly jobs = new Map<string, JobRecord>();

  constructor(jobs: readonly JobRecord[]) {
    for (const job of jobs) this.jobs.set(job.item.id, job);
  }

  listJobs(input?: { status?: JobStatus }): JobRecord[] {
    return [...this.jobs.values()].filter(
      (job) => input?.status === undefined || job.status === input.status,
    );
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  listEvents() {
    return [];
  }

  retryJob(): JobRecord {
    throw new Error("not used");
  }

  cancelJob(): JobRecord {
    throw new Error("not used");
  }

  requestJobCleanup(input: { jobId: string }) {
    const job = this.getJob(input.jobId);
    if (job === undefined) throw new Error(`job not found: ${input.jobId}`);
    if (job.worktreePath === undefined) {
      throw new Error(`job ${input.jobId} has no worktree path to cleanup`);
    }
    return { job, worktreePath: job.worktreePath };
  }

  enqueueJob(input: { item: WorkItem; retryBudget: number }): JobRecord {
    const record = jobRecord(input.item, {
      attemptsLeft: input.retryBudget,
      createdAt: "2026-06-06T00:02:00.000Z",
      status: "QUEUED",
      updatedAt: "2026-06-06T00:02:00.000Z",
    });
    this.jobs.set(input.item.id, record);
    return record;
  }
}

function workItem(id: string): WorkItem {
  return {
    id,
    payload: { kind: "jira", ticketKey: id },
    repo: "web",
    source: "jira",
    title: `Example job ${id}`,
  };
}

function jobRecord(
  item: WorkItem,
  overrides: {
    attemptsLeft?: number;
    createdAt: string;
    status: JobStatus;
    updatedAt: string;
    worktreePath?: string;
  },
): JobRecord {
  return {
    attemptsLeft: overrides.attemptsLeft ?? 1,
    createdAt: overrides.createdAt,
    item,
    status: overrides.status,
    updatedAt: overrides.updatedAt,
    worktreePath: overrides.worktreePath,
  };
}
