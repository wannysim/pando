import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createPandoApiClient, type PandoApiClient, type PandoApiFetch } from "../api/client";
import { formatStatusList, isJobStatus, type ApiHealth, type ApiJobSummary } from "../api/schema";
import { STAGE_ORDER } from "../core/state-machine";
import type { JobStatus, StageName, WorkItem } from "../core/types";
import type { JobEventRecord, JobStore } from "../db/index";
import { loadBriefWorkItem, type BriefFileReader } from "../intake/brief";
import { removeWorktree } from "../worktree/manager";

export interface WorktreeCleaner {
  cleanup(input: WorktreeCleanupInput): Promise<void>;
}

export interface WorktreeCleanupInput {
  jobId: string;
  repo: string;
  repoPath?: string;
  worktreePath: string;
}

export interface SmokeRunInput {
  args: readonly string[];
}

export interface SmokeRunResult {
  evidencePath: string;
  exitCode: number;
}

export interface SmokeRunner {
  (input: SmokeRunInput): Promise<SmokeRunResult>;
}

export interface AgentctlOptions {
  store: JobStore;
  apiBaseUrl?: string;
  apiClient?: PandoApiClient;
  apiFetch?: PandoApiFetch;
  briefReader?: BriefFileReader;
  worktreeCleaner?: WorktreeCleaner;
  smokeRunner?: SmokeRunner;
  sleep?: (ms: number) => Promise<void>;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  defaultRetryBudget?: number;
}

const TERMINAL_STATUSES: readonly JobStatus[] = ["DONE", "FAILED", "ESCALATED", "CANCELED"];
const DEFAULT_WATCH_INTERVAL_MS = 2000;
const SMOKE_TARGETS: readonly string[] = ["host", "docker"];

export async function runAgentctl(args: readonly string[], opts: AgentctlOptions): Promise<number> {
  const stdout = opts.stdout ?? (() => {});
  const stderr = opts.stderr ?? (() => {});

  try {
    const parsed = parseArgs(args);
    const [command, subcommand, id] = parsed.positionals;

    if (command === "submit" && subcommand === "jira" && id !== undefined) {
      const job = opts.store.enqueueJob({
        item: jiraWorkItem(id, parsed),
        retryBudget: optionInt(parsed, "attempts") ?? opts.defaultRetryBudget ?? 10,
      });
      stdout(`queued ${job.item.id}`);
      return 0;
    }

    if (command === "submit" && subcommand === "brief") {
      const item = await briefWorkItem(parsed, opts.briefReader ?? nodeFileReader());
      const job = opts.store.enqueueJob({
        item,
        retryBudget: optionInt(parsed, "attempts") ?? opts.defaultRetryBudget ?? 10,
      });
      stdout(`queued ${job.item.id}`);
      return 0;
    }

    if (command === "show" && subcommand !== undefined) {
      return showJob(subcommand, opts.store, stdout, stderr);
    }

    if (command === "list") {
      const status = statusOption(parsed, "status");
      const listInput = status === undefined ? undefined : { status };
      if (parsed.flags.has("watch")) {
        return await watchList(listInput, parsed, opts, stdout);
      }
      const response = await configuredApiClient(opts).listJobs(listInput);
      for (const job of response.jobs) stdout(formatApiJobSummary(job));
      return 0;
    }

    if (command === "watch" && subcommand !== undefined) {
      return await watchJob(subcommand, parsed, opts, stdout);
    }

    if (command === "smoke" && subcommand === "readiness") {
      return await runReadinessSmoke(parsed, opts, stdout);
    }

    if (command === "daemon" && subcommand === "status") {
      const health = await configuredApiClient(opts).health();
      for (const line of formatDaemonHealth(health)) stdout(line);
      return 0;
    }

    if (command === "retry" && subcommand !== undefined) {
      const from = stageOption(parsed, "from");
      const attemptsLeft = optionInt(parsed, "attempts") ?? opts.defaultRetryBudget ?? 10;
      if (hasApiConfigured(opts)) {
        const response = await configuredApiClient(opts).retryJob(subcommand, {
          attemptsLeft,
          from,
        });
        stdout(`retry queued ${response.job.jobId} from ${from}`);
        return 0;
      }
      const job = opts.store.retryJob({
        attemptsLeft,
        from,
        jobId: subcommand,
      });
      stdout(`retry queued ${job.item.id} from ${from}`);
      return 0;
    }

    if (command === "cancel" && subcommand !== undefined) {
      const reason = optional(parsed, "reason");
      if (hasApiConfigured(opts)) {
        const response = await configuredApiClient(opts).cancelJob(subcommand, { reason });
        stdout(
          response.action.status === "canceled"
            ? `canceled ${response.job.jobId}`
            : `cancel requested ${response.job.jobId}`,
        );
        return 0;
      }
      const job = opts.store.cancelJob({
        jobId: subcommand,
        reason,
        requestedBy: "agentctl",
      });
      stdout(
        job.status === "CANCELED" ? `canceled ${job.item.id}` : `cancel requested ${job.item.id}`,
      );
      return 0;
    }

    if (command === "cleanup" && subcommand !== undefined) {
      return await cleanupJob(subcommand, opts, stdout);
    }

    stderr(usage());
    return 1;
  } catch (error) {
    stderr(formatCliError(error));
    return 1;
  }
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { createSqliteJobStore } = await import("../db/index");
  const store = createSqliteJobStore({
    path: process.env.PANDO_DB ?? "./pando.sqlite",
  });

  try {
    return await runAgentctl(args, {
      store,
      apiBaseUrl: process.env.PANDO_API_URL,
      stderr: (line) => console.error(line),
      stdout: (line) => console.log(line),
      worktreeCleaner: {
        async cleanup(input) {
          if (input.repoPath === undefined)
            throw new Error(`repo profile not found: ${input.repo}`);
          await removeWorktree({
            repoPath: input.repoPath,
            worktreePath: input.worktreePath,
          });
        },
      },
    });
  } finally {
    store.close();
  }
}

if (isDirectRun()) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

interface ParsedArgs {
  positionals: string[];
  options: Map<string, string>;
  flags: Set<string>;
}

const BOOLEAN_FLAGS: readonly string[] = ["watch"];

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    if (BOOLEAN_FLAGS.includes(key)) {
      flags.add(key);
      continue;
    }

    const value = args[index + 1];
    if (key.length === 0 || value === undefined || value.startsWith("--")) {
      throw new Error(`${token}: expected value`);
    }
    options.set(key, value);
    index += 1;
  }

  return { flags, options, positionals };
}

function jiraWorkItem(id: string, parsed: ParsedArgs): WorkItem {
  return {
    branch: optional(parsed, "branch"),
    id,
    payload: { kind: "jira", ticketKey: id },
    repo: required(parsed, "repo"),
    source: "jira",
    title: optional(parsed, "title") ?? id,
  };
}

async function briefWorkItem(parsed: ParsedArgs, reader: BriefFileReader): Promise<WorkItem> {
  const id = required(parsed, "id");
  return loadBriefWorkItem({
    briefPath: optional(parsed, "brief-path") ?? `briefs/${id}/brief.md`,
    id,
    branch: optional(parsed, "branch"),
    reader,
    repo: required(parsed, "repo"),
    title: optional(parsed, "title"),
  });
}

async function cleanupJob(
  jobId: string,
  opts: AgentctlOptions,
  stdout: (line: string) => void,
): Promise<number> {
  const request = opts.store.requestJobCleanup({
    jobId,
    requestedBy: "agentctl",
  });
  const profile = opts.store.getRepoProfile(request.job.item.repo);
  const cleaner = opts.worktreeCleaner ?? missingWorktreeCleaner();

  try {
    await cleaner.cleanup({
      jobId,
      repo: request.job.item.repo,
      repoPath: profile?.path,
      worktreePath: request.worktreePath,
    });
    opts.store.completeJobCleanup({
      jobId,
      worktreePath: request.worktreePath,
    });
    stdout(`cleaned up ${request.job.item.id} ${request.worktreePath}`);
    return 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    opts.store.failJobCleanup({
      jobId,
      reason,
      worktreePath: request.worktreePath,
    });
    throw error;
  }
}

async function watchJob(
  jobId: string,
  parsed: ParsedArgs,
  opts: AgentctlOptions,
  stdout: (line: string) => void,
): Promise<number> {
  const client = configuredApiClient(opts);
  const intervalMs = watchIntervalMs(parsed);
  const sleep = opts.sleep ?? realSleep;
  const maxPolls = optionInt(parsed, "max-polls");

  for (let poll = 0; maxPolls === undefined || poll < maxPolls; poll += 1) {
    const { job } = await client.getJob(jobId);
    stdout(formatWatchSummary(job));
    if (TERMINAL_STATUSES.includes(job.status)) return 0;
    await sleep(intervalMs);
  }
  return 0;
}

async function watchList(
  listInput: { status: JobStatus } | undefined,
  parsed: ParsedArgs,
  opts: AgentctlOptions,
  stdout: (line: string) => void,
): Promise<number> {
  const client = configuredApiClient(opts);
  const intervalMs = watchIntervalMs(parsed);
  const sleep = opts.sleep ?? realSleep;
  const maxPolls = optionInt(parsed, "max-polls");

  for (let poll = 0; maxPolls === undefined || poll < maxPolls; poll += 1) {
    const response = await client.listJobs(listInput);
    for (const job of response.jobs) stdout(formatApiJobSummary(job));
    if (maxPolls !== undefined && poll === maxPolls - 1) break;
    await sleep(intervalMs);
  }
  return 0;
}

async function runReadinessSmoke(
  parsed: ParsedArgs,
  opts: AgentctlOptions,
  stdout: (line: string) => void,
): Promise<number> {
  const target = targetOption(parsed);
  const evidencePath = optional(parsed, "evidence") ?? `/tmp/pando-readiness-smoke/${target}.json`;
  const runner = opts.smokeRunner ?? nodeSmokeRunner();
  const result = await runner({
    args: [
      "scripts/two-job-smoke.mjs",
      "--mode",
      "readiness",
      "--target",
      target,
      "--evidence",
      evidencePath,
    ],
  });
  stdout(
    `readiness smoke target=${target} exitCode=${result.exitCode} evidence=${result.evidencePath}`,
  );
  return result.exitCode;
}

function watchIntervalMs(parsed: ParsedArgs): number {
  return optionInt(parsed, "interval") ?? DEFAULT_WATCH_INTERVAL_MS;
}

function formatWatchSummary(job: ApiJobSummary): string {
  return [
    job.jobId,
    job.status,
    `repo=${job.repo}`,
    `branch=${formatNullable(job.branch)}`,
    `source=${job.source}`,
    `attemptsLeft=${job.attemptsLeft}`,
    `updatedAt=${job.updatedAt}`,
    `finishedAt=${formatNullable(job.finishedAt)}`,
  ].join(" ");
}

function targetOption(parsed: ParsedArgs): string {
  const value = optional(parsed, "target") ?? "host";
  if (!SMOKE_TARGETS.includes(value)) {
    throw new Error(`--target: expected one of ${SMOKE_TARGETS.join(", ")}`);
  }
  return value;
}

async function realSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function showJob(
  jobId: string,
  store: JobStore,
  stdout: (line: string) => void,
  stderr: (line: string) => void,
): number {
  const job = store.getJob(jobId);
  if (job === undefined) {
    stderr(`job not found: ${jobId}`);
    return 1;
  }

  stdout(
    [
      job.item.id,
      job.status,
      `repo=${job.item.repo}`,
      `branch=${formatNullable(job.item.branch ?? null)}`,
      `title=${formatTelemetryValue(job.item.title)}`,
      `worktreePath=${formatNullable(job.worktreePath ?? null)}`,
      `attemptsLeft=${job.attemptsLeft}`,
      `startedAt=${formatNullable(job.startedAt ?? null)}`,
      `cancelRequestedAt=${formatNullable(job.cancelRequestedAt ?? null)}`,
    ].join(" "),
  );
  const events = store.listEvents(jobId);
  if (job.status === "FAILED" || job.status === "ESCALATED") {
    const failureLine = formatFailureSummary(events);
    if (failureLine !== undefined) stdout(failureLine);
  }
  for (const event of events) {
    stdout(formatEvent(event));
  }
  return 0;
}

function formatFailureSummary(events: JobEventRecord[]): string | undefined {
  const failed = [...events].reverse().find((event) => event.type === "stage-failed");
  if (failed === undefined) return undefined;

  const parts: string[] = [`failure: ${failed.stage ?? "-"}`];
  if (failed.reason !== undefined) parts.push(`reason=${formatTelemetryValue(failed.reason)}`);
  if (failed.evidence !== undefined)
    parts.push(`evidence=${formatTelemetryValue(failed.evidence)}`);
  return parts.join(" ");
}

function formatEvent(event: JobEventRecord): string {
  const stage = event.stage ?? "-";
  const telemetry = formatTelemetryDetails(event);
  if (telemetry.length > 0) return `#${event.sequence} ${stage} ${event.type} ${telemetry}`;

  const detail = event.reason ?? event.gateName ?? event.status ?? "";
  return detail.length === 0
    ? `#${event.sequence} ${stage} ${event.type}`
    : `#${event.sequence} ${stage} ${event.type} ${detail}`;
}

function formatApiJobSummary(job: ApiJobSummary): string {
  return [
    job.jobId,
    job.status,
    `repo=${job.repo}`,
    `branch=${formatNullable(job.branch)}`,
    `source=${job.source}`,
    `title=${formatTelemetryValue(job.title)}`,
    `attemptsLeft=${job.attemptsLeft}`,
    `createdAt=${job.createdAt}`,
    `updatedAt=${job.updatedAt}`,
    `startedAt=${formatNullable(job.startedAt)}`,
    `finishedAt=${formatNullable(job.finishedAt)}`,
    `worktreePath=${formatNullable(job.worktreePath)}`,
    `cancelRequestedAt=${formatNullable(job.cancelRequestedAt)}`,
  ].join(" ");
}

function formatDaemonHealth(health: ApiHealth): string[] {
  return [
    `${health.service} ${health.status} apiVersion=${health.apiVersion} daemon=${health.daemon.status} store=${health.store.status} jobCount=${health.store.jobCount} auth=${health.auth.mode}`,
    "auth assumption: private network boundary; do not expose publicly without a new ADR",
  ];
}

function formatTelemetryDetails(event: JobEventRecord): string {
  if (Object.keys(event.payload).length === 0) return "";

  const pairs: Array<[string, unknown]> = [];
  const add = (key: string, value: unknown) => {
    if (value !== undefined) pairs.push([key, value]);
  };

  add("reason", event.reason ?? event.payload.reason);
  add("evidence", event.evidence ?? event.payload.evidence);
  for (const key of ["durationMs", "costUsd", "failureKind", "gateName", "engine", "model"]) {
    add(key, event.payload[key]);
  }

  return pairs.map(([key, value]) => `${key}=${formatTelemetryValue(value)}`).join(" ");
}

function formatTelemetryValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (/^[A-Za-z0-9_.:/-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function statusOption(parsed: ParsedArgs, key: string): JobStatus | undefined {
  const value = optional(parsed, key);
  if (value === undefined) return undefined;
  if (!isJobStatus(value)) {
    throw new Error(`--${key}: expected one of ${formatStatusList()}`);
  }
  return value;
}

function stageOption(parsed: ParsedArgs, key: string): StageName {
  const value = required(parsed, key);
  if (!(STAGE_ORDER as readonly string[]).includes(value)) {
    throw new Error(`--${key}: expected one of ${STAGE_ORDER.join(", ")}`);
  }
  return value as StageName;
}

function configuredApiClient(opts: AgentctlOptions): PandoApiClient {
  if (opts.apiClient !== undefined) return opts.apiClient;
  if (opts.apiBaseUrl === undefined || opts.apiBaseUrl.length === 0) {
    throw new Error("PANDO_API_URL is required for API-backed agentctl commands");
  }
  return createPandoApiClient({ baseUrl: opts.apiBaseUrl, fetch: opts.apiFetch });
}

function hasApiConfigured(opts: AgentctlOptions): boolean {
  return opts.apiClient !== undefined || (opts.apiBaseUrl !== undefined && opts.apiBaseUrl !== "");
}

function formatNullable(value: string | null): string {
  return value ?? "-";
}

function formatCliError(error: unknown): string {
  if (isApiClientError(error)) {
    return `api error ${error.status} ${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isApiClientError(error: unknown): error is Error & { code: string; status: number } {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<{ code: unknown; status: unknown }>;
  return typeof candidate.code === "string" && typeof candidate.status === "number";
}

function optionInt(parsed: ParsedArgs, key: string): number | undefined {
  const value = optional(parsed, key);
  if (value === undefined) return undefined;

  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isInteger(parsedValue) || parsedValue <= 0 || String(parsedValue) !== value) {
    throw new Error(`--${key}: expected positive integer`);
  }
  return parsedValue;
}

function required(parsed: ParsedArgs, key: string): string {
  const value = optional(parsed, key);
  if (value === undefined || value.length === 0) throw new Error(`--${key} is required`);
  return value;
}

function optional(parsed: ParsedArgs, key: string): string | undefined {
  return parsed.options.get(key);
}

function usage(): string {
  return [
    "usage:",
    "agentctl submit jira <ticket> --repo <repo> [--title <title>] [--branch <branch>]",
    "agentctl submit brief --repo <repo> --id <id> [--title <title>] [--brief-path <path>]",
    "agentctl list [--status <status>] [--watch] [--interval <ms>] [--max-polls <n>]",
    "agentctl daemon status",
    "agentctl show <job-id>",
    "agentctl watch <job-id> [--interval <ms>] [--max-polls <n>]",
    "agentctl retry <job-id> --from <stage> [--attempts <n>]",
    "agentctl cancel <job-id> [--reason <reason>]",
    "agentctl cleanup <job-id>",
    "agentctl smoke readiness [--target host|docker] [--evidence <path>]",
  ].join("\n");
}

function missingWorktreeCleaner(): WorktreeCleaner {
  return {
    async cleanup() {
      throw new Error("worktree cleaner is not configured");
    },
  };
}

function nodeSmokeRunner(): SmokeRunner {
  return async (input) => {
    const { spawn } = await import("node:child_process");
    const evidencePath = evidenceArg(input.args);
    const exitCode = await new Promise<number>((resolve) => {
      const child = spawn("pnpm", ["tsx", ...input.args], { stdio: "inherit" });
      child.on("error", () => {
        resolve(1);
      });
      child.on("close", (code) => {
        resolve(typeof code === "number" ? code : 1);
      });
    });
    return { evidencePath, exitCode };
  };
}

function evidenceArg(args: readonly string[]): string {
  const index = args.indexOf("--evidence");
  return index >= 0 ? (args[index + 1] ?? "") : "";
}

function nodeFileReader(): BriefFileReader {
  return {
    async readText(path) {
      try {
        return await readFile(path, "utf8");
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw error;
      }
    },
  };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}
