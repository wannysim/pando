import {
  initialState,
  STAGE_ORDER,
  transition,
  type MachineState,
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

export interface PipelineRunnerOptions {
  item: WorkItem;
  profile: GateContext["profile"];
  worktree: string;
  stageConfig: StageConfig;
  engines: Record<WorkerEngineName, WorkerEngine>;
  gates?: Partial<Record<StageName, Gate[]>>;
  buildPrompt?: (stage: StageName) => string;
}

export interface PipelineRunResult {
  final: MachineState;
  events: PipelineRunEvent[];
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

const WORKER_STAGE_BY_STAGE: Partial<Record<StageName, WorkerStageKey>> = {
  IMPL: "impl",
  PLAN: "plan",
  REVIEW: "review",
  SPEC: "spec",
  TEST: "test",
};

export async function runPipeline(opts: PipelineRunnerOptions): Promise<PipelineRunResult> {
  const budget = opts.stageConfig.defaults.retryBudget;
  let state = transition(initialState(budget), { type: "START" }, budget);
  const events: PipelineRunEvent[] = [];

  while (isStageStatus(state.status)) {
    const stage = state.status;
    const stageResult = await runStage(stage, opts, events);

    if (stageResult === "pass") {
      state = transition(state, { type: "GATE_PASS" }, budget);
      events.push({ stage, type: "stage-pass" });
      continue;
    }

    if (stageResult === "blocking") {
      state = transition(state, { type: "BLOCKING_QUESTIONS" }, budget);
      continue;
    }

    state = transition(state, { type: "GATE_FAIL" }, budget);
  }

  return { events, final: state };
}

async function runStage(
  stage: StageName,
  opts: PipelineRunnerOptions,
  events: PipelineRunEvent[],
): Promise<"pass" | "fail" | "blocking"> {
  const workerStage = WORKER_STAGE_BY_STAGE[stage];

  if (workerStage !== undefined) {
    const config = opts.stageConfig.stages[workerStage];
    const result = await opts.engines[config.engine].run({
      allowedTools: config.allowedTools,
      cwd: opts.worktree,
      env: config.env,
      model: config.model,
      prompt: opts.buildPrompt?.(stage) ?? `Run ${stage}`,
      timeoutMs: opts.stageConfig.defaults.timeoutMinutes * 60_000,
    });

    if (!result.ok) {
      events.push({
        evidence: result.output,
        reason: `${config.engine} returned ok=false`,
        stage,
        type: "engine-fail",
      });
      return "fail";
    }

    events.push({ stage, type: "engine-pass" });
  }

  return runGates(stage, opts, events);
}

async function runGates(
  stage: StageName,
  opts: PipelineRunnerOptions,
  events: PipelineRunEvent[],
): Promise<"pass" | "fail" | "blocking"> {
  const ctx: GateContext = {
    item: opts.item,
    profile: opts.profile,
    worktree: opts.worktree,
  };

  for (const gate of opts.gates?.[stage] ?? []) {
    const result = await gate.check(ctx);
    if (!result.pass) {
      events.push(failedGateEvent(stage, gate.name, result));
      return result.failureKind === "blocking-questions" && stage === "PLAN"
        ? "blocking"
        : "fail";
    }

    events.push({ gateName: gate.name, stage, type: "gate-pass" });
  }

  return "pass";
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
