import { describe, expect, it } from "vitest";
import {
  initialState,
  STAGE_ORDER,
  transition,
  type MachineState,
} from "../../src/core/state-machine.js";

const BUDGET = 3;

function at(status: MachineState["status"], attemptsLeft = BUDGET): MachineState {
  return { status, attemptsLeft };
}

describe("initialState", () => {
  it("QUEUED에서 시작하고 budget을 가진다", () => {
    expect(initialState(BUDGET)).toEqual({ status: "QUEUED", attemptsLeft: BUDGET });
  });

  it("budget은 1 이상이어야 한다", () => {
    expect(() => initialState(0)).toThrow();
    expect(() => initialState(-1)).toThrow();
  });
});

describe("happy path", () => {
  it("START: QUEUED → SPEC", () => {
    const next = transition(at("QUEUED"), { type: "START" }, BUDGET);
    expect(next).toEqual({ status: "SPEC", attemptsLeft: BUDGET });
  });

  it("GATE_PASS로 SPEC→PLAN→TEST→IMPL→REVIEW→PR→DONE 순서대로 전이한다", () => {
    let state = at("SPEC");
    const expected = [...STAGE_ORDER.slice(1), "DONE"];
    for (const want of expected) {
      state = transition(state, { type: "GATE_PASS" }, BUDGET);
      expect(state.status).toBe(want);
    }
  });

  it("GATE_PASS는 다음 단계의 attemptsLeft를 budget으로 리셋한다", () => {
    const worn = at("SPEC", 1);
    const next = transition(worn, { type: "GATE_PASS" }, BUDGET);
    expect(next).toEqual({ status: "PLAN", attemptsLeft: BUDGET });
  });
});

describe("retry budget (게이트 실패)", () => {
  it("GATE_FAIL은 같은 단계에 머물며 attemptsLeft를 차감한다", () => {
    const next = transition(at("IMPL", 3), { type: "GATE_FAIL" }, BUDGET);
    expect(next).toEqual({ status: "IMPL", attemptsLeft: 2 });
  });

  it("attemptsLeft가 소진되면 FAILED", () => {
    const next = transition(at("IMPL", 1), { type: "GATE_FAIL" }, BUDGET);
    expect(next.status).toBe("FAILED");
  });

  it("모든 단계에서 동일하게 동작한다", () => {
    for (const stage of STAGE_ORDER) {
      expect(transition(at(stage, 2), { type: "GATE_FAIL" }, BUDGET)).toEqual({
        status: stage,
        attemptsLeft: 1,
      });
      expect(transition(at(stage, 1), { type: "GATE_FAIL" }, BUDGET).status).toBe("FAILED");
    }
  });
});

describe("REVIEW 회귀", () => {
  it("CHANGES_REQUESTED: REVIEW → IMPL (attemptsLeft 차감)", () => {
    const next = transition(at("REVIEW", 2), { type: "CHANGES_REQUESTED" }, BUDGET);
    expect(next).toEqual({ status: "IMPL", attemptsLeft: 1 });
  });

  it("회귀 budget 소진 시 FAILED", () => {
    const next = transition(at("REVIEW", 1), { type: "CHANGES_REQUESTED" }, BUDGET);
    expect(next.status).toBe("FAILED");
  });

  it("REVIEW 외 단계에서 CHANGES_REQUESTED는 불허", () => {
    expect(() => transition(at("IMPL"), { type: "CHANGES_REQUESTED" }, BUDGET)).toThrow(
      /invalid/i,
    );
  });
});

describe("에스컬레이션", () => {
  it("BLOCKING_QUESTIONS: PLAN → ESCALATED", () => {
    const next = transition(at("PLAN"), { type: "BLOCKING_QUESTIONS" }, BUDGET);
    expect(next.status).toBe("ESCALATED");
  });

  it("PLAN 외 단계에서 BLOCKING_QUESTIONS는 불허", () => {
    expect(() => transition(at("SPEC"), { type: "BLOCKING_QUESTIONS" }, BUDGET)).toThrow(
      /invalid/i,
    );
  });
});

describe("불허 전이 (전수)", () => {
  it("START는 QUEUED에서만 가능", () => {
    for (const stage of STAGE_ORDER) {
      expect(() => transition(at(stage), { type: "START" }, BUDGET)).toThrow(/invalid/i);
    }
  });

  it("QUEUED에서 게이트 이벤트는 불허", () => {
    expect(() => transition(at("QUEUED"), { type: "GATE_PASS" }, BUDGET)).toThrow(/invalid/i);
    expect(() => transition(at("QUEUED"), { type: "GATE_FAIL" }, BUDGET)).toThrow(/invalid/i);
  });

  it("터미널 상태(DONE/FAILED/ESCALATED)에서는 어떤 이벤트도 불허", () => {
    const events = [
      { type: "START" },
      { type: "GATE_PASS" },
      { type: "GATE_FAIL" },
      { type: "CHANGES_REQUESTED" },
      { type: "BLOCKING_QUESTIONS" },
    ] as const;
    for (const status of ["DONE", "FAILED", "ESCALATED"] as const) {
      for (const event of events) {
        expect(() => transition(at(status), event, BUDGET)).toThrow(/terminal/i);
      }
    }
  });
});

describe("순수성", () => {
  it("transition은 입력 상태를 변이하지 않는다", () => {
    const state = at("IMPL", 2);
    transition(state, { type: "GATE_FAIL" }, BUDGET);
    expect(state).toEqual({ status: "IMPL", attemptsLeft: 2 });
  });
});
