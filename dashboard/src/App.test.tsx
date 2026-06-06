import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mocked } from "vitest";
import { DashboardApp } from "./App";
import type { PandoApiClient } from "../../src/api/client";
import type {
  ApiBriefSubmitResponse,
  ApiHealth,
  ApiJobActionResponse,
  ApiJobCleanupResponse,
  ApiJobDetailResponse,
  ApiJobSummary,
} from "../../src/api/schema";
import type { JobStatus, WorkItem } from "../../src/core/types";

describe("DashboardApp", () => {
  it("renders the jobs list from the API client", async () => {
    const client = createMockClient();

    render(<DashboardApp client={client} />);

    expect(await screen.findByRole("button", { name: /open DEMO-5001/i })).toBeVisible();
    expect(screen.getByText("Build minimal dashboard")).toBeVisible();
    expect(screen.getByText("FAILED")).toBeVisible();
    expect(client.listJobs).toHaveBeenCalledWith(undefined);
  });

  it("changes the list query when the status tab changes", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await screen.findByRole("button", { name: /open DEMO-5001/i });
    await user.click(screen.getByRole("tab", { name: "Failed" }));

    await waitFor(() => expect(client.listJobs).toHaveBeenLastCalledWith({ status: "FAILED" }));
  });

  it("shows job detail work item, timeline, failure evidence, and worktree path", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    expect(await screen.findByRole("heading", { name: "DEMO-5001" })).toBeVisible();
    expect(screen.getAllByText("Build minimal dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("Work item")).toBeVisible();
    expect(screen.getByText("stage-failed")).toBeVisible();
    expect(screen.getByText("checksum mismatch")).toBeVisible();
    expect(screen.getByText('{"changed":["src/example.test.ts"]}')).toBeVisible();
    expect(screen.getByText("/worktrees/pando/feat-w5-minimal-dashboard")).toBeVisible();
  });

  it("calls retry, cancel, and cleanup mutations then refreshes", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));
    const initialRefreshes = client.listJobs.mock.calls.length;

    await user.click(await screen.findByRole("button", { name: "Retry from IMPL" }));
    await user.click(screen.getByRole("button", { name: "Cancel job" }));
    await user.click(screen.getByRole("button", { name: "Cleanup worktree" }));

    expect(client.retryJob).toHaveBeenCalledWith("DEMO-5001", { from: "IMPL" });
    expect(client.cancelJob).toHaveBeenCalledWith("DEMO-5001", { reason: "dashboard" });
    expect(client.cleanupJob).toHaveBeenCalledWith("DEMO-5001");
    expect(client.listJobs.mock.calls.length).toBeGreaterThan(initialRefreshes);
  });

  it("renders health with the private-network auth assumption", async () => {
    const client = createMockClient();

    render(<DashboardApp client={client} />);

    expect(await screen.findByText("pando ok")).toBeVisible();
    expect(screen.getByText("jobCount=2")).toBeVisible();
    expect(screen.getByText("auth=private-network")).toBeVisible();
    expect(screen.getByText(/Private network boundary/i)).toBeVisible();
  });

  it("validates and submits a brief form through the API client", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await screen.findByRole("button", { name: /open DEMO-5001/i });
    await user.click(screen.getByRole("button", { name: "Submit brief" }));

    expect(screen.getByText("Repo is required")).toBeVisible();
    expect(screen.getByText("ID is required")).toBeVisible();
    expect(client.submitBrief).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Repo"), "pando");
    await user.type(screen.getByLabelText("ID"), "dashboard-brief");
    await user.type(screen.getByLabelText("Title"), "Dashboard brief");
    await user.type(screen.getByLabelText("Brief path"), "briefs/dashboard/brief.md");
    await user.click(screen.getByRole("button", { name: "Submit brief" }));

    await waitFor(() =>
      expect(client.submitBrief).toHaveBeenCalledWith({
        briefPath: "briefs/dashboard/brief.md",
        id: "dashboard-brief",
        repo: "pando",
        title: "Dashboard brief",
      }),
    );
  });

  // AC-4a: context strip renders above action row with current stage and branch
  it("context strip renders above action row with current stage and branch (AC-4a)", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    // data-testid="context-strip" must exist (AC-1)
    const strip = await screen.findByTestId("context-strip");
    expect(strip).toBeVisible();

    // current stage = last recentEvent with non-null stage => "IMPL"
    expect(within(strip).getByText("IMPL")).toBeVisible();

    // branch = last path segment of "/worktrees/pando/feat-w5-minimal-dashboard"
    expect(within(strip).getByText("feat-w5-minimal-dashboard")).toBeVisible();
  });

  // AC-4b: gateName shown when present
  it("EventRow shows gateName when non-null (AC-4b)", async () => {
    const client = createMockClient(); // fixture event has gateName: "checksum"
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    expect(within(eventList).getByText("checksum")).toBeVisible();
  });

  // AC-4b: gateName shows "-" when null (exact text-node match, not substring of "stage-failed")
  it("EventRow shows '-' for null gateName (AC-4b)", async () => {
    const client = createMockClient();
    client.getJob.mockResolvedValue(jobDetailWithNullGateName());
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    // A standalone "-" element must appear in the event list for null gateName
    expect(within(eventList).getAllByText("-").length).toBeGreaterThan(0);
  });

  // AC-4c: status field rendered in event row
  it("EventRow shows status when non-null (AC-4c)", async () => {
    const client = createMockClient(); // fixture event has status: "FAILED"
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    // "FAILED" must appear inside the event list (not just the job status badge)
    const eventList = await screen.findByRole("list");
    expect(within(eventList).getByText("FAILED")).toBeVisible();
  });

  // AC-4d: evidence text shown when non-null (regression: must keep working in dense layout)
  it("EventRow shows evidence text when non-null (AC-4d)", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    expect(within(eventList).getByText('{"changed":["src/example.test.ts"]}')).toBeVisible();
  });
});

function createMockClient(): Mocked<PandoApiClient> {
  return {
    cancelJob: vi.fn(async () => actionResponse("cancel", "cancel_requested")),
    cleanupJob: vi.fn(async () => cleanupResponse()),
    getJob: vi.fn(async () => jobDetail()),
    health: vi.fn(async () => health()),
    listEvents: vi.fn(async () => ({ events: jobDetail().recentEvents })),
    listJobs: vi.fn(async () => ({ jobs: [jobSummary("DEMO-5001", "FAILED")] })),
    retryJob: vi.fn(async () => actionResponse("retry", "retried")),
    submitBrief: vi.fn(
      async (input): Promise<ApiBriefSubmitResponse> => ({
        job: {
          ...jobSummary(input.id, "QUEUED"),
          repo: input.repo,
          source: "brief",
          title: input.title ?? input.id,
        },
      }),
    ),
  };
}

function health(): ApiHealth {
  return {
    apiVersion: "v1",
    auth: { mode: "private-network" },
    daemon: { status: "ok" },
    service: "pando",
    status: "ok",
    store: { jobCount: 2, status: "ok" },
  };
}

function jobDetail(): ApiJobDetailResponse {
  return {
    job: {
      ...jobSummary("DEMO-5001", "FAILED"),
      workItem: workItem("DEMO-5001"),
    },
    recentEvents: [
      {
        createdAt: "2026-06-06T00:01:00.000Z",
        evidence: '{"changed":["src/example.test.ts"]}',
        gateName: "checksum",
        jobId: "DEMO-5001",
        payload: {
          evidence: '{"changed":["src/example.test.ts"]}',
          failureKind: "gate-fail",
          reason: "checksum mismatch",
        },
        reason: "checksum mismatch",
        sequence: 1,
        stage: "IMPL",
        status: "FAILED",
        type: "stage-failed",
      },
    ],
  };
}

function jobDetailWithNullGateName(): ApiJobDetailResponse {
  const base = jobDetail();
  return {
    ...base,
    recentEvents: [
      {
        ...base.recentEvents[0]!,
        gateName: null,
        sequence: 2,
      },
    ],
  };
}

function actionResponse(
  type: "cancel" | "retry",
  status: ApiJobActionResponse["action"]["status"],
): ApiJobActionResponse {
  return {
    action: { status, type },
    job: jobSummary("DEMO-5001", "FAILED"),
  };
}

function cleanupResponse(): ApiJobCleanupResponse {
  return {
    action: {
      status: "cleanup_requested",
      type: "cleanup",
      worktreePath: "/worktrees/pando/feat-w5-minimal-dashboard",
    },
    job: jobSummary("DEMO-5001", "FAILED"),
  };
}

function jobSummary(jobId: string, status: JobStatus): ApiJobSummary {
  return {
    attemptsLeft: 2,
    branch: null,
    cancelRequestedAt: null,
    createdAt: "2026-06-06T00:00:00.000Z",
    finishedAt: null,
    jobId,
    repo: "pando",
    source: "brief",
    startedAt: "2026-06-06T00:00:10.000Z",
    status,
    title: jobId === "DEMO-5001" ? "Build minimal dashboard" : jobId,
    updatedAt: "2026-06-06T00:02:00.000Z",
    worktreePath: "/worktrees/pando/feat-w5-minimal-dashboard",
  };
}

function workItem(id: string): WorkItem {
  return {
    id,
    payload: { briefPath: "briefs/dashboard/brief.md", kind: "brief" },
    repo: "pando",
    source: "brief",
    title: "Build minimal dashboard",
  };
}
