import { expect, test } from "@playwright/test";

test("loads jobs, opens detail, calls an action, and shows health", async ({ page }) => {
  let retryCalls = 0;

  await page.route(/\/health$/, async (route) => {
    await route.fulfill(jsonEnvelope(health()));
  });
  await page.route(/\/jobs\/DEMO-5001\/retry$/, async (route) => {
    retryCalls += 1;
    await route.fulfill(
      jsonEnvelope({
        action: { status: "retried", type: "retry" },
        job: jobSummary(),
      }),
    );
  });
  await page.route(/\/jobs\/DEMO-5001$/, async (route) => {
    await route.fulfill(
      jsonEnvelope({
        job: {
          ...jobSummary(),
          workItem: {
            id: "DEMO-5001",
            payload: { briefPath: "briefs/dashboard/brief.md", kind: "brief" },
            repo: "pando",
            source: "brief",
            title: "Build minimal dashboard",
          },
        },
        recentEvents: [
          {
            createdAt: "2026-06-06T00:01:00.000Z",
            evidence: '{"changed":["src/example.test.ts"]}',
            gateName: "checksum",
            jobId: "DEMO-5001",
            payload: { reason: "checksum mismatch" },
            reason: "checksum mismatch",
            sequence: 1,
            stage: "IMPL",
            status: "FAILED",
            type: "stage-failed",
          },
        ],
      }),
    );
  });
  await page.route(/\/jobs(?:\?.*)?$/, async (route) => {
    await route.fulfill(jsonEnvelope({ jobs: [jobSummary()] }));
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: /open DEMO-5001/i })).toBeVisible();
  await expect(page.getByText("auth=private-network")).toBeVisible();

  await page.getByRole("button", { name: /open DEMO-5001/i }).click();
  await expect(page.getByRole("heading", { name: "DEMO-5001" })).toBeVisible();
  await expect(page.getByTestId("stop-reason").getByText("checksum mismatch")).toBeVisible();

  await page.getByRole("button", { name: "Retry from IMPL" }).click();
  await expect.poll(() => retryCalls).toBe(1);
});

function jsonEnvelope(data: unknown) {
  return {
    body: JSON.stringify({ data, ok: true }),
    contentType: "application/json",
  };
}

function health() {
  return {
    apiVersion: "v1",
    auth: { mode: "private-network" },
    daemon: { status: "ok" },
    service: "pando",
    status: "ok",
    store: { jobCount: 1, status: "ok" },
  };
}

function jobSummary() {
  return {
    attemptsLeft: 2,
    cancelRequestedAt: null,
    createdAt: "2026-06-06T00:00:00.000Z",
    finishedAt: null,
    jobId: "DEMO-5001",
    repo: "pando",
    source: "brief",
    startedAt: "2026-06-06T00:00:10.000Z",
    status: "FAILED",
    title: "Build minimal dashboard",
    updatedAt: "2026-06-06T00:02:00.000Z",
    worktreePath: "/worktrees/pando/feat-w5-minimal-dashboard",
  };
}
