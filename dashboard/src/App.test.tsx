import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, type Mock } from "bun:test";
import { act } from "react";
import { DashboardApp } from "./App";
import { PandoApiClientError } from "../../src/api/client";
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

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any ? Mock<T[K]> : T[K];
};

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

  it("renders queue summary counts from the loaded jobs", async () => {
    const client = createMockClient();
    client.listJobs.mockResolvedValue({
      jobs: jobsWithStatuses("SUMMARY", [
        "QUEUED",
        "SPEC",
        "PLAN",
        "TEST",
        "IMPL",
        "REVIEW",
        "PR",
        "DONE",
        "FAILED",
        "ESCALATED",
        "CANCELED",
      ]),
    });

    render(<DashboardApp client={client} />);

    const summary = await screen.findByLabelText("Queue summary");
    expectQueueMetric(summary, "Total", "11");
    expectQueueMetric(summary, "Active", "7");
    expectQueueMetric(summary, "Failed", "1");
    expectQueueMetric(summary, "Done", "1");

    const jobsPanel = screen.getByRole("region", { name: "Jobs" });
    const tabs = within(jobsPanel).getByRole("tablist", { name: "Job status" });
    const table = within(jobsPanel).getByRole("table");
    expect(tabs.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(summary.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("updates queue summary counts from filtered status tab responses", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    client.listJobs.mockImplementation(async (input) => ({
      jobs:
        input?.status === "FAILED"
          ? jobsWithStatuses("FAILED-FILTER", ["FAILED", "FAILED"])
          : jobsWithStatuses("ALL-FILTER", ["QUEUED", "DONE", "FAILED", "CANCELED"]),
    }));

    render(<DashboardApp client={client} />);

    const summary = await screen.findByLabelText("Queue summary");
    expectQueueMetric(summary, "Total", "4");
    expectQueueMetric(summary, "Active", "1");
    expectQueueMetric(summary, "Failed", "1");
    expectQueueMetric(summary, "Done", "1");
    expect(client.listJobs).toHaveBeenCalledWith(undefined);

    await user.click(screen.getByRole("tab", { name: "Failed" }));

    await waitFor(() => expect(client.listJobs).toHaveBeenLastCalledWith({ status: "FAILED" }));
    await waitFor(() => {
      const filteredSummary = screen.getByLabelText("Queue summary");
      expectQueueMetric(filteredSummary, "Total", "2");
      expectQueueMetric(filteredSummary, "Active", "0");
      expectQueueMetric(filteredSummary, "Failed", "2");
      expectQueueMetric(filteredSummary, "Done", "0");
    });
  });

  it("shows job detail work item, timeline, failure evidence, and worktree path", async () => {
    const client = createMockClient();
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    expect(await screen.findByRole("heading", { name: "DEMO-5001" })).toBeVisible();
    expect(screen.getAllByText("Build minimal dashboard").length).toBeGreaterThan(0);
    expect(screen.getByText("Work item")).toBeVisible();
    expect(screen.getByText("Stage timeline")).toBeVisible();
    expect(screen.getAllByText("checksum mismatch").length).toBeGreaterThan(0);
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
    expect(within(readiness).getByText(/claude: host-file-only/i)).toBeVisible();
    expect(within(readiness).getByText(/not live-runnable/i)).toBeVisible();
    expect(client.analytics).toHaveBeenCalled();
  });

  it("shows an in-progress indicator and live badge while a job is active", async () => {
    const client = createMockClient();
    client.listJobs.mockResolvedValue({ jobs: [jobSummary("DEMO-9001", "IMPL")] });

    render(<DashboardApp client={client} />);

    expect(await screen.findByText(/auto-refresh/i)).toBeVisible();
    expect(screen.getByLabelText("in progress")).toBeVisible();
  });

  it("auto-refreshes on an interval while a job is active", async () => {
    const client = createMockClient();
    client.listJobs.mockResolvedValue({ jobs: [jobSummary("DEMO-9001", "IMPL")] });

    render(<DashboardApp client={client} />);
    await screen.findByText(/auto-refresh/i);
    const initial = client.listJobs.mock.calls.length;

    await act(async () => {
      await wait(4600);
    });
    await waitFor(() => expect(client.listJobs.mock.calls.length).toBeGreaterThan(initial));
  });

  it("does not show the live badge when all jobs are terminal", async () => {
    const client = createMockClient(); // default job is FAILED (terminal)

    render(<DashboardApp client={client} />);

    await screen.findByRole("button", { name: /open DEMO-5001/i });
    expect(screen.queryByText(/auto-refresh/i)).toBeNull();
  });

  it("shows a canceling state and disables the cancel button when a cancel is pending", async () => {
    const client = createMockClient();
    client.getJob.mockResolvedValue({
      job: {
        ...jobSummary("DEMO-5001", "IMPL"),
        cancelRequestedAt: "2026-06-06T00:05:00.000Z",
        workItem: workItem("DEMO-5001"),
      },
      recentEvents: jobDetail().recentEvents,
    });
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    expect(await screen.findByText("Canceling…")).toBeVisible();
    expect(screen.getByRole("button", { name: /cancel requested/i })).toBeDisabled();
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

    await user.selectOptions(screen.getByLabelText("Repo"), "pando");
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
    expect(screen.getByText("Add at least one acceptance criterion")).toBeVisible();
    expect(client.submitBrief).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByLabelText("Task repo"), "pando");
    await user.type(screen.getByLabelText("Task ID"), "footer-year");
    await user.type(screen.getByLabelText("Task title"), "Make the footer year dynamic");
    await user.type(
      screen.getByLabelText("What to build"),
      "The footer should show the current year automatically.",
    );
    await user.type(
      screen.getByLabelText("Acceptance criteria (one per line)"),
      "The footer shows the current year\nNo code files change",
    );
    await user.type(
      screen.getByLabelText("References (one per line)"),
      "src/footer.tsx\ndocs/spec.md",
    );
    await user.click(screen.getByRole("button", { name: "Describe task" }));

    await waitFor(() =>
      expect(client.submitBrief).toHaveBeenCalledWith({
        brief: {
          acceptanceCriteria: ["The footer shows the current year", "No code files change"],
          assets: ["src/footer.tsx", "docs/spec.md"],
          body: "The footer should show the current year automatically.",
          title: "Make the footer year dynamic",
        },
        id: "footer-year",
        repo: "pando",
      }),
    );
  });

  it("surfaces an inline brief API rejection instead of failing silently", async () => {
    const client = createMockClient();
    client.submitBrief.mockRejectedValue(
      new PandoApiClientError(400, "invalid_brief", "inline brief schema validation failed"),
    );
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await screen.findByRole("button", { name: /open DEMO-5001/i });
    await user.selectOptions(screen.getByLabelText("Task repo"), "pando");
    await user.type(screen.getByLabelText("Task ID"), "footer-year");
    await user.type(screen.getByLabelText("What to build"), "Make the footer year dynamic.");
    await user.type(
      screen.getByLabelText("Acceptance criteria (one per line)"),
      "The footer shows the current year",
    );
    await user.click(screen.getByRole("button", { name: "Describe task" }));

    expect(await screen.findByText(/inline brief schema validation failed/i)).toBeVisible();
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

  // Stage timeline shows the gate that ran for a stage
  it("stage timeline shows the gate name for a stage", async () => {
    const client = createMockClient(); // fixture event has gateName: "checksum"
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    expect(within(eventList).getByText("checksum")).toBeVisible();
  });

  // The noisy null-status "-" badge is gone; a gate-less stage renders no dash
  it("stage timeline renders no '-' noise for events without a gate or status", async () => {
    const client = createMockClient();
    client.getJob.mockResolvedValue(jobDetailWithNullGateName());
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    expect(within(eventList).queryByText("-")).toBeNull();
    expect(within(eventList).getByText("failed")).toBeVisible();
  });

  // Stage timeline shows the stage outcome, not the raw per-event status
  it("stage timeline shows the stage outcome", async () => {
    const client = createMockClient(); // fixture stage-failed at IMPL
    const user = userEvent.setup();
    render(<DashboardApp client={client} />);

    await user.click(await screen.findByRole("button", { name: /open DEMO-5001/i }));

    const eventList = await screen.findByRole("list");
    expect(within(eventList).getByText("failed")).toBeVisible();
    expect(within(eventList).getByText("IMPL")).toBeVisible();
  });

  // Evidence text stays visible in the stage timeline
  it("stage timeline shows evidence text when non-null", async () => {
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
    listRepos: vi.fn(async () => ({ repos: [{ name: "pando" }, { name: "web" }] })),
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
      claude: {
        blocker: {
          nextCommands: ["export ANTHROPIC_API_KEY=..."],
          reason: "Claude host-file auth is only a readiness signal in Docker.",
        },
        liveRunnable: false,
        mode: "host-file-only",
      },
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

function jobsWithStatuses(prefix: string, statuses: JobStatus[]): ApiJobSummary[] {
  return statuses.map((status, index) => jobSummary(`${prefix}-${index + 1}`, status));
}

function expectQueueMetric(summary: HTMLElement, label: string, value: string): void {
  expect(summary).toHaveTextContent(new RegExp(`${label}\\s*${value}`));
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
