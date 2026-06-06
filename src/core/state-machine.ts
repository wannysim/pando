/**
 * 파이프라인 상태머신 — docs/repo-structure.md §3, design-v2 §4
 *
 * QUEUED → SPEC → PLAN → TEST → IMPL → REVIEW → PR → DONE
 *                  │               ▲      │
 *                  │               └──────┘ CHANGES_REQUESTED (budget 차감)
 * SPEC/PLAN → ESCALATED (blocking open questions)
 * 모든 단계: GATE_FAIL → 같은 단계 재시도 (budget 차감), 소진 시 FAILED
 *
 * 순수 함수만 — I/O 없음 (CLAUDE.md 규율 4).
 */

import type { JobStatus, StageName } from "./types";

export const STAGE_ORDER: readonly StageName[] = [
  "SPEC",
  "PLAN",
  "TEST",
  "IMPL",
  "REVIEW",
  "PR",
];

const TERMINAL: readonly JobStatus[] = ["DONE", "FAILED", "ESCALATED"];

export type PipelineEvent =
  | { type: "START" }
  | { type: "GATE_PASS" }
  | { type: "GATE_FAIL" }
  | { type: "CHANGES_REQUESTED" }
  | { type: "BLOCKING_QUESTIONS" };

export interface MachineState {
  status: JobStatus;
  attemptsLeft: number;
}

export function initialState(budget: number): MachineState {
  if (budget < 1) throw new Error(`budget must be >= 1, got ${budget}`);
  return { status: "QUEUED", attemptsLeft: budget };
}

function isStage(status: JobStatus): status is StageName {
  return (STAGE_ORDER as readonly string[]).includes(status);
}

function nextStage(stage: StageName): JobStatus {
  const idx = STAGE_ORDER.indexOf(stage);
  const next = STAGE_ORDER[idx + 1];
  return next ?? "DONE";
}

function consumeAttempt(state: MachineState, to: StageName): MachineState {
  const attemptsLeft = state.attemptsLeft - 1;
  if (attemptsLeft <= 0) return { status: "FAILED", attemptsLeft: 0 };
  return { status: to, attemptsLeft };
}

function invalid(state: MachineState, event: PipelineEvent): never {
  throw new Error(`invalid transition: ${event.type} from ${state.status}`);
}

export function transition(
  state: MachineState,
  event: PipelineEvent,
  budget: number,
): MachineState {
  if (TERMINAL.includes(state.status)) {
    throw new Error(`terminal state: no transition from ${state.status}`);
  }

  switch (event.type) {
    case "START":
      if (state.status !== "QUEUED") invalid(state, event);
      return { status: "SPEC", attemptsLeft: budget };

    case "GATE_PASS":
      if (!isStage(state.status)) invalid(state, event);
      return { status: nextStage(state.status), attemptsLeft: budget };

    case "GATE_FAIL":
      if (!isStage(state.status)) invalid(state, event);
      return consumeAttempt(state, state.status);

    case "CHANGES_REQUESTED":
      if (state.status !== "REVIEW") invalid(state, event);
      return consumeAttempt(state, "IMPL");

    case "BLOCKING_QUESTIONS":
      if (state.status !== "SPEC" && state.status !== "PLAN") invalid(state, event);
      return { status: "ESCALATED", attemptsLeft: state.attemptsLeft };
  }
}
