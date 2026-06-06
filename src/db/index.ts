import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { STAGE_ORDER } from "../core/state-machine.js";
import type {
  JobStatus,
  RepoProfile,
  StageName,
  WorkItem,
} from "../core/types.js";

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
}

export interface RetryJobInput {
  jobId: string;
  from: StageName;
  attemptsLeft: number;
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
  claimNextRunnable(): JobRecord | undefined;
  getJob(jobId: string): JobRecord | undefined;
  updateJobStatus(input: UpdateJobStatusInput): JobRecord;
  retryJob(input: RetryJobInput): JobRecord;
  appendEvent(input: AppendJobEventInput): JobEventRecord;
  listEvents(jobId: string): JobEventRecord[];
  upsertRepoProfile(name: string, profile: RepoProfile): void;
  getRepoProfile(name: string): RepoProfile | undefined;
  close(): void;
}

const ACTIVE_STATUSES = STAGE_ORDER;
const TERMINAL_STATUSES: readonly JobStatus[] = ["DONE", "FAILED", "ESCALATED"];
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

export function createSqliteJobStore(opts: SqliteJobStoreOptions): JobStore {
  return new SqliteJobStore(opts.path, opts.now ?? defaultNow);
}

class SqliteJobStore implements JobStore {
  private readonly db: DatabaseSync;
  private readonly now: () => string;

  constructor(path: string, now: () => string) {
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec(readFileSync(schemaPath, "utf8"));
  }

  enqueueJob(input: EnqueueJobInput): JobRecord {
    const now = this.now();
    this.db
      .prepare(`
        INSERT INTO jobs (
          id, repo, source, title, branch, payload_json, depends_on_json,
          status, attempts_left, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
      `)
      .run(
        input.item.id,
        input.item.repo,
        input.item.source,
        input.item.title,
        input.item.branch ?? null,
        JSON.stringify(input.item.payload),
        JSON.stringify(input.item.dependsOn ?? []),
        input.retryBudget,
        now,
        now,
      );

    return this.requiredJob(input.item.id);
  }

  claimNextRunnable(): JobRecord | undefined {
    const active = this.selectOne(
      `
        SELECT * FROM jobs
        WHERE status IN (${ACTIVE_STATUSES.map(() => "?").join(", ")})
        ORDER BY updated_at ASC, created_at ASC, id ASC
        LIMIT 1
      `,
      [...ACTIVE_STATUSES],
    );
    if (active !== undefined) return deserializeJob(active);

    const queued = this.selectOne(
      `
        SELECT * FROM jobs
        WHERE status = 'QUEUED'
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `,
      [],
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
        now,
        now,
        TERMINAL_STATUSES.includes(input.status) ? now : null,
        input.jobId,
      );

    return this.requiredJob(input.jobId);
  }

  retryJob(input: RetryJobInput): JobRecord {
    const existing = this.requiredJob(input.jobId);
    if (!TERMINAL_STATUSES.includes(existing.status)) {
      throw new Error(`job ${input.jobId} is not terminal: ${existing.status}`);
    }

    const retried = this.updateJobStatus({
      attemptsLeft: input.attemptsLeft,
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

    const row = this.selectOne(
      "SELECT * FROM events WHERE sequence = last_insert_rowid()",
      [],
    );
    if (row === undefined) throw new Error("failed to append event");
    return deserializeEvent(row);
  }

  listEvents(jobId: string): JobEventRecord[] {
    return this.selectAll(
      "SELECT * FROM events WHERE job_id = ? ORDER BY sequence ASC",
      [jobId],
    ).map(deserializeEvent);
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
    return row === undefined ? undefined : asRow(row);
  }

  private selectAll(sql: string, values: readonly SqlValue[]): Row[] {
    return this.db.prepare(sql).all(...values).map(asRow);
  }
}

type SqlValue = string | number | null;
type Row = Record<string, unknown>;

function deserializeJob(row: Row): JobRecord {
  const dependsOn = parseJson<string[]>(text(row, "depends_on_json"));
  return {
    attemptsLeft: integer(row, "attempts_left"),
    createdAt: text(row, "created_at"),
    finishedAt: optionalText(row, "finished_at"),
    item: {
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
  if (value !== "jira" && value !== "brief") {
    throw new Error(`invalid work item source in database: ${value}`);
  }
  return value;
}

function isJobStatus(value: string): value is JobStatus {
  return value === "QUEUED" || TERMINAL_STATUSES.includes(value as JobStatus) || isStageName(value);
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
