import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mocked } from "vitest";
import { DashboardApp } from "./App";
import type { PandoApiClient } from "../../src/api/client";
import type {
  ApiAnalyticsResponse,
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

  it("renders failure analytics and readiness blockers from the analytics endpoint", async () => {
    const client = createMockClient();

    render(<DashboardApp client={client} />);

    const panel = await screen.findByTestId("analytics-panel");
    expect(within(panel).getByText("pass 50% (2/4)")).toBeVisible();
    expect(within(panel).getByText("test gate failed with exit code 1")).toBeVisible();

    const readiness = within(panel).getByTestId("readiness-section");
    expect(within(readiness).getByText("claude not logged in")).toBeVisible();
    expect(within(readiness).getByText("target=docker")).toBeVisible();
    expect(within(readiness).getByText("blocked")).toBeVisible();
    expect(client.analytics).toHaveBeenCalled();
  });

  it("renders health with the private-network auth assumption", async () => {
    const client = createMockClient();

    render(<DashboardApp client={client} />);

    expect(await screen.findByText("pando ok")).toBeVisible();
    expect(screen.getByText("jobCount=2")).toBeVisible();
    expect(screen.getByText("auth=private-network")).toBeVisible();
    expect(screen.getByText(/Private network boundary/i)).toBeVisible();
  });

  it("renders dashboard chrome through shadcn-style primitives", async () => {
    const client = createMockClient();

    render(<DashboardApp client={client} />);

    expect(await screen.findByLabelText("Daemon health")).toHaveAttribute("data-slot", "card");
    expect(screen.getAllByRole("button", { name: "Refresh" })[0]).toHaveAttribute(
      "data-slot",
      "button",
    );
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

  it("submits an inline natural-language brief with references through the client", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await screen.findByRole("button", { name: /open DEMO-5001/i });
    await user.click(screen.getByRole("button", { name: "Describe task" }));

    expect(screen.getByText("Repo is required")).toBeVisible();
    expect(screen.getByText("ID is required")).toBeVisible();
    expect(client.submitBrief).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Task repo"), "pando");
    await user.type(screen.getByLabelText("Task ID"), "footer-year");
    await user.type(screen.getByLabelText("Task title"), "Make the footer year dynamic");
    await user.type(
      screen.getByLabelText("What to build"),
      "The footer should show the current year automatically.",
    );
    await user.type(
      screen.getByLabelText("References (one per line)"),
      "src/footer.tsx\ndocs/spec.md",
    );
    await user.click(screen.getByRole("button", { name: "Describe task" }));

    await waitFor(() =>
      expect(client.submitBrief).toHaveBeenCalledWith({
        brief: {
          assets: ["src/footer.tsx", "docs/spec.md"],
          body: "The footer should show the current year automatically.",
          title: "Make the footer year dynamic",
        },
        id: "footer-year",
        repo: "pando",
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

    // branch comes from the API job.branch field
    expect(within(strip).getByText("feat/operations-pass")).toBeVisible();
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

  it("shows the API branch in the context strip, not the worktree slug", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const strip = await screen.findByTestId("context-strip");
    // fixture branch="feat/operations-pass"; worktreePath slug is "feat-w5-minimal-dashboard"
    expect(within(strip).getByText("feat/operations-pass")).toBeVisible();
    expect(within(strip).queryByText("feat-w5-minimal-dashboard")).toBeNull();
  });

  it("falls back to '-' for branch when the API branch is missing", async () => {
    const client = createMockClient();
    client.getJob.mockResolvedValue(jobDetailWithNullBranch());
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const strip = await screen.findByTestId("context-strip");
    const branchCell = within(strip).getByText("Branch").closest("div") as HTMLElement;
    expect(within(branchCell).getByText("-")).toBeVisible();
    // never fall back to the worktree slug
    expect(within(strip).queryByText("feat-w5-minimal-dashboard")).toBeNull();
  });

  it("renders durationMs and costUsd in a human-readable form", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    // payload.durationMs = 1234 => "1.2s"
    expect(within(eventList).getByText("1.2s")).toBeVisible();
    // payload.costUsd = 0.0123 => "$0.0123"
    expect(within(eventList).getByText("$0.0123")).toBeVisible();
  });

  it("truncates long evidence but copies the full payload", async () => {
    const client = createMockClient();
    client.getJob.mockResolvedValue(jobDetailWithLongEvidence());
    const writeText = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    const evidence = within(eventList).getByTestId("event-evidence");
    expect((evidence.textContent ?? "").length).toBeLessThan(longEvidence().length);
    expect(evidence.textContent ?? "").toContain("…");

    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    await user.click(within(eventList).getByRole("button", { name: /copy evidence/i }));
    expect(writeText).toHaveBeenCalledWith(longEvidence());
  });

  it("does not truncate short evidence and still offers copy", async () => {
    const client = createMockClient();
    const writeText = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    const evidence = within(eventList).getByTestId("event-evidence");
    expect(evidence.textContent).toBe('{"changed":["src/example.test.ts"]}');

    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    await user.click(within(eventList).getByRole("button", { name: /copy evidence/i }));
    expect(writeText).toHaveBeenCalledWith('{"changed":["src/example.test.ts"]}');
  });
});

function createMockClient(): Mocked<PandoApiClient> {
  return {
    analytics: vi.fn(async () => analytics()),
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

function analytics(): ApiAnalyticsResponse {
  return {
    failures: {
      failureReasons: [
        { count: 2, reason: "test gate failed with exit code 1", terminalStatus: "failure" },
      ],
      passRate: 0.5,
      totalJobs: 4,
      totals: {
        cancel: 0,
        escalated: 0,
        failure: 2,
        retried: 0,
        running: 0,
        success: 2,
        timeout: 0,
      },
    },
    generatedAt: "2026-06-07T00:00:00.000Z",
    readiness: {
      blockers: ["claude not logged in"],
      checks: [
        { name: "auth", pass: false },
        { name: "mounts", pass: true },
      ],
      mode: "live",
      ok: false,
      target: "docker",
    },
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
          costUsd: 0.0123,
          durationMs: 1234,
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

function jobDetailWithNullBranch(): ApiJobDetailResponse {
  const base = jobDetail();
  return {
    ...base,
    job: { ...base.job, branch: null },
  };
}

const LONG_EVIDENCE = `{"changed":[${Array.from(
  { length: 40 },
  (_, index) => `"src/file-${index}.test.ts"`,
).join(",")}]}`;

function longEvidence(): string {
  return LONG_EVIDENCE;
}

function jobDetailWithLongEvidence(): ApiJobDetailResponse {
  const base = jobDetail();
  return {
    ...base,
    recentEvents: [
      {
        ...base.recentEvents[0]!,
        evidence: LONG_EVIDENCE,
        sequence: 3,
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
    branch: "feat/operations-pass",
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
