import { join } from "node:path";
import type { JobEventRecord, JobRecord } from "../db/index";
import type { JobStatus, StageName } from "../core/types";

export type TerminalStatusLabel =
  | "cancel"
  | "escalated"
  | "failure"
  | "running"
  | "success"
  | "timeout";

export interface TerminalRunSummary {
  schemaVersion: 1;
  generatedAt: string;
  totals: {
    cancel: number;
    escalated: number;
    failure: number;
    retried: number;
    running: number;
    success: number;
    timeout: number;
  };
  jobs: TerminalJobSummary[];
}

export interface TerminalJobSummary {
  jobId: string;
  finalStatus: JobStatus;
  terminalStatus: TerminalStatusLabel;
  stage: StageName | null;
  reason: string;
  durationMs: number | null;
  retryCount: number;
  evidence: {
    path: string;
    summary: TerminalEvidenceSummary;
  };
}

export interface TerminalEvidenceSummary {
  eventType: string;
  eventSequence: number | null;
  stage: StageName | null;
  status: JobStatus | null;
  gateName: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  evidence: EvidenceValueSummary;
}

export type EvidenceValueSummary =
  | { kind: "none" }
  | { kind: "structured-json"; value: unknown }
  | { kind: "text"; bytes: number; omitted: true };

export interface SummarizeTerminalJobsInput {
  jobs: readonly JobRecord[];
  eventsByJobId: Record<string, readonly JobEventRecord[] | undefined>;
  generatedAt: string;
  evidenceRoot: string;
}

export interface FailureReasonCount {
  terminalStatus: TerminalStatusLabel;
  reason: string;
  count: number;
}

export interface FailureAnalytics {
  totals: TerminalRunSummary["totals"];
  totalJobs: number;
  passRate: number;
  failureReasons: FailureReasonCount[];
}

const FALLBACK_EVENT_TYPE = "job-record";
const SENSITIVE_PAYLOAD_KEYS = new Set([
  "content",
  "evidence",
  "message",
  "output",
  "stderr",
  "stdout",
  "text",
]);

export function summarizeTerminalJobs(input: SummarizeTerminalJobsInput): TerminalRunSummary {
  const jobs = input.jobs.map((job) =>
    summarizeJob(job, input.eventsByJobId[job.item.id] ?? [], input.evidenceRoot),
  );

  return {
    generatedAt: input.generatedAt,
    jobs,
    schemaVersion: 1,
    totals: summarizeTotals(jobs),
  };
}

export function buildFailureAnalytics(summary: TerminalRunSummary): FailureAnalytics {
  const totalJobs = summary.jobs.length;
  return {
    failureReasons: aggregateFailureReasons(summary.jobs),
    passRate: rate(summary.totals.success, totalJobs),
    totalJobs,
    totals: summary.totals,
  };
}

export function aggregateFailureReasons(jobs: readonly TerminalJobSummary[]): FailureReasonCount[] {
  const counts = new Map<string, FailureReasonCount>();
  for (const job of jobs) {
    if (job.terminalStatus === "success" || job.terminalStatus === "running") continue;
    const key = `${job.terminalStatus} ${job.reason}`;
    const existing = counts.get(key);
    if (existing === undefined) {
      counts.set(key, { count: 1, reason: job.reason, terminalStatus: job.terminalStatus });
      continue;
    }
    existing.count += 1;
  }

  return [...counts.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (a.terminalStatus !== b.terminalStatus) {
      return a.terminalStatus.localeCompare(b.terminalStatus);
    }
    return a.reason.localeCompare(b.reason);
  });
}

function rate(success: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((success / total) * 10_000) / 10_000;
}

function summarizeJob(
  job: JobRecord,
  events: readonly JobEventRecord[],
  evidenceRoot: string,
): TerminalJobSummary {
  const terminalEvent = selectTerminalEvent(job.status, events);
  const terminalStatus = terminalStatusFor(job.status, events);
  const retryCount = retryCountFor(events);

  return {
    durationMs: jobDurationMs(job, terminalEvent),
    evidence: {
      path: join(evidenceRoot, `${sanitizePathSegment(job.item.id)}.json`),
      summary: eventSummary(terminalEvent, job),
    },
    finalStatus: job.status,
    jobId: job.item.id,
    reason: reasonFor(job.status, terminalStatus, terminalEvent),
    retryCount,
    stage: terminalEvent?.stage ?? latestStage(events),
    terminalStatus,
  };
}

function summarizeTotals(jobs: readonly TerminalJobSummary[]): TerminalRunSummary["totals"] {
  const totals: TerminalRunSummary["totals"] = {
    cancel: 0,
    escalated: 0,
    failure: 0,
    retried: 0,
    running: 0,
    success: 0,
    timeout: 0,
  };

  for (const job of jobs) {
    totals[job.terminalStatus] += 1;
    if (job.retryCount > 0) totals.retried += 1;
  }

  return totals;
}

function terminalStatusFor(
  finalStatus: JobStatus,
  events: readonly JobEventRecord[],
): TerminalStatusLabel {
  if (finalStatus === "DONE") return "success";
  if (finalStatus === "CANCELED") return "cancel";
  if (hasTimeoutEvidence(events)) return "timeout";
  if (finalStatus === "ESCALATED") return "escalated";
  if (finalStatus === "FAILED") return "failure";
  return "running";
}

function selectTerminalEvent(
  finalStatus: JobStatus,
  events: readonly JobEventRecord[],
): JobEventRecord | undefined {
  const reversed = [...events].reverse();

  if (finalStatus === "DONE") {
    return (
      reversed.find((event) => event.type === "stage-completed") ??
      reversed.find((event) => event.type === "state-change" && event.payload.next === "DONE")
    );
  }

  if (finalStatus === "CANCELED") {
    return (
      reversed.find((event) => event.type === "canceled") ??
      reversed.find((event) => event.type === "cancel-stop-failed") ??
      reversed.find((event) => event.type === "cancel-requested")
    );
  }

  if (finalStatus === "FAILED") {
    return (
      reversed.find((event) => event.type === "stage-failed") ??
      reversed.find((event) => event.type === "daemon-error") ??
      reversed.find((event) => event.type === "gate-fail") ??
      reversed.find((event) => event.type === "engine-fail")
    );
  }

  if (finalStatus === "ESCALATED") {
    return (
      reversed.find((event) => event.type === "stage-failed") ??
      reversed.find((event) => event.type === "gate-blocking") ??
      reversed.find((event) => event.type === "state-change" && event.payload.next === "ESCALATED")
    );
  }

  return reversed.find((event) => event.stage !== undefined) ?? reversed[0];
}

function reasonFor(
  finalStatus: JobStatus,
  terminalStatus: TerminalStatusLabel,
  event: JobEventRecord | undefined,
): string {
  const reason =
    event?.reason ??
    stringValue(event?.payload.reason) ??
    stringValue(event?.payload.failureKind) ??
    stringValue(event?.payload.event);

  if (reason !== undefined) return reason;
  if (terminalStatus === "success") return "job completed successfully";
  if (terminalStatus === "cancel") return "job canceled";
  if (terminalStatus === "timeout") return "job timed out";
  if (terminalStatus === "escalated") return "job escalated";
  if (terminalStatus === "failure") return "job failed";
  return `job is not terminal: ${finalStatus}`;
}

function eventSummary(event: JobEventRecord | undefined, job: JobRecord): TerminalEvidenceSummary {
  if (event === undefined) {
    return {
      eventSequence: null,
      eventType: FALLBACK_EVENT_TYPE,
      evidence: { kind: "none" },
      gateName: null,
      payload: {},
      reason: null,
      stage: null,
      status: job.status,
    };
  }

  return {
    eventSequence: event.sequence,
    eventType: event.type,
    evidence: evidenceValueSummary(event.evidence),
    gateName: event.gateName ?? null,
    payload: sanitizePayload(event.payload),
    reason: event.reason ?? null,
    stage: event.stage ?? null,
    status: event.status ?? null,
  };
}

function evidenceValueSummary(value: string | undefined): EvidenceValueSummary {
  if (value === undefined || value.length === 0) return { kind: "none" };

  const parsed = parseJson(value);
  if (parsed !== undefined) {
    return { kind: "structured-json", value: sanitizeUnknown(parsed) };
  }

  return { bytes: Buffer.byteLength(value, "utf8"), kind: "text", omitted: true };
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRecord(payload);
}

function sanitizeRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !SENSITIVE_PAYLOAD_KEYS.has(key))
      .map(([key, value]) => [key, sanitizeUnknown(value)]),
  );
}

function sanitizeUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeUnknown);
  if (isRecord(value)) return sanitizeRecord(value);
  return value;
}

function jobDurationMs(job: JobRecord, terminalEvent: JobEventRecord | undefined): number | null {
  const started = millis(job.startedAt);
  const finished = millis(job.finishedAt);
  if (started !== undefined && finished !== undefined) return Math.max(0, finished - started);

  const eventDuration = terminalEvent?.payload.durationMs;
  return typeof eventDuration === "number" && Number.isFinite(eventDuration)
    ? Math.max(0, eventDuration)
    : null;
}

function retryCountFor(events: readonly JobEventRecord[]): number {
  return events.filter(isRetrySignal).length;
}

function isRetrySignal(event: JobEventRecord): boolean {
  return (
    event.type === "retry" ||
    (event.type === "state-change" &&
      event.payload.event === "GATE_FAIL" &&
      event.payload.next === event.payload.previous)
  );
}

function latestStage(events: readonly JobEventRecord[]): StageName | null {
  return [...events].reverse().find((event) => event.stage !== undefined)?.stage ?? null;
}

function hasTimeoutEvidence(events: readonly JobEventRecord[]): boolean {
  return events.some((event) => {
    if (event.payload.timedOut === true || event.payload.timeout === true) return true;
    if (typeof event.reason === "string" && /timed?\s*out|timeout/i.test(event.reason)) {
      return true;
    }

    const parsed = event.evidence === undefined ? undefined : parseJson(event.evidence);
    return isRecord(parsed) && (parsed.timedOut === true || parsed.timeout === true);
  });
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function millis(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
