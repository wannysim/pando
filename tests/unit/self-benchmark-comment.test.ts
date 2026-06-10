import { describe, expect, it } from "bun:test";
import type { SelfBenchmarkSummary } from "../../src/daemon/self-benchmark";
import {
  BENCHMARK_COMMENT_MARKER,
  createGitHubIssueCommentClient,
  renderSelfBenchmarkPrComment,
  upsertBenchmarkPrComment,
  type GitHubIssueCommentClient,
} from "../../src/daemon/self-benchmark-comment";

describe("self-benchmark PR comments", () => {
  it("renders the benchmark summary as a PR comment with metric and stage tables", () => {
    const body = renderSelfBenchmarkPrComment(summary());

    expect(body).toContain(BENCHMARK_COMMENT_MARKER);
    expect(body).toContain("## Pando self-benchmark");
    expect(body).toContain("| Total duration | 13314 ms |");
    expect(body).toContain("| Package manager | bun@1.3.5 |");
    expect(body).toContain("| TEST | 11807 | 11807 | 11807 | 11807 | 1 | 0 |");
    expect(body).not.toContain("/tmp/");
  });

  it("renders a baseline comparison table with percentage improvement", () => {
    const baseline = summary({
      packageManager: "pnpm@11.5.2",
      runId: "ci-baseline",
      stageTotalMs: 16_000,
      totalMs: 20_000,
    });
    const body = renderSelfBenchmarkPrComment(summary(), { baseline });

    expect(body).toContain("### Baseline comparison");
    expect(body).toContain("| Baseline run | ci-baseline |");
    expect(body).toContain("| Baseline package manager | pnpm@11.5.2 |");
    expect(body).toContain("| Total | 20000 | 13314 | -6686 | +33.43% faster |");
    expect(body).toContain("| TEST | 16000 | 11807 | -4193 | +26.21% faster |");
  });

  it("marks slower benchmark comparisons as negative improvement", () => {
    const baseline = summary({
      packageManager: "pnpm@11.5.2",
      runId: "ci-baseline",
      stageTotalMs: 8_000,
      totalMs: 10_000,
    });
    const body = renderSelfBenchmarkPrComment(summary(), { baseline });

    expect(body).toContain("| Total | 10000 | 13314 | 3314 | -33.14% slower |");
    expect(body).toContain("| TEST | 8000 | 11807 | 3807 | -47.59% slower |");
  });

  it("updates an existing benchmark comment when the marker is present", async () => {
    const client = fakeClient([{ body: `old\n${BENCHMARK_COMMENT_MARKER}`, id: 10 }]);
    const result = await upsertBenchmarkPrComment({
      body: "new body",
      client,
      issueNumber: 7,
      owner: "wannysim",
      repo: "pando",
    });

    expect(result).toEqual({ action: "updated", commentId: 10 });
    expect(client.calls).toEqual(["list:wannysim/pando#7", "update:wannysim/pando#10:new body"]);
  });

  it("creates a benchmark comment when no marker is present", async () => {
    const client = fakeClient([{ body: "unrelated", id: 10 }]);
    const result = await upsertBenchmarkPrComment({
      body: "new body",
      client,
      issueNumber: 7,
      owner: "wannysim",
      repo: "pando",
    });

    expect(result).toEqual({ action: "created", commentId: 11 });
    expect(client.calls).toEqual(["list:wannysim/pando#7", "create:wannysim/pando#7:new body"]);
  });

  it("authenticates GitHub REST requests with the token scheme accepted by Actions tokens", async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = [];
    const client = createGitHubIssueCommentClient({
      apiUrl: "https://api.github.test",
      fetchImpl: async (input, init) => {
        requests.push({ input, init });
        return jsonResponse([]);
      },
      token: "github-token",
    });

    await client.listIssueComments({ issueNumber: 7, owner: "wannysim", repo: "pando" });

    expect(requests[0]?.input).toBe(
      "https://api.github.test/repos/wannysim/pando/issues/7/comments?per_page=100",
    );
    expect(requests[0]?.init?.headers).toMatchObject({
      Accept: "application/vnd.github+json",
      Authorization: "token github-token",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });

  it("retries transient GitHub comment API failures before succeeding", async () => {
    const statuses = [500, 502, 200];
    const client = createGitHubIssueCommentClient({
      apiUrl: "https://api.github.test",
      fetchImpl: async () => {
        const status = statuses.shift() ?? 200;
        return status === 200 ? jsonResponse([{ body: "ok", id: 12 }]) : textResponse(status);
      },
      retryDelaysMs: [0, 0],
      token: "github-token",
    });

    await expect(
      client.listIssueComments({ issueNumber: 7, owner: "wannysim", repo: "pando" }),
    ).resolves.toEqual([{ body: "ok", id: 12 }]);
    expect(statuses).toEqual([]);
  });

  it("does not retry non-transient GitHub comment API failures", async () => {
    let requests = 0;
    const client = createGitHubIssueCommentClient({
      apiUrl: "https://api.github.test",
      fetchImpl: async () => {
        requests += 1;
        return textResponse(401);
      },
      retryDelaysMs: [0, 0],
      token: "github-token",
    });

    await expect(
      client.listIssueComments({ issueNumber: 7, owner: "wannysim", repo: "pando" }),
    ).rejects.toThrow(/failed: 401/);
    expect(requests).toBe(1);
  });
});

function fakeClient(initialComments: Array<{ id: number; body?: string }>) {
  const calls: string[] = [];
  const client: GitHubIssueCommentClient & { calls: string[] } = {
    calls,
    async createIssueComment(input) {
      calls.push(`create:${input.owner}/${input.repo}#${input.issueNumber}:${input.body}`);
      return { id: 11 };
    },
    async listIssueComments(input) {
      calls.push(`list:${input.owner}/${input.repo}#${input.issueNumber}`);
      return initialComments;
    },
    async updateIssueComment(input) {
      calls.push(`update:${input.owner}/${input.repo}#${input.commentId}:${input.body}`);
    },
  };
  return client;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

function textResponse(status: number): Response {
  return new Response("try again", { status });
}

function summary(
  overrides: {
    packageManager?: string;
    runId?: string;
    stageTotalMs?: number;
    totalMs?: number;
  } = {},
): SelfBenchmarkSummary {
  const stageTotalMs = overrides.stageTotalMs ?? 11_807;

  return {
    artifacts: {
      evidencePath: "/tmp/pando-self-benchmark/full-daemon-smoke.json",
      failureSummaryPath: "/tmp/pando-self-benchmark/failure-summary.json",
      markdownPath: "/tmp/pando-self-benchmark/benchmark.md",
      summaryPath: "/tmp/pando-self-benchmark/benchmark.json",
    },
    checks: {
      gateEvidence: { pass: true },
      globalConcurrency: { value: 2, withinLiveCap: true },
      jobsClaimed: { actual: 1, expected: 1, pass: true },
      providerCap: { pass: true, usage: {} },
      worktreeCollision: { pass: true },
    },
    generatedAt: "2026-06-10T14:53:17.024Z",
    jobs: [],
    mode: "contract",
    ok: true,
    packageManager: overrides.packageManager ?? "bun@1.3.5",
    runId: overrides.runId ?? "local-check",
    runner: {
      gateMode: "shell",
      globalConcurrency: 2,
      jobCount: 1,
      kind: "full-daemon-smoke",
      worktreeMode: "current-checkout",
    },
    runtime: {
      name: "node",
      version: "v24.11.1",
    },
    schemaVersion: 1,
    stageDurations: [
      {
        completed: 1,
        count: 1,
        failed: 0,
        maxMs: stageTotalMs,
        meanMs: stageTotalMs,
        minMs: stageTotalMs,
        stage: "TEST",
        totalMs: stageTotalMs,
      },
    ],
    totals: {
      cancel: 0,
      escalated: 0,
      failure: 0,
      jobs: 1,
      retried: 0,
      running: 0,
      success: 1,
      timeout: 0,
      totalMs: overrides.totalMs ?? 13_314,
    },
  };
}
