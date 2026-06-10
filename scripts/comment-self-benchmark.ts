#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import process from "node:process";
import type { SelfBenchmarkSummary } from "../src/daemon/self-benchmark";
import {
  createGitHubIssueCommentClient,
  renderSelfBenchmarkPrComment,
  upsertBenchmarkPrComment,
} from "../src/daemon/self-benchmark-comment";

interface Args {
  summaryPath?: string;
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
const body = renderSelfBenchmarkPrComment(summary);
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
