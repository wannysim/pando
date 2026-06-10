import { describe, expect, it } from "bun:test";
import {
  initialState,
  STAGE_ORDER,
  transition,
  type MachineState,
} from "../../src/core/state-machine";

const BUDGET = 3;

function at(status: MachineState["status"], attemptsLeft = BUDGET): MachineState {
  return { status, attemptsLeft };
}

describe("initialState", () => {
  it("starts in QUEUED with the given budget", () => {
    expect(initialState(BUDGET)).toEqual({ status: "QUEUED", attemptsLeft: BUDGET });
  });

  it("requires a budget of at least 1", () => {
    expect(() => initialState(0)).toThrow();
    expect(() => initialState(-1)).toThrow();
  });
});

describe("happy path", () => {
  it("START: QUEUED → SPEC", () => {
    const next = transition(at("QUEUED"), { type: "START" }, BUDGET);
    expect(next).toEqual({ status: "SPEC", attemptsLeft: BUDGET });
  });

  it("moves through SPEC, PLAN, TEST, IMPL, REVIEW, PR, and DONE on GATE_PASS", () => {
    let state = at("SPEC");
    const expected: MachineState["status"][] = [...STAGE_ORDER.slice(1), "DONE"];
    for (const want of expected) {
      state = transition(state, { type: "GATE_PASS" }, BUDGET);
      expect(state.status).toBe(want);
    }
  });

  it("resets attemptsLeft to the budget when GATE_PASS advances to the next stage", () => {
    const worn = at("SPEC", 1);
    const next = transition(worn, { type: "GATE_PASS" }, BUDGET);
    expect(next).toEqual({ status: "PLAN", attemptsLeft: BUDGET });
  });
});

describe("retry budget on gate failure", () => {
  it("keeps the same stage and decrements attemptsLeft on GATE_FAIL", () => {
    const next = transition(at("IMPL", 3), { type: "GATE_FAIL" }, BUDGET);
    expect(next).toEqual({ status: "IMPL", attemptsLeft: 2 });
  });

  it("moves to FAILED when attemptsLeft is exhausted", () => {
    const next = transition(at("IMPL", 1), { type: "GATE_FAIL" }, BUDGET);
    expect(next.status).toBe("FAILED");
  });

  it("applies the same retry behavior to every stage", () => {
    for (const stage of STAGE_ORDER) {
      expect(transition(at(stage, 2), { type: "GATE_FAIL" }, BUDGET)).toEqual({
        status: stage,
        attemptsLeft: 1,
      });
      expect(transition(at(stage, 1), { type: "GATE_FAIL" }, BUDGET).status).toBe("FAILED");
    }
  });
});

describe("review rework", () => {
  it("moves REVIEW to IMPL and decrements attemptsLeft on CHANGES_REQUESTED", () => {
    const next = transition(at("REVIEW", 2), { type: "CHANGES_REQUESTED" }, BUDGET);
    expect(next).toEqual({ status: "IMPL", attemptsLeft: 1 });
  });

  it("moves to FAILED when the rework budget is exhausted", () => {
    const next = transition(at("REVIEW", 1), { type: "CHANGES_REQUESTED" }, BUDGET);
    expect(next.status).toBe("FAILED");
  });

  it("rejects CHANGES_REQUESTED outside REVIEW", () => {
    expect(() => transition(at("IMPL"), { type: "CHANGES_REQUESTED" }, BUDGET)).toThrow(/invalid/i);
  });
});

describe("escalation", () => {
  it("BLOCKING_QUESTIONS: SPEC or PLAN → ESCALATED", () => {
    expect(transition(at("SPEC"), { type: "BLOCKING_QUESTIONS" }, BUDGET).status).toBe("ESCALATED");
    expect(transition(at("PLAN"), { type: "BLOCKING_QUESTIONS" }, BUDGET).status).toBe("ESCALATED");
  });

  it("rejects BLOCKING_QUESTIONS after PLAN", () => {
    expect(() => transition(at("TEST"), { type: "BLOCKING_QUESTIONS" }, BUDGET)).toThrow(
      /invalid/i,
    );
  });

  it("NON_RETRYABLE: any stage → ESCALATED without consuming the budget", () => {
    for (const stage of STAGE_ORDER) {
      const next = transition(at(stage, 2), { type: "NON_RETRYABLE" }, BUDGET);
      expect(next).toEqual({ attemptsLeft: 2, status: "ESCALATED" });
    }
  });

  it("rejects NON_RETRYABLE from QUEUED", () => {
    expect(() => transition(at("QUEUED"), { type: "NON_RETRYABLE" }, BUDGET)).toThrow(/invalid/i);
  });
});

describe("invalid transitions", () => {
  it("allows START only from QUEUED", () => {
    for (const stage of STAGE_ORDER) {
      expect(() => transition(at(stage), { type: "START" }, BUDGET)).toThrow(/invalid/i);
    }
  });

  it("rejects gate events from QUEUED", () => {
    expect(() => transition(at("QUEUED"), { type: "GATE_PASS" }, BUDGET)).toThrow(/invalid/i);
    expect(() => transition(at("QUEUED"), { type: "GATE_FAIL" }, BUDGET)).toThrow(/invalid/i);
  });

  it("rejects every event from terminal states", () => {
    const events = [
      { type: "START" },
      { type: "GATE_PASS" },
      { type: "GATE_FAIL" },
      { type: "CHANGES_REQUESTED" },
      { type: "BLOCKING_QUESTIONS" },
      { type: "NON_RETRYABLE" },
    ] as const;
    for (const status of ["DONE", "FAILED", "ESCALATED", "CANCELED"] as const) {
      for (const event of events) {
        expect(() => transition(at(status), event, BUDGET)).toThrow(/terminal/i);
      }
    }
  });
});

describe("purity", () => {
  it("does not mutate the input state", () => {
    const state = at("IMPL", 2);
    transition(state, { type: "GATE_FAIL" }, BUDGET);
    expect(state).toEqual({ status: "IMPL", attemptsLeft: 2 });
  });
});
