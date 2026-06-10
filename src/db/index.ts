import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGE_ORDER } from "../core/state-machine";
import type { JobStatus, RepoProfile, StageName, WorkItem } from "../core/types";

export interface SqliteJobStoreOptions {
  path: string;
  now?: () => string;
}

export interface EnqueueJobInput {
  item: WorkItem;
  retryBudget: number;
}

export interface UpdateJobStatusInput {
  jobId: string;
  status: JobStatus;
  attemptsLeft: number;
  worktreePath?: string;
  clearCancelRequest?: boolean;
  clearDeferral?: boolean;
}

export interface RetryJobInput {
  jobId: string;
  from: StageName;
  attemptsLeft: number;
}

export interface DeferJobInput {
  jobId: string;
  stage: StageName;
  delayMs: number;
  reason: string;
}

export interface CancelJobInput {
  jobId: string;
  requestedBy?: string;
  reason?: string;
}

export interface CompleteJobCancellationInput {
  jobId: string;
  stoppedBy?: string;
}

export interface RequestJobCleanupInput {
  jobId: string;
  requestedBy?: string;
}

export interface JobCleanupRequest {
  job: JobRecord;
  worktreePath: string;
}

export interface CompleteJobCleanupInput {
  jobId: string;
  worktreePath: string;
}

export interface FailJobCleanupInput {
  jobId: string;
  worktreePath: string;
  reason: string;
  evidence?: string;
}

export interface ClaimNextRunnableInput {
  excludeJobIds?: readonly string[];
}

export interface ListJobsInput {
  status?: JobStatus;
}

export interface AppendJobEventInput {
  jobId: string;
  type: string;
  stage?: StageName;
  status?: JobStatus;
  gateName?: string;
  reason?: string;
  evidence?: string;
  payload?: Record<string, unknown>;
}

export interface JobRecord {
  item: WorkItem;
  status: JobStatus;
  attemptsLeft: number;
  cancelRequestedAt?: string;
  deferredUntil?: string;
  worktreePath?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface JobEventRecord {
  sequence: number;
  jobId: string;
  type: string;
  stage?: StageName;
  status?: JobStatus;
  gateName?: string;
  reason?: string;
  evidence?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface JobStore {
  enqueueJob(input: EnqueueJobInput): JobRecord;
  listJobs(input?: ListJobsInput): JobRecord[];
  claimNextRunnable(input?: ClaimNextRunnableInput): JobRecord | undefined;
  getJob(jobId: string): JobRecord | undefined;
  updateJobStatus(input: UpdateJobStatusInput): JobRecord;
  deferJob(input: DeferJobInput): JobRecord;
  retryJob(input: RetryJobInput): JobRecord;
  cancelJob(input: CancelJobInput): JobRecord;
  listCancelRequestedJobs(): JobRecord[];
  completeJobCancellation(input: CompleteJobCancellationInput): JobRecord;
  requestJobCleanup(input: RequestJobCleanupInput): JobCleanupRequest;
  completeJobCleanup(input: CompleteJobCleanupInput): JobRecord;
  failJobCleanup(input: FailJobCleanupInput): JobRecord;
  appendEvent(input: AppendJobEventInput): JobEventRecord;
  listEvents(jobId: string): JobEventRecord[];
  upsertRepoProfile(name: string, profile: RepoProfile): void;
  getRepoProfile(name: string): RepoProfile | undefined;
  close(): void;
}

const ACTIVE_STATUSES = STAGE_ORDER;
const TERMINAL_STATUSES: readonly JobStatus[] = ["DONE", "FAILED", "ESCALATED", "CANCELED"];
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
const require = createRequire(import.meta.url);

export function createSqliteJobStore(opts: SqliteJobStoreOptions): JobStore {
  return new SqliteJobStore(opts.path, opts.now ?? defaultNow);
}

class SqliteJobStore implements JobStore {
  private readonly db: SqlDatabase;
  private readonly now: () => string;

  constructor(path: string, now: () => string) {
    this.db = createDatabase(path);
    this.now = now;
    this.db.exec(readFileSync(schemaPath, "utf8"));
    this.ensureColumn("jobs", "cancel_requested_at", "TEXT");
    this.ensureColumn("jobs", "deferred_until", "TEXT");
    this.ensureColumn("jobs", "base_branch", "TEXT");
    this.ensureColumn("jobs", "base_sha", "TEXT");
  }

  enqueueJob(input: EnqueueJobInput): JobRecord {
    const now = this.now();
    this.db
      .prepare(`
        INSERT INTO jobs (
          id, repo, source, title, branch, base_branch, base_sha, payload_json, depends_on_json,
          status, attempts_left, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
      `)
      .run(
        input.item.id,
        input.item.repo,
        input.item.source,
        input.item.title,
        input.item.branch ?? null,
        input.item.baseBranch ?? null,
        input.item.baseSha ?? null,
        JSON.stringify(input.item.payload),
        JSON.stringify(input.item.dependsOn ?? []),
        input.retryBudget,
        now,
        now,
      );

    return this.requiredJob(input.item.id);
  }

  listJobs(input?: ListJobsInput): JobRecord[] {
    const where = input?.status === undefined ? "" : "WHERE status = ?";
    const values = input?.status === undefined ? [] : [input.status];
    return this.selectAll(
      `
        SELECT * FROM jobs
        ${where}
        ORDER BY updated_at DESC, created_at DESC, id ASC
      `,
      values,
    ).map(deserializeJob);
  }

  claimNextRunnable(input?: ClaimNextRunnableInput): JobRecord | undefined {
    const excluded = input?.excludeJobIds ?? [];
    const excludedClause = excluded.length > 0 ? `AND id NOT IN (${placeholders(excluded)})` : "";
    const now = this.now();
    const active = this.selectOne(
      `
        SELECT * FROM jobs
        WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})
        AND cancel_requested_at IS NULL
        AND (deferred_until IS NULL OR deferred_until <= ?)
        ${excludedClause}
        ORDER BY updated_at ASC, created_at ASC, id ASC
        LIMIT 1
      `,
      [...ACTIVE_STATUSES, now, ...excluded],
    );
    if (active !== undefined) {
      const job = deserializeJob(active);
      if (job.deferredUntil !== undefined) {
        return this.updateJobStatus({
          attemptsLeft: job.attemptsLeft,
          clearDeferral: true,
          jobId: job.item.id,
          status: job.status,
          worktreePath: job.worktreePath,
        });
      }
      return job;
    }

    const queued = this.selectOne(
      `
        SELECT * FROM jobs
        WHERE status = 'QUEUED'
        ${excludedClause}
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [...excluded],
    );
    if (queued === undefined) return undefined;

    return this.updateJobStatus({
      attemptsLeft: integer(queued, "attempts_left"),
      jobId: text(queued, "id"),
      status: "SPEC",
    });
  }

  getJob(jobId: string): JobRecord | undefined {
    const row = this.selectOne("SELECT * FROM jobs WHERE id = ?", [jobId]);
    return row === undefined ? undefined : deserializeJob(row);
  }

  updateJobStatus(input: UpdateJobStatusInput): JobRecord {
    const now = this.now();
    this.db
      .prepare(`
        UPDATE jobs
        SET status = ?,
            attempts_left = ?,
            worktree_path = COALESCE(?, worktree_path),
            cancel_requested_at = CASE
              WHEN ? = 1 THEN NULL
              ELSE cancel_requested_at
            END,
            deferred_until = CASE
              WHEN ? = 1 OR ? IN ('DONE', 'FAILED', 'ESCALATED', 'CANCELED') THEN NULL
              ELSE deferred_until
            END,
            updated_at = ?,
            started_at = CASE
              WHEN status = 'QUEUED' OR started_at IS NULL THEN ?
              ELSE started_at
            END,
            finished_at = ?
        WHERE id = ?
      `)
      .run(
        input.status,
        input.attemptsLeft,
        input.worktreePath ?? null,
        input.clearCancelRequest === true ? 1 : 0,
        input.clearDeferral === true ? 1 : 0,
        input.status,
        now,
        now,
        TERMINAL_STATUSES.includes(input.status) ? now : null,
        input.jobId,
      );

    return this.requiredJob(input.jobId);
  }

  deferJob(input: DeferJobInput): JobRecord {
    const existing = this.requiredJob(input.jobId);
    if (TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(`job ${input.jobId} is terminal: ${existing.status}`);
    }
    if (input.delayMs <= 0 || !Number.isFinite(input.delayMs)) {
      throw new Error(`delayMs must be positive, got ${input.delayMs}`);
    }

    const now = this.now();
    const baseMs = Date.parse(now);
    if (Number.isNaN(baseMs)) throw new Error(`invalid clock value: ${now}`);
    const deferredUntil = new Date(baseMs + Math.ceil(input.delayMs)).toISOString();
    this.db
      .prepare(`
        UPDATE jobs
        SET deferred_until = ?,
            updated_at = ?
        WHERE id = ?
      `)
      .run(deferredUntil, now, input.jobId);
    this.appendEvent({
      jobId: input.jobId,
      payload: {
        backoffMs: input.delayMs,
        deferredUntil,
        reason: input.reason,
      },
      stage: input.stage,
      status: existing.status,
      type: "retry-deferred",
    });
    return this.requiredJob(input.jobId);
  }

  retryJob(input: RetryJobInput): JobRecord {
    const existing = this.requiredJob(input.jobId);
    if (!TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(`job ${input.jobId} is not terminal: ${existing.status}`);
    }

    const retried = this.updateJobStatus({
      attemptsLeft: input.attemptsLeft,
      clearCancelRequest: true,
      clearDeferral: true,
      jobId: input.jobId,
      status: input.from,
    });
    this.appendEvent({
      jobId: input.jobId,
      payload: { from: input.from },
      status: input.from,
      type: "retry",
    });
    return retried;
  }

  cancelJob(input: CancelJobInput): JobRecord {
    const existing = this.requiredJob(input.jobId);
    if (TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(`job ${input.jobId} is terminal: ${existing.status}`);
    }

    const payload = cancelPayload(existing.status, input);
    this.appendEvent({
      jobId: input.jobId,
      payload,
      status: existing.status,
      type: "cancel-requested",
    });

    if (existing.status === "QUEUED") {
      const now = this.now();
      this.db
        .prepare(`
          UPDATE jobs
          SET status = 'CANCELED',
              updated_at = ?,
              finished_at = ?
          WHERE id = ?
        `)
        .run(now, now, input.jobId);
      this.appendEvent({
        jobId: input.jobId,
        payload,
        status: "CANCELED",
        type: "canceled",
      });
      return this.requiredJob(input.jobId);
    }

    const now = this.now();
    this.db
      .prepare(`
        UPDATE jobs
        SET cancel_requested_at = COALESCE(cancel_requested_at, ?),
            updated_at = ?
        WHERE id = ?
      `)
      .run(now, now, input.jobId);
    return this.requiredJob(input.jobId);
  }

  listCancelRequestedJobs(): JobRecord[] {
    return this.selectAll(
      `
        SELECT * FROM jobs
        WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})
        AND cancel_requested_at IS NOT NULL
        ORDER BY cancel_requested_at ASC, updated_at ASC, id ASC
      `,
      [...ACTIVE_STATUSES],
    ).map(deserializeJob);
  }

  completeJobCancellation(input: CompleteJobCancellationInput): JobRecord {
    const existing = this.requiredJob(input.jobId);
    if (existing.cancelRequestedAt === undefined) {
      throw new Error(`job ${input.jobId} has no cancel request`);
    }

    const now = this.now();
    this.db
      .prepare(`
        UPDATE jobs
        SET status = 'CANCELED',
            updated_at = ?,
            finished_at = ?
        WHERE id = ?
      `)
      .run(now, now, input.jobId);
    this.appendEvent({
      jobId: input.jobId,
      payload: {
        previousStatus: existing.status,
        stoppedBy: input.stoppedBy,
      },
      status: "CANCELED",
      type: "canceled",
    });
    return this.requiredJob(input.jobId);
  }

  requestJobCleanup(input: RequestJobCleanupInput): JobCleanupRequest {
    const existing = this.requiredJob(input.jobId);
    if (!TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(`job ${input.jobId} is not terminal: ${existing.status}`);
    }
    if (existing.worktreePath === undefined) {
      throw new Error(`job ${input.jobId} has no worktree path to cleanup`);
    }

    this.appendEvent({
      jobId: input.jobId,
      payload: {
        requestedBy: input.requestedBy,
        status: existing.status,
        worktreePath: existing.worktreePath,
      },
      status: existing.status,
      type: "cleanup-requested",
    });
    return { job: existing, worktreePath: existing.worktreePath };
  }

  completeJobCleanup(input: CompleteJobCleanupInput): JobRecord {
    const existing = this.requiredJob(input.jobId);
    if (existing.worktreePath !== input.worktreePath) {
      throw new Error(`job ${input.jobId} worktree path changed before cleanup completed`);
    }

    const now = this.now();
    this.db
      .prepare(`
        UPDATE jobs
        SET worktree_path = NULL,
            updated_at = ?
        WHERE id = ?
      `)
      .run(now, input.jobId);
    this.appendEvent({
      jobId: input.jobId,
      payload: { worktreePath: input.worktreePath },
      status: existing.status,
      type: "cleanup-completed",
    });
    return this.requiredJob(input.jobId);
  }

  failJobCleanup(input: FailJobCleanupInput): JobRecord {
    const existing = this.requiredJob(input.jobId);
    this.appendEvent({
      evidence: input.evidence,
      jobId: input.jobId,
      payload: { worktreePath: input.worktreePath },
      reason: input.reason,
      status: existing.status,
      type: "cleanup-failed",
    });
    return existing;
  }

  appendEvent(input: AppendJobEventInput): JobEventRecord {
    const now = this.now();
    this.db
      .prepare(`
        INSERT INTO events (
          job_id, type, stage, status, gate_name, reason, evidence,
          payload_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.jobId,
        input.type,
        input.stage ?? null,
        input.status ?? null,
        input.gateName ?? null,
        input.reason ?? null,
        input.evidence ?? null,
        JSON.stringify(input.payload ?? {}),
        now,
      );

    const row = this.selectOne("SELECT * FROM events WHERE sequence = last_insert_rowid()", []);
    if (row === undefined) throw new Error("failed to append event");
    return deserializeEvent(row);
  }

  listEvents(jobId: string): JobEventRecord[] {
    return this.selectAll("SELECT * FROM events WHERE job_id = ? ORDER BY sequence ASC", [
      jobId,
    ]).map(deserializeEvent);
  }

  upsertRepoProfile(name: string, profile: RepoProfile): void {
    const now = this.now();
    this.db
      .prepare(`
        INSERT INTO repos (name, profile_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
          profile_json = excluded.profile_json,
          updated_at = excluded.updated_at
      `)
      .run(name, JSON.stringify(profile), now);
  }

  getRepoProfile(name: string): RepoProfile | undefined {
    const row = this.selectOne("SELECT profile_json FROM repos WHERE name = ?", [name]);
    if (row === undefined) return undefined;
    return JSON.parse(text(row, "profile_json")) as RepoProfile;
  }

  close(): void {
    this.db.close();
  }

  private requiredJob(jobId: string): JobRecord {
    const job = this.getJob(jobId);
    if (job === undefined) throw new Error(`job not found: ${jobId}`);
    return job;
  }

  private selectOne(sql: string, values: readonly SqlValue[]): Row | undefined {
    const row = this.db.prepare(sql).get(...values);
    return row === undefined || row === null ? undefined : asRow(row);
  }

  private selectAll(sql: string, values: readonly SqlValue[]): Row[] {
    return this.db
      .prepare(sql)
      .all(...values)
      .map(asRow);
  }

  private ensureColumn(table: "jobs", column: string, definition: string): void {
    const columns = this.selectAll(`PRAGMA table_info(${table})`, []);
    const exists = columns.some((row) => text(row, "name") === column);
    if (!exists) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

type SqlValue = string | number | null;
type Row = Record<string, unknown>;

interface SqlStatement {
  run(...values: SqlValue[]): unknown;
  get(...values: SqlValue[]): unknown;
  all(...values: SqlValue[]): unknown[];
}

interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): unknown;
  close(): unknown;
}

function createDatabase(path: string): SqlDatabase {
  if (typeof process.versions.bun === "string") {
    const sqlite = require("bun:sqlite") as {
      Database: new (path: string) => SqlDatabase;
    };
    return new sqlite.Database(path);
  }

  const module = require("better-sqlite3") as
    | { default?: new (path: string) => SqlDatabase }
    | (new (path: string) => SqlDatabase);
  const Database =
    typeof module === "function" ? module : (module.default as new (path: string) => SqlDatabase);
  return new Database(path);
}

function placeholders(values: readonly unknown[]): string {
  return values.map(() => "?").join(", ");
}

function deserializeJob(row: Row): JobRecord {
  const dependsOn = parseJson<string[]>(text(row, "depends_on_json"));
  return {
    attemptsLeft: integer(row, "attempts_left"),
    cancelRequestedAt: optionalText(row, "cancel_requested_at"),
    createdAt: text(row, "created_at"),
    finishedAt: optionalText(row, "finished_at"),
    deferredUntil: optionalText(row, "deferred_until"),
    item: {
      baseBranch: optionalText(row, "base_branch"),
      baseSha: optionalText(row, "base_sha"),
      branch: optionalText(row, "branch"),
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      id: text(row, "id"),
      payload: parseJson<WorkItem["payload"]>(text(row, "payload_json")),
      repo: text(row, "repo"),
      source: source(row),
      title: text(row, "title"),
    },
    startedAt: optionalText(row, "started_at"),
    status: status(row),
    updatedAt: text(row, "updated_at"),
    worktreePath: optionalText(row, "worktree_path"),
  };
}

function deserializeEvent(row: Row): JobEventRecord {
  return {
    createdAt: text(row, "created_at"),
    evidence: optionalText(row, "evidence"),
    gateName: optionalText(row, "gate_name"),
    jobId: text(row, "job_id"),
    payload: parseJson<Record<string, unknown>>(text(row, "payload_json")),
    reason: optionalText(row, "reason"),
    sequence: integer(row, "sequence"),
    stage: optionalStage(row, "stage"),
    status: optionalStatus(row, "status"),
    type: text(row, "type"),
  };
}

function status(row: Row): JobStatus {
  const value = text(row, "status");
  if (!isJobStatus(value)) throw new Error(`invalid job status in database: ${value}`);
  return value;
}

function optionalStatus(row: Row, key: string): JobStatus | undefined {
  const value = optionalText(row, key);
  if (value === undefined) return undefined;
  if (!isJobStatus(value)) throw new Error(`invalid event status in database: ${value}`);
  return value;
}

function optionalStage(row: Row, key: string): StageName | undefined {
  const value = optionalText(row, key);
  if (value === undefined) return undefined;
  if (!isStageName(value)) throw new Error(`invalid event stage in database: ${value}`);
  return value;
}

function source(row: Row): WorkItem["source"] {
  const value = text(row, "source");
  if (value !== "jira" && value !== "brief" && value !== "github_issue") {
    throw new Error(`invalid work item source in database: ${value}`);
  }
  return value;
}

function isJobStatus(value: string): value is JobStatus {
  return value === "QUEUED" || TERMINAL_STATUSES.includes(value as JobStatus) || isStageName(value);
}

function cancelPayload(previousStatus: JobStatus, input: CancelJobInput): Record<string, string> {
  return Object.fromEntries(
    Object.entries({
      previousStatus,
      reason: input.reason,
      requestedBy: input.requestedBy,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function isStageName(value: string): value is StageName {
  return (STAGE_ORDER as readonly string[]).includes(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function asRow(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("database returned an invalid row");
  }
  return value as Row;
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`${key}: expected text`);
  return value;
}

function optionalText(row: Row, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key}: expected text`);
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${key}: expected integer`);
  }
  return value;
}

function defaultNow(): string {
  return new Date().toISOString();
}
