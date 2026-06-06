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

export interface AgentctlOptions {
  store: JobStore;
  apiBaseUrl?: string;
  apiClient?: PandoApiClient;
  apiFetch?: PandoApiFetch;
  briefReader?: BriefFileReader;
  worktreeCleaner?: WorktreeCleaner;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  defaultRetryBudget?: number;
}

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
      const response = await configuredApiClient(opts).listJobs(
        status === undefined ? undefined : { status },
      );
      for (const job of response.jobs) stdout(formatApiJobSummary(job));
      return 0;
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
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const value = args[index + 1];
    if (key.length === 0 || value === undefined || value.startsWith("--")) {
      throw new Error(`${token}: expected value`);
    }
    options.set(key, value);
    index += 1;
  }

  return { options, positionals };
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

  stdout(`${job.item.id} ${job.status} repo=${job.item.repo} attemptsLeft=${job.attemptsLeft}`);
  for (const event of store.listEvents(jobId)) {
    stdout(formatEvent(event));
  }
  return 0;
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
    `source=${job.source}`,
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
    "agentctl list [--status <status>]",
    "agentctl daemon status",
    "agentctl show <job-id>",
    "agentctl retry <job-id> --from <stage> [--attempts <n>]",
    "agentctl cancel <job-id> [--reason <reason>]",
    "agentctl cleanup <job-id>",
  ].join("\n");
}

function missingWorktreeCleaner(): WorktreeCleaner {
  return {
    async cleanup() {
      throw new Error("worktree cleaner is not configured");
    },
  };
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
