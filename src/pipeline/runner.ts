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

export interface PipelineRunnerOptions {
  item: WorkItem;
  profile: GateContext["profile"];
  worktree: string;
  stageConfig: StageConfig;
  engines: Record<WorkerEngineName, WorkerEngine>;
  gates?: Partial<Record<StageName, Gate[]>>;
  buildPrompt?: (stage: StageName) => string;
  env?: Record<string, string>;
  initialState?: MachineState;
  onEvent?: (event: PipelineRunEvent) => MaybePromise<void>;
  onStateChange?: (change: PipelineStateChange) => MaybePromise<void>;
  clock?: PipelineClock;
}

export interface PipelineRunResult {
  final: MachineState;
  events: PipelineRunEvent[];
}

export interface PipelineStateChange {
  previous: MachineState;
  next: MachineState;
  event: PipelineEvent["type"];
  stage?: StageName;
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
  | { type: "gate-pass"; stage: StageName; gateName: string; payload?: Record<string, unknown> }
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
}

type StageRunResult =
  | { outcome: "pass" }
  | { outcome: "fail" | "blocking"; failure: StageFailureTelemetry };

type GateRunResult =
  | { outcome: "pass" }
  | { outcome: "fail" | "blocking"; failure: StageFailureTelemetry };

type MaybePromise<T> = T | Promise<T>;
type EmitPipelineEvent = (event: PipelineRunEvent) => Promise<void>;

const WORKER_STAGE_BY_STAGE: Partial<Record<StageName, WorkerStageKey>> = {
  IMPL: "impl",
  PLAN: "plan",
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
    const stage = state.status;
    const stageResult = await runStage(stage, opts, emit, clock);

    if (stageResult.outcome === "pass") {
      state = await applyTransition(state, { type: "GATE_PASS" }, budget, opts, stage);
      await emit({ stage, type: "stage-pass" });
      continue;
    }

    if (stageResult.outcome === "blocking") {
      state = await applyTransition(state, { type: "BLOCKING_QUESTIONS" }, budget, opts, stage);
      continue;
    }

    state = await applyTransition(state, { type: "GATE_FAIL" }, budget, opts, stage);
  }

  return { events, final: state };
}

async function runStage(
  stage: StageName,
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
      prompt: opts.buildPrompt?.(stage) ?? `Run ${stage}`,
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
      const failure: StageFailureTelemetry = {
        evidence: result.output,
        failureKind: "engine-fail",
        reason: `${config.engine} returned ok=false`,
      };
      await emit({
        evidence: result.output,
        payload: failurePayload(failure),
        reason: failure.reason,
        stage,
        type: "engine-fail",
      });
      await emitFailedStage(stage, failure, stageStartedAtMs, stageWorkerPayload, emit, clock);
      return { failure, outcome: "fail" };
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

    await emit({ gateName: gate.name, stage, type: "gate-pass" });
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
    evidence: failure.evidence,
    failureKind: failure.failureKind,
    gateName: failure.gateName,
    reason: failure.reason,
  });
}

function durationMs(startedAtMs: number, endedAtMs: number): number {
  return Math.max(0, endedAtMs - startedAtMs);
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
): Promise<MachineState> {
  const next = transition(previous, event, budget);
  await opts.onStateChange?.({
    event: event.type,
    next,
    previous,
    stage,
  });
  return next;
}
