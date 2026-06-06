import { STAGE_ORDER } from "../core/state-machine";
import type { JobStatus, StageName, WorkItem } from "../core/types";
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
