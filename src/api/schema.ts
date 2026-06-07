import { STAGE_ORDER } from "../core/state-machine";
import type { JobStatus, StageName, WorkItem } from "../core/types";
import {
  resolveClaudeCredentialMode,
  type ClaudeCredentialResolution,
  type ClaudeCredentialSignals,
} from "../daemon/claude-credential-mode";
import type { FailureAnalytics } from "../daemon/failure-analytics";
import type { JobEventRecord, JobRecord } from "../db/index";

export const JOB_STATUS_VALUES = [
  "QUEUED",
  ...STAGE_ORDER,
  "DONE",
  "FAILED",
  "ESCALATED",
  "CANCELED",
] as const satisfies readonly JobStatus[];

export const STAGE_VALUES = STAGE_ORDER;

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiError = {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface ApiHealth {
  apiVersion: "v1";
  auth: { mode: "private-network" };
  daemon: { status: "ok" };
  service: "pando";
  status: "ok";
  store: { jobCount: number; status: "ok" };
}

export interface ApiJobSummary {
  attemptsLeft: number;
  branch: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  jobId: string;
  repo: string;
  source: WorkItem["source"];
  startedAt: string | null;
  status: JobStatus;
  title: string;
  updatedAt: string;
  worktreePath: string | null;
}

export interface ApiJobDetail extends ApiJobSummary {
  workItem: WorkItem;
}

export interface ApiJobEvent {
  createdAt: string;
  evidence: string | null;
  gateName: string | null;
  jobId: string;
  payload: Record<string, unknown>;
  reason: string | null;
  sequence: number;
  stage: StageName | null;
  status: JobStatus | null;
  type: string;
}

export interface ApiJobList {
  jobs: ApiJobSummary[];
}

export interface ApiJobDetailResponse {
  job: ApiJobDetail;
  recentEvents: ApiJobEvent[];
}

export interface ApiJobEventsResponse {
  events: ApiJobEvent[];
}

export interface ApiJobActionResponse {
  action: {
    status: "canceled" | "cancel_requested" | "retried";
    type: "cancel" | "retry";
  };
  job: ApiJobSummary;
}

export interface ApiJobCleanupResponse {
  action: {
    status: "cleanup_requested";
    type: "cleanup";
    worktreePath: string;
  };
  job: ApiJobSummary;
}

export interface ApiBriefSubmitResponse {
  job: ApiJobSummary;
}

export interface ApiRepoSummary {
  name: string;
}

export interface ApiRepoList {
  repos: ApiRepoSummary[];
}

export type ApiFailureAnalytics = FailureAnalytics;

export interface ApiReadinessCheck {
  name: string;
  pass: boolean;
}

export interface ApiReadinessSummary {
  target: string;
  mode: string;
  ok: boolean;
  blockers: string[];
  checks: ApiReadinessCheck[];
  claude: ClaudeCredentialResolution | null;
}

export interface ApiAnalyticsResponse {
  generatedAt: string;
  failures: ApiFailureAnalytics;
  readiness: ApiReadinessSummary | null;
}

export function toReadinessSummary(raw: unknown): ApiReadinessSummary | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const blockers = stringArray(record.blockers);
  const target = typeof record.target === "string" ? record.target : "unknown";

  return {
    blockers,
    checks: readinessChecks(record.checks),
    claude: readinessClaude(record.checks, target),
    mode: typeof record.mode === "string" ? record.mode : "unknown",
    ok: blockers.length === 0,
    target,
  };
}

function readinessClaude(checks: unknown, target: string): ClaudeCredentialResolution | null {
  const signals = claudeSignals(checks);
  if (signals === undefined) return null;
  return resolveClaudeCredentialMode(signals, target === "docker" ? "docker" : "host");
}

function claudeSignals(checks: unknown): ClaudeCredentialSignals | undefined {
  const claude = nestedRecord(checks, ["auth", "signals", "claude"]);
  if (claude === undefined) return undefined;
  return {
    apiKeyPresent: boolish(claude.apiKeyPresent),
    configDirPresent: boolish(claude.configDirPresent),
    configFileNonEmpty: boolish(claude.configFileNonEmpty),
    configFilePresent: boolish(claude.configFilePresent),
  };
}

function nestedRecord(value: unknown, path: string[]): Record<string, unknown> | undefined {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
  return current as Record<string, unknown>;
}

function boolish(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readinessChecks(value: unknown): ApiReadinessCheck[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .map(([name, check]): ApiReadinessCheck | undefined => {
      if (typeof check !== "object" || check === null) return undefined;
      const pass = (check as Record<string, unknown>).pass;
      return typeof pass === "boolean" ? { name, pass } : undefined;
    })
    .filter((check): check is ApiReadinessCheck => check !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function isJobStatus(value: string): value is JobStatus {
  return (JOB_STATUS_VALUES as readonly string[]).includes(value);
}

export function isStageName(value: string): value is StageName {
  return (STAGE_VALUES as readonly string[]).includes(value);
}

export function formatStatusList(): string {
  return JOB_STATUS_VALUES.join(", ");
}

export function formatStageList(): string {
  return STAGE_VALUES.join(", ");
}

export function toApiJobSummary(job: JobRecord): ApiJobSummary {
  return {
    attemptsLeft: job.attemptsLeft,
    branch: job.item.branch ?? null,
    cancelRequestedAt: job.cancelRequestedAt ?? null,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt ?? null,
    jobId: job.item.id,
    repo: job.item.repo,
    source: job.item.source,
    startedAt: job.startedAt ?? null,
    status: job.status,
    title: job.item.title,
    updatedAt: job.updatedAt,
    worktreePath: job.worktreePath ?? null,
  };
}

export function toApiJobDetail(job: JobRecord): ApiJobDetail {
  return {
    ...toApiJobSummary(job),
    workItem: job.item,
  };
}

export function toApiJobEvent(event: JobEventRecord): ApiJobEvent {
  return {
    createdAt: event.createdAt,
    evidence: event.evidence ?? null,
    gateName: event.gateName ?? null,
    jobId: event.jobId,
    payload: event.payload,
    reason: event.reason ?? null,
    sequence: event.sequence,
    stage: event.stage ?? null,
    status: event.status ?? null,
    type: event.type,
  };
}
