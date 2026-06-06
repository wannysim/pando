import type { JobRecord, JobStore } from "../db/index";
import type { MachineState } from "../core/state-machine";
import type {
  JobStatus,
  RepoProfile,
  WorkItem,
} from "../core/types";
import {
  runPipeline,
  type PipelineRunEvent,
  type PipelineRunResult,
  type PipelineRunnerOptions,
  type PipelineStateChange,
} from "../pipeline/runner";

export interface WorktreeProvisioner {
  ensure(input: WorktreeProvisionInput): Promise<WorktreeProvisionResult>;
}

export interface WorktreeProvisionInput {
  item: WorkItem;
  profile: RepoProfile;
  branch: string;
}

export interface WorktreeProvisionResult {
  path: string;
  branch: string;
  reused?: boolean;
}

export interface DaemonOnceOptions
  extends Pick<
    PipelineRunnerOptions,
    "buildPrompt" | "engines" | "gates" | "stageConfig"
  > {
  store: JobStore;
  profiles?: Record<string, RepoProfile>;
  worktrees: WorktreeProvisioner;
  runner?: (opts: PipelineRunnerOptions) => Promise<PipelineRunResult>;
}

export type DaemonOnceResult =
  | { status: "idle" }
  | { status: "ran" | "failed"; jobId: string; finalStatus: JobStatus };

export async function runDaemonOnce(
  opts: DaemonOnceOptions,
): Promise<DaemonOnceResult> {
  const job = opts.store.claimNextRunnable();
  if (job === undefined) return { status: "idle" };

  try {
    const profile = resolveProfile(opts, job.item);
    const branch = branchForItem(job.item);
    const worktree = await opts.worktrees.ensure({ branch, item: job.item, profile });
    const initial = persistWorktreePath(opts.store, job, worktree.path);
    const result = await (opts.runner ?? runPipeline)({
      buildPrompt: opts.buildPrompt,
      engines: opts.engines,
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
}

export function branchForItem(item: WorkItem): string {
  return item.branch ?? `feat/${sanitizeBranchSegment(item.id)}`;
}

function resolveProfile(opts: DaemonOnceOptions, item: WorkItem): RepoProfile {
  const profile = opts.profiles?.[item.repo] ?? opts.store.getRepoProfile(item.repo);
  if (profile === undefined) throw new Error(`repo profile not found: ${item.repo}`);
  return profile;
}

function persistWorktreePath(
  store: JobStore,
  job: JobRecord,
  worktreePath: string,
): JobRecord {
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

function persistPipelineEvent(
  store: JobStore,
  jobId: string,
  event: PipelineRunEvent,
): void {
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
  return value.trim().replaceAll("/", "-").replace(/[^A-Za-z0-9._-]+/g, "-");
}
