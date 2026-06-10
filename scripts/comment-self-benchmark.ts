#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { SelfBenchmarkSummary } from "../src/daemon/self-benchmark";
import {
  createGitHubIssueCommentClient,
  renderSelfBenchmarkPrComment,
  upsertBenchmarkPrComment,
} from "../src/daemon/self-benchmark-comment";

const execFileAsync = promisify(execFile);
const BENCHMARK_ARTIFACT_PREFIX = "pando-self-benchmark-";
const DEFAULT_BASELINE_WORKFLOW = "CI";

interface Args {
  summaryPath?: string;
  baselineSummaryPath?: string;
  baselineBranch?: string;
  baselineWorkflow?: string;
  prNumber?: number;
  owner?: string;
  repo?: string;
}

const args = parseArgs(process.argv.slice(2));
const summaryPath = required(args.summaryPath, "--summary");
const prNumber =
  args.prNumber ??
  positiveInteger(required(process.env.GITHUB_PR_NUMBER, "GITHUB_PR_NUMBER"), "GITHUB_PR_NUMBER");
const token = required(process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, "GITHUB_TOKEN");
const repository = repositoryParts(
  args,
  required(process.env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY"),
);
const summary = JSON.parse(await readFile(summaryPath, "utf8")) as SelfBenchmarkSummary;
const baseline = await resolveBaselineSummary({
  args,
  repository,
  token,
});
const body = renderSelfBenchmarkPrComment(summary, { baseline });
const result = await upsertBenchmarkPrComment({
  body,
  client: createGitHubIssueCommentClient({ token }),
  issueNumber: prNumber,
  owner: repository.owner,
  repo: repository.repo,
});

console.log(`${result.action} pando self-benchmark PR comment #${result.commentId}`);

function parseArgs(argv: readonly string[]): Args {
  const parsed: Args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") continue;
    if (token === "--summary") {
      parsed.summaryPath = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--baseline-summary") {
      parsed.baselineSummaryPath = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--baseline-branch") {
      parsed.baselineBranch = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--baseline-workflow") {
      parsed.baselineWorkflow = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--pr") {
      parsed.prNumber = positiveInteger(readValue(argv, index, token), token);
      index += 1;
      continue;
    }
    if (token === "--owner") {
      parsed.owner = readValue(argv, index, token);
      index += 1;
      continue;
    }
    if (token === "--repo") {
      parsed.repo = readValue(argv, index, token);
      index += 1;
      continue;
    }

    throw new Error(`unknown option: ${token}`);
  }

  return parsed;
}

async function resolveBaselineSummary(input: {
  args: Args;
  repository: { owner: string; repo: string };
  token: string;
}): Promise<SelfBenchmarkSummary | undefined> {
  if (input.args.baselineSummaryPath !== undefined) {
    return JSON.parse(
      await readFile(input.args.baselineSummaryPath, "utf8"),
    ) as SelfBenchmarkSummary;
  }

  if (input.args.baselineBranch === undefined) {
    return undefined;
  }

  try {
    const baseline = await downloadLatestBenchmarkSummary({
      apiUrl: process.env.GITHUB_API_URL,
      branch: input.args.baselineBranch,
      currentRunId: process.env.GITHUB_RUN_ID,
      owner: input.repository.owner,
      repo: input.repository.repo,
      token: input.token,
      workflowName: input.args.baselineWorkflow ?? DEFAULT_BASELINE_WORKFLOW,
    });

    if (baseline === undefined) {
      console.warn(
        `No ${BENCHMARK_ARTIFACT_PREFIX} artifact found on ${input.args.baselineBranch}; rendering current benchmark only.`,
      );
      return undefined;
    }

    console.log(`Using benchmark baseline ${baseline.runId} from ${input.args.baselineBranch}`);
    return baseline;
  } catch (error) {
    console.warn(`Benchmark baseline unavailable: ${errorMessage(error)}`);
    return undefined;
  }
}

async function downloadLatestBenchmarkSummary(input: {
  owner: string;
  repo: string;
  branch: string;
  workflowName: string;
  token: string;
  apiUrl?: string;
  currentRunId?: string;
}): Promise<SelfBenchmarkSummary | undefined> {
  const apiUrl = (input.apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
  const runsQuery = new URLSearchParams({
    branch: input.branch,
    per_page: "20",
    status: "success",
  });
  const runs = await githubJson<GitHubWorkflowRunsResponse>({
    token: input.token,
    url: `${apiUrl}/repos/${input.owner}/${input.repo}/actions/runs?${runsQuery.toString()}`,
  });

  for (const run of runs.workflow_runs ?? []) {
    if (run.name !== input.workflowName) continue;
    if (input.currentRunId !== undefined && `${run.id}` === input.currentRunId) continue;

    const artifacts = await githubJson<GitHubArtifactsResponse>({
      token: input.token,
      url: `${apiUrl}/repos/${input.owner}/${input.repo}/actions/runs/${run.id}/artifacts?per_page=100`,
    });
    const artifact = (artifacts.artifacts ?? []).find(
      (candidate) => !candidate.expired && candidate.name.startsWith(BENCHMARK_ARTIFACT_PREFIX),
    );
    if (artifact === undefined) continue;

    const zipBytes = await githubBytes({
      token: input.token,
      url: `${apiUrl}/repos/${input.owner}/${input.repo}/actions/artifacts/${artifact.id}/zip`,
    });
    return extractBenchmarkSummary(zipBytes);
  }

  return undefined;
}

interface GitHubWorkflowRunsResponse {
  workflow_runs?: GitHubWorkflowRun[];
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
}

interface GitHubArtifactsResponse {
  artifacts?: GitHubArtifact[];
}

interface GitHubArtifact {
  expired: boolean;
  id: number;
  name: string;
}

async function githubJson<T>(input: { url: string; token: string }): Promise<T> {
  const response = await githubFetch(input);
  return (await response.json()) as T;
}

async function githubBytes(input: { url: string; token: string }): Promise<Uint8Array> {
  const response = await githubFetch(input);
  return new Uint8Array(await response.arrayBuffer());
}

async function githubFetch(input: { url: string; token: string }): Promise<Response> {
  const response = await fetch(input.url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `token ${input.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.ok) return response;

  throw new Error(`GitHub API ${input.url} failed: ${response.status} ${await response.text()}`);
}

async function extractBenchmarkSummary(zipBytes: Uint8Array): Promise<SelfBenchmarkSummary> {
  const dir = await mkdtemp(join(tmpdir(), "pando-benchmark-baseline-"));
  const zipPath = join(dir, "artifact.zip");

  try {
    await writeFile(zipPath, zipBytes);
    const { stdout } = await execFileAsync("unzip", ["-p", zipPath, "benchmark.json"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(String(stdout)) as SelfBenchmarkSummary;
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

function repositoryParts(args: Args, envRepository: string): { owner: string; repo: string } {
  if (args.owner !== undefined && args.repo !== undefined) {
    return { owner: args.owner, repo: args.repo };
  }

  const [owner, repo] = envRepository.split("/");
  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
    throw new Error("GITHUB_REPOSITORY: expected owner/repo");
  }

  return { owner, repo };
}

function readValue(argv: readonly string[], index: number, token: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${token}: expected value`);
  }
  return value;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`${name}: expected value`);
  }
  return value;
}

function positiveInteger(value: string, token: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${token}: expected positive integer`);
  }
  return parsed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
