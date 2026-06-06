import type { JobRecord, JobStore } from "../db/index";
import type { MachineState } from "../core/state-machine";
import type { JobStatus, RepoProfile, WorkItem } from "../core/types";
import {
  createRunScheduler,
  type RunScheduler,
  type RunSchedulerLease,
} from "../scheduler/scheduler";
import {
  runPipeline,
  type PipelineRunEvent,
  type PipelineRunResult,
  type PipelineRunnerOptions,
  type PipelineStateChange,
} from "../pipeline/runner";
import { createWorktreeIsolation, type WorktreeIsolation } from "./worktree-isolation";

export interface WorktreeProvisioner {
  ensure(input: WorktreeProvisionInput): Promise<WorktreeProvisionResult>;
}

export interface WorktreeProvisionInput {
  item: WorkItem;
  profile: RepoProfile;
  branch: string;
  isolation?: WorktreeIsolation;
}

export interface WorktreeProvisionResult {
  path: string;
  branch: string;
  reused?: boolean;
  isolation?: WorktreeIsolation;
}

export interface DaemonOnceOptions extends Pick<
  PipelineRunnerOptions,
  "buildPrompt" | "engines" | "gates" | "stageConfig"
> {
  store: JobStore;
  profiles?: Record<string, RepoProfile>;
  worktrees: WorktreeProvisioner;
  scheduler?: RunScheduler;
  isolationCacheRoot?: string;
  runner?: (opts: PipelineRunnerOptions) => Promise<PipelineRunResult>;
}

export interface DaemonJobResult {
  status: "ran" | "failed";
  jobId: string;
  finalStatus: JobStatus;
}

export type DaemonOnceResult =
  | { status: "idle" }
  | DaemonJobResult
  | { status: "ran"; jobs: DaemonJobResult[] };

export async function runDaemonOnce(opts: DaemonOnceOptions): Promise<DaemonOnceResult> {
  const scheduler =
    opts.scheduler ?? createRunScheduler({ globalConcurrency: 1, providerConcurrency: {} });
  const multiRun = opts.scheduler !== undefined;
  const deniedJobIds: string[] = [];
  const running: Promise<DaemonJobResult>[] = [];

  while (scheduler.hasCapacity() && running.length < scheduler.maxConcurrency) {
    const job = opts.store.claimNextRunnable({
      excludeJobIds: [...scheduler.activeJobIds, ...deniedJobIds],
    });
    if (job === undefined) break;

    let profile: RepoProfile;
    try {
      profile = resolveProfile(opts, job.item);
    } catch (error) {
      const evidence = error instanceof Error ? error.message : String(error);
      running.push(Promise.resolve(failClaimedJob(opts, job, evidence)));
      continue;
    }

    const lease = scheduler.tryAcquire({ jobId: job.item.id, profile, repo: job.item.repo });
    if (lease === undefined) {
      deniedJobIds.push(job.item.id);
      continue;
    }

    running.push(runClaimedJob(opts, job, profile, lease));
  }

  if (running.length === 0) return { status: "idle" };

  const jobs = await Promise.all(running);
  if (!multiRun && jobs.length === 1) {
    const [job] = jobs;
    if (job !== undefined) return job;
  }

  return { jobs, status: "ran" };
}

export function branchForItem(item: WorkItem): string {
  return item.branch ?? `feat/${sanitizeBranchSegment(item.id)}`;
}

function resolveProfile(opts: DaemonOnceOptions, item: WorkItem): RepoProfile {
  const profile = opts.profiles?.[item.repo] ?? opts.store.getRepoProfile(item.repo);
  if (profile === undefined) throw new Error(`repo profile not found: ${item.repo}`);
  return profile;
}

async function runClaimedJob(
  opts: DaemonOnceOptions,
  job: JobRecord,
  profile: RepoProfile,
  lease: RunSchedulerLease,
): Promise<DaemonJobResult> {
  try {
    const branch = branchForItem(job.item);
    const requestedIsolation =
      opts.isolationCacheRoot === undefined
        ? undefined
        : createWorktreeIsolation({
            branch,
            cacheRoot: opts.isolationCacheRoot,
            item: job.item,
            profile,
          });
    const worktree = await opts.worktrees.ensure({
      branch,
      isolation: requestedIsolation,
      item: job.item,
      profile,
    });
    const initial = persistWorktreePath(opts.store, job, worktree.path);
    const result = await (opts.runner ?? runPipeline)({
      buildPrompt: opts.buildPrompt,
      engines: opts.engines,
      env: worktree.isolation?.env,
      gates: opts.gates,
      initialState: machineState(initial),
      item: job.item,
      onEvent(event) {
        persistPipelineEvent(opts.store, job.item.id, event);
      },
      onStateChange(change) {
        persistStateChange(opts.store, job.item.id, worktree.path, change);
      },
      profile,
      stageConfig: opts.stageConfig,
      worktree: worktree.path,
    });

    persistFinalState(opts.store, job.item.id, worktree.path, result.final);
    return { finalStatus: result.final.status, jobId: job.item.id, status: "ran" };
  } catch (error) {
    const evidence = error instanceof Error ? error.message : String(error);
    return failClaimedJob(opts, job, evidence);
  } finally {
    lease.release();
  }
}

function failClaimedJob(
  opts: DaemonOnceOptions,
  job: JobRecord,
  evidence: string,
): DaemonJobResult {
  opts.store.appendEvent({
    evidence,
    jobId: job.item.id,
    reason: "daemon run failed",
    type: "daemon-error",
  });
  opts.store.updateJobStatus({
    attemptsLeft: 0,
    jobId: job.item.id,
    status: "FAILED",
    worktreePath: job.worktreePath,
  });
  return { finalStatus: "FAILED", jobId: job.item.id, status: "failed" };
}

function persistWorktreePath(store: JobStore, job: JobRecord, worktreePath: string): JobRecord {
  return store.updateJobStatus({
    attemptsLeft: job.attemptsLeft,
    jobId: job.item.id,
    status: job.status,
    worktreePath,
  });
}

function persistStateChange(
  store: JobStore,
  jobId: string,
  worktreePath: string,
  change: PipelineStateChange,
): void {
  store.updateJobStatus({
    attemptsLeft: change.next.attemptsLeft,
    jobId,
    status: change.next.status,
    worktreePath,
  });
  store.appendEvent({
    jobId,
    payload: {
      event: change.event,
      next: change.next.status,
      previous: change.previous.status,
    },
    stage: change.stage,
    status: change.next.status,
    type: "state-change",
  });
}

function persistPipelineEvent(store: JobStore, jobId: string, event: PipelineRunEvent): void {
  store.appendEvent({
    evidence: "evidence" in event ? event.evidence : undefined,
    gateName: "gateName" in event ? event.gateName : undefined,
    jobId,
    reason: "reason" in event ? event.reason : undefined,
    stage: event.stage,
    type: event.type,
  });
}

function persistFinalState(
  store: JobStore,
  jobId: string,
  worktreePath: string,
  final: MachineState,
): void {
  const persisted = store.getJob(jobId);
  if (
    persisted?.status === final.status &&
    persisted.attemptsLeft === final.attemptsLeft &&
    persisted.worktreePath === worktreePath
  ) {
    return;
  }

  store.updateJobStatus({
    attemptsLeft: final.attemptsLeft,
    jobId,
    status: final.status,
    worktreePath,
  });
}

function machineState(job: JobRecord): MachineState {
  return { attemptsLeft: job.attemptsLeft, status: job.status };
}

function sanitizeBranchSegment(value: string): string {
  return value
    .trim()
    .replaceAll("/", "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-");
}
