import type { SelfBenchmarkSummary } from "./self-benchmark";

export const BENCHMARK_COMMENT_MARKER = "<!-- pando-self-benchmark -->";

export interface GitHubIssueComment {
  id: number;
  body?: string | null;
}

export interface GitHubIssueCommentClient {
  listIssueComments(input: GitHubIssueInput): Promise<GitHubIssueComment[]>;
  createIssueComment(input: GitHubIssueInput & { body: string }): Promise<{ id: number }>;
  updateIssueComment(input: GitHubRepoInput & { commentId: number; body: string }): Promise<void>;
}

export interface GitHubRepoInput {
  owner: string;
  repo: string;
}

export interface GitHubIssueInput extends GitHubRepoInput {
  issueNumber: number;
}

export interface UpsertBenchmarkPrCommentInput extends GitHubIssueInput {
  body: string;
  client: GitHubIssueCommentClient;
}

export type UpsertBenchmarkPrCommentResult =
  | { action: "created"; commentId: number }
  | { action: "updated"; commentId: number };

export function renderSelfBenchmarkPrComment(summary: SelfBenchmarkSummary): string {
  const lines = [
    BENCHMARK_COMMENT_MARKER,
    "## Pando self-benchmark",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Status | ${summary.ok ? "passed" : "failed"} |`,
    `| Total duration | ${summary.totals.totalMs} ms |`,
    `| Package manager | ${summary.packageManager} |`,
    `| Runtime | ${summary.runtime.name} ${summary.runtime.version} |`,
    `| Run ID | ${summary.runId} |`,
    `| Generated at | ${summary.generatedAt} |`,
    `| Jobs | ${summary.totals.jobs} |`,
    `| Success | ${summary.totals.success} |`,
    `| Failure | ${summary.totals.failure} |`,
    "",
    "### Stage durations",
    "",
    "| Stage | Total ms | Mean ms | Min ms | Max ms | Completed | Failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.stageDurations.map(
      (stage) =>
        `| ${stage.stage} | ${stage.totalMs} | ${stage.meanMs} | ${stage.minMs} | ${stage.maxMs} | ${stage.completed} | ${stage.failed} |`,
    ),
    "",
    "Full benchmark JSON, Markdown, smoke evidence, and failure summary are attached to this workflow run as the `pando-self-benchmark-*` artifact.",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

export async function upsertBenchmarkPrComment(
  input: UpsertBenchmarkPrCommentInput,
): Promise<UpsertBenchmarkPrCommentResult> {
  const comments = await input.client.listIssueComments(input);
  const existing = comments.find((comment) => comment.body?.includes(BENCHMARK_COMMENT_MARKER));

  if (existing !== undefined) {
    await input.client.updateIssueComment({
      body: input.body,
      commentId: existing.id,
      owner: input.owner,
      repo: input.repo,
    });
    return { action: "updated", commentId: existing.id };
  }

  const created = await input.client.createIssueComment(input);
  return { action: "created", commentId: created.id };
}

export function createGitHubIssueCommentClient(opts: {
  token: string;
  apiUrl?: string;
  fetchImpl?: FetchLike;
}): GitHubIssueCommentClient {
  const apiUrl = (opts.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;

  return {
    async createIssueComment(input) {
      return requestJson<{ id: number }>(fetchImpl, {
        body: { body: input.body },
        method: "POST",
        token: opts.token,
        url: `${apiUrl}/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
      });
    },
    async listIssueComments(input) {
      return requestJson<GitHubIssueComment[]>(fetchImpl, {
        method: "GET",
        token: opts.token,
        url: `${apiUrl}/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments?per_page=100`,
      });
    },
    async updateIssueComment(input) {
      await requestJson<GitHubIssueComment>(fetchImpl, {
        body: { body: input.body },
        method: "PATCH",
        token: opts.token,
        url: `${apiUrl}/repos/${input.owner}/${input.repo}/issues/comments/${input.commentId}`,
      });
    },
  };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function requestJson<T>(
  fetchImpl: FetchLike,
  opts: {
    method: "GET" | "PATCH" | "POST";
    url: string;
    token: string;
    body?: unknown;
  },
): Promise<T> {
  const response = await fetchImpl(opts.url, {
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `token ${opts.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    method: opts.method,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `GitHub comment API ${opts.method} ${opts.url} failed: ${response.status} ${detail}`,
    );
  }

  return (await response.json()) as T;
}
