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
  },
): JobRecord {
  return {
    attemptsLeft: overrides.attemptsLeft ?? 1,
    createdAt: overrides.createdAt,
    item,
    status: overrides.status,
    updatedAt: overrides.updatedAt,
  };
}
