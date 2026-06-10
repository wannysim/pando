import {
  initialState,
  STAGE_ORDER,
  transition,
  type MachineState,
  type PipelineEvent,
} from "../core/state-machine";
import type {
  Gate,
  GateContext,
  GateResult,
  JobStatus,
  StageName,
  WorkItem,
  WorkerEngine,
} from "../core/types";
import type { StageConfig, WorkerEngineName, WorkerStageKey } from "../core/stage-config";
import { resolveStageAllowedTools } from "../core/stage-config";
import {
  classifyProviderFailure,
  decideRetry,
  type ProviderFailureKind,
  type ProviderRetryPolicies,
} from "../scheduler/retry-policy";

export interface PipelineRunnerOptions {
  item: WorkItem;
  profile: GateContext["profile"];
  worktree: string;
  stageConfig: StageConfig;
  engines: Record<WorkerEngineName, WorkerEngine>;
  gates?: Partial<Record<StageName, Gate[]>>;
  buildPrompt?: (stage: StageName, context: PromptBuildContext) => string;
  env?: Record<string, string>;
  initialState?: MachineState;
  onEvent?: (event: PipelineRunEvent) => MaybePromise<void>;
  onStateChange?: (change: PipelineStateChange) => MaybePromise<void>;
  clock?: PipelineClock;
  retryPolicies?: ProviderRetryPolicies;
  /** Cooperative cancellation: checked at each stage boundary. */
  shouldCancel?: () => boolean;
  /** Aborting this signal stops the in-flight worker mid-stage. */
  signal?: AbortSignal;
}

export interface PromptBuildContext {
  item: WorkItem;
  profile: GateContext["profile"];
  worktree: string;
}

export interface PipelineRunResult {
  final: MachineState;
  events: PipelineRunEvent[];
  canceled?: boolean;
}

export interface PipelineStateChange {
  previous: MachineState;
  next: MachineState;
  event: PipelineEvent["type"];
  stage?: StageName;
  backoffMs?: number;
  deferredUntilMs?: number;
  reason?: string;
}

export interface PipelineClock {
  nowMs(): number;
}

export type PipelineRunEvent =
  | { type: "stage-started"; stage: StageName; payload: Record<string, unknown> }
  | { type: "stage-completed"; stage: StageName; payload: Record<string, unknown> }
  | {
      type: "stage-failed";
      stage: StageName;
      reason: string;
      evidence?: string;
      gateName?: string;
      payload: Record<string, unknown>;
    }
  | { type: "worker-cost"; stage: StageName; payload: Record<string, unknown> }
  | { type: "engine-pass"; stage: StageName; payload?: Record<string, unknown> }
  | {
      type: "engine-fail";
      stage: StageName;
      reason: string;
      evidence?: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "gate-pass";
      stage: StageName;
      gateName: string;
      evidence?: string;
      payload?: Record<string, unknown>;
    }
  | {
      type: "gate-fail" | "gate-blocking";
      stage: StageName;
      gateName: string;
      reason?: string;
      evidence?: string;
      payload: Record<string, unknown>;
    }
  | { type: "stage-pass"; stage: StageName; payload?: Record<string, unknown> };

interface StageFailureTelemetry {
  evidence?: string;
  failureKind: "engine-fail" | "gate-fail" | "blocking-questions";
  gateName?: string;
  reason: string;
  providerKind?: ProviderFailureKind;
  backoffMs?: number;
}

type StageRunResult =
  | { outcome: "pass" }
  | { outcome: "fail" | "blocking" | "escalate"; failure: StageFailureTelemetry };

type GateRunResult =
  | { outcome: "pass" }
  | { outcome: "fail" | "blocking"; failure: StageFailureTelemetry };

type MaybePromise<T> = T | Promise<T>;
type EmitPipelineEvent = (event: PipelineRunEvent) => Promise<void>;

const WORKER_STAGE_BY_STAGE: Partial<Record<StageName, WorkerStageKey>> = {
  IMPL: "impl",
  PLAN: "plan",
  PR: "pr",
  REVIEW: "review",
  SPEC: "spec",
  TEST: "test",
};

export async function runPipeline(opts: PipelineRunnerOptions): Promise<PipelineRunResult> {
  const budget = opts.stageConfig.defaults.retryBudget;
  const clock = opts.clock ?? ZERO_CLOCK;
  let state = opts.initialState ?? initialState(budget);
  const events: PipelineRunEvent[] = [];
  const emit: EmitPipelineEvent = async (event) => {
    events.push(event);
    await opts.onEvent?.(event);
  };

  if (state.status === "QUEUED") {
    state = await applyTransition(state, { type: "START" }, budget, opts);
  }

  while (isStageStatus(state.status)) {
    if (isCanceled(opts)) {
      return { canceled: true, events, final: state };
    }
    const stage = state.status;
    const attempt = budget - state.attemptsLeft + 1;
    const stageResult = await runStage(stage, attempt, budget, opts, emit, clock);

    // A cancel/abort during the stage stops the job instead of retrying a worker
    // that was killed mid-run.
    if (isCanceled(opts)) {
      return { canceled: true, events, final: state };
    }

    if (stageResult.outcome === "pass") {
      state = await applyTransition(state, { type: "GATE_PASS" }, budget, opts, stage);
      await emit({ stage, type: "stage-pass" });
      continue;
    }

    if (stageResult.outcome === "blocking") {
      state = await applyTransition(state, { type: "BLOCKING_QUESTIONS" }, budget, opts, stage);
      continue;
    }

    if (stageResult.outcome === "escalate") {
      state = await applyTransition(state, { type: "NON_RETRYABLE" }, budget, opts, stage);
      continue;
    }

    const backoffMs = stageResult.failure.backoffMs ?? 0;
    state = await applyTransition(
      state,
      { type: "GATE_FAIL" },
      budget,
      opts,
      stage,
      backoffMs > 0
        ? {
            backoffMs,
            deferredUntilMs: clock.nowMs() + backoffMs,
            reason: stageResult.failure.reason,
          }
        : undefined,
    );
    if (backoffMs > 0 && isStageStatus(state.status)) {
      break;
    }
  }

  return { events, final: state };
}

async function runStage(
  stage: StageName,
  attempt: number,
  maxAttempts: number,
  opts: PipelineRunnerOptions,
  emit: EmitPipelineEvent,
  clock: PipelineClock,
): Promise<StageRunResult> {
  const workerStage = WORKER_STAGE_BY_STAGE[stage];
  const stageStartedAtMs = clock.nowMs();
  const stageWorkerPayload = workerStagePayload(opts, workerStage);

  await emit({ payload: stageWorkerPayload, stage, type: "stage-started" });

  if (workerStage !== undefined) {
    const config = opts.stageConfig.stages[workerStage];
    const result = await opts.engines[config.engine].run({
      allowedTools: resolveStageAllowedTools(opts.stageConfig, workerStage, opts.item.source),
      cwd: opts.worktree,
      env: mergeEnv(config.env, opts.env),
      model: config.model,
      prompt:
        opts.buildPrompt?.(stage, {
          item: opts.item,
          profile: opts.profile,
          worktree: opts.worktree,
        }) ?? `Run ${stage}`,
      signal: opts.signal,
      timeoutMs: opts.stageConfig.defaults.timeoutMinutes * 60_000,
    });

    if (result.costUsd !== undefined) {
      await emit({
        payload: { costUsd: result.costUsd, engine: config.engine, model: config.model },
        stage,
        type: "worker-cost",
      });
    }

    if (!result.ok) {
      const providerKind = classifyProviderFailure({
        errorCode: result.errorCode,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      });
      const decision = decideRetry({
        attempt,
        kind: providerKind,
        maxAttempts,
        policies: opts.retryPolicies,
        provider: config.engine,
      });
      const failure: StageFailureTelemetry = {
        backoffMs: decision.delayMs,
        evidence: result.output,
        failureKind: "engine-fail",
        providerKind,
        reason: `${config.engine} returned ok=false (${providerKind})`,
      };
      await emit({
        evidence: result.output,
        payload: failurePayload(failure),
        reason: failure.reason,
        stage,
        type: "engine-fail",
      });
      await emitFailedStage(stage, failure, stageStartedAtMs, stageWorkerPayload, emit, clock);
      return { failure, outcome: decision.escalate ? "escalate" : "fail" };
    }

    await emit({ payload: stageWorkerPayload, stage, type: "engine-pass" });
  }

  const gateResult = await runGates(stage, opts, emit);
  if (gateResult.outcome !== "pass") {
    await emitFailedStage(
      stage,
      gateResult.failure,
      stageStartedAtMs,
      stageWorkerPayload,
      emit,
      clock,
    );
    return gateResult;
  }

  await emit({
    payload: { ...stageWorkerPayload, durationMs: durationMs(stageStartedAtMs, clock.nowMs()) },
    stage,
    type: "stage-completed",
  });
  return gateResult;
}

async function runGates(
  stage: StageName,
  opts: PipelineRunnerOptions,
  emit: EmitPipelineEvent,
): Promise<GateRunResult> {
  const ctx: GateContext = {
    item: opts.item,
    profile: opts.profile,
    worktree: opts.worktree,
  };

  for (const gate of opts.gates?.[stage] ?? []) {
    const result = await gate.check(ctx);
    if (!result.pass) {
      const event = failedGateEvent(stage, gate.name, result);
      await emit(event);
      const failure = gateFailureTelemetry(gate.name, result);
      return result.failureKind === "blocking-questions" && canEscalateBlockingQuestions(stage)
        ? { failure, outcome: "blocking" }
        : { failure, outcome: "fail" };
    }

    await emit(
      removeUndefined({
        evidence: result.evidence,
        gateName: gate.name,
        stage,
        type: "gate-pass",
      }) as PipelineRunEvent,
    );
  }

  return { outcome: "pass" };
}

function canEscalateBlockingQuestions(stage: StageName): boolean {
  return stage === "SPEC" || stage === "PLAN";
}

function failedGateEvent(stage: StageName, gateName: string, result: GateResult): PipelineRunEvent {
  const failure = gateFailureTelemetry(gateName, result);
  return {
    evidence: result.evidence,
    gateName,
    payload: failurePayload(failure),
    reason: result.reason,
    stage,
    type: result.failureKind === "blocking-questions" ? "gate-blocking" : "gate-fail",
  };
}

async function emitFailedStage(
  stage: StageName,
  failure: StageFailureTelemetry,
  startedAtMs: number,
  stagePayload: Record<string, unknown>,
  emit: EmitPipelineEvent,
  clock: PipelineClock,
): Promise<void> {
  await emit({
    evidence: failure.evidence,
    gateName: failure.gateName,
    payload: {
      ...stagePayload,
      ...failurePayload(failure),
      durationMs: durationMs(startedAtMs, clock.nowMs()),
    },
    reason: failure.reason,
    stage,
    type: "stage-failed",
  });
}

function workerStagePayload(
  opts: PipelineRunnerOptions,
  workerStage: WorkerStageKey | undefined,
): Record<string, unknown> {
  if (workerStage === undefined) return {};
  const config = opts.stageConfig.stages[workerStage];
  return { engine: config.engine, model: config.model };
}

function gateFailureTelemetry(gateName: string, result: GateResult): StageFailureTelemetry {
  return {
    evidence: result.evidence,
    failureKind: result.failureKind === "blocking-questions" ? "blocking-questions" : "gate-fail",
    gateName,
    reason: result.reason ?? `${gateName} failed`,
  };
}

function failurePayload(failure: StageFailureTelemetry): Record<string, unknown> {
  return removeUndefined({
    backoffMs: failure.backoffMs,
    evidence: failure.evidence,
    failureKind: failure.failureKind,
    gateName: failure.gateName,
    providerKind: failure.providerKind,
    reason: failure.reason,
  });
}

function durationMs(startedAtMs: number, endedAtMs: number): number {
  return Math.max(0, endedAtMs - startedAtMs);
}

function isCanceled(opts: PipelineRunnerOptions): boolean {
  return opts.shouldCancel?.() === true || opts.signal?.aborted === true;
}

function isStageStatus(status: JobStatus): status is StageName {
  return STAGE_ORDER.includes(status as StageName);
}

function mergeEnv(
  stageEnv: Record<string, string> | undefined,
  jobEnv: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (stageEnv === undefined && jobEnv === undefined) return undefined;
  return { ...stageEnv, ...jobEnv };
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

const ZERO_CLOCK: PipelineClock = {
  nowMs() {
    return 0;
  },
};

async function applyTransition(
  previous: MachineState,
  event: PipelineEvent,
  budget: number,
  opts: PipelineRunnerOptions,
  stage?: StageName,
  metadata?: Pick<PipelineStateChange, "backoffMs" | "deferredUntilMs" | "reason">,
): Promise<MachineState> {
  const next = transition(previous, event, budget);
  await opts.onStateChange?.({
    backoffMs: metadata?.backoffMs,
    deferredUntilMs: metadata?.deferredUntilMs,
    event: event.type,
    next,
    previous,
    reason: metadata?.reason,
    stage,
  });
  return next;
}
