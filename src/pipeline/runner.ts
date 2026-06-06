import {
  initialState,
  STAGE_ORDER,
  transition,
  type MachineState,
  type PipelineEvent,
} from "../core/state-machine.js";
import type {
  Gate,
  GateContext,
  GateResult,
  JobStatus,
  StageName,
  WorkItem,
  WorkerEngine,
} from "../core/types.js";
import type {
  StageConfig,
  WorkerEngineName,
  WorkerStageKey,
} from "../core/stage-config.js";
import { resolveStageAllowedTools } from "../core/stage-config.js";

export interface PipelineRunnerOptions {
  item: WorkItem;
  profile: GateContext["profile"];
  worktree: string;
  stageConfig: StageConfig;
  engines: Record<WorkerEngineName, WorkerEngine>;
  gates?: Partial<Record<StageName, Gate[]>>;
  buildPrompt?: (stage: StageName) => string;
  initialState?: MachineState;
  onEvent?: (event: PipelineRunEvent) => MaybePromise<void>;
  onStateChange?: (change: PipelineStateChange) => MaybePromise<void>;
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

export type PipelineRunEvent =
  | { type: "engine-pass"; stage: StageName }
  | { type: "engine-fail"; stage: StageName; reason: string; evidence?: string }
  | { type: "gate-pass"; stage: StageName; gateName: string }
  | {
      type: "gate-fail" | "gate-blocking";
      stage: StageName;
      gateName: string;
      reason?: string;
      evidence?: string;
    }
  | { type: "stage-pass"; stage: StageName };

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
    const stageResult = await runStage(stage, opts, emit);

    if (stageResult === "pass") {
      state = await applyTransition(state, { type: "GATE_PASS" }, budget, opts, stage);
      await emit({ stage, type: "stage-pass" });
      continue;
    }

    if (stageResult === "blocking") {
      state = await applyTransition(
        state,
        { type: "BLOCKING_QUESTIONS" },
        budget,
        opts,
        stage,
      );
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
): Promise<"pass" | "fail" | "blocking"> {
  const workerStage = WORKER_STAGE_BY_STAGE[stage];

  if (workerStage !== undefined) {
    const config = opts.stageConfig.stages[workerStage];
    const result = await opts.engines[config.engine].run({
      allowedTools: resolveStageAllowedTools(opts.stageConfig, workerStage, opts.item.source),
      cwd: opts.worktree,
      env: config.env,
      model: config.model,
      prompt: opts.buildPrompt?.(stage) ?? `Run ${stage}`,
      timeoutMs: opts.stageConfig.defaults.timeoutMinutes * 60_000,
    });

    if (!result.ok) {
      await emit({
        evidence: result.output,
        reason: `${config.engine} returned ok=false`,
        stage,
        type: "engine-fail",
      });
      return "fail";
    }

    await emit({ stage, type: "engine-pass" });
  }

  return runGates(stage, opts, emit);
}

async function runGates(
  stage: StageName,
  opts: PipelineRunnerOptions,
  emit: EmitPipelineEvent,
): Promise<"pass" | "fail" | "blocking"> {
  const ctx: GateContext = {
    item: opts.item,
    profile: opts.profile,
    worktree: opts.worktree,
  };

  for (const gate of opts.gates?.[stage] ?? []) {
    const result = await gate.check(ctx);
    if (!result.pass) {
      await emit(failedGateEvent(stage, gate.name, result));
      return result.failureKind === "blocking-questions" && canEscalateBlockingQuestions(stage)
        ? "blocking"
        : "fail";
    }

    await emit({ gateName: gate.name, stage, type: "gate-pass" });
  }

  return "pass";
}

function canEscalateBlockingQuestions(stage: StageName): boolean {
  return stage === "SPEC" || stage === "PLAN";
}

function failedGateEvent(
  stage: StageName,
  gateName: string,
  result: GateResult,
): PipelineRunEvent {
  return {
    evidence: result.evidence,
    gateName,
    reason: result.reason,
    stage,
    type: result.failureKind === "blocking-questions" ? "gate-blocking" : "gate-fail",
  };
}

function isStageStatus(status: JobStatus): status is StageName {
  return STAGE_ORDER.includes(status as StageName);
}

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
