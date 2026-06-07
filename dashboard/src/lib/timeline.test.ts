import { describe, expect, it } from "vitest";
import { groupEventsByStage } from "./timeline";
import type { ApiJobEvent } from "../../../src/api/schema";

describe("groupEventsByStage", () => {
  it("collapses a passing stage into one entry with start, end, and duration", () => {
    const entries = groupEventsByStage([
      event(1, "stage-started", { createdAt: "2026-06-07T00:00:00.000Z", stage: "PLAN" }),
      event(2, "engine-pass", { createdAt: "2026-06-07T00:00:05.000Z", stage: "PLAN" }),
      event(3, "stage-completed", {
        createdAt: "2026-06-07T00:01:12.000Z",
        payload: { costUsd: 0.5 },
        stage: "PLAN",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      attempt: 1,
      costUsd: 0.5,
      durationMs: 72_000,
      endedAt: "2026-06-07T00:01:12.000Z",
      outcome: "passed",
      stage: "PLAN",
      startedAt: "2026-06-07T00:00:00.000Z",
    });
  });

  it("numbers repeated stage attempts and captures the failure reason, gate, and evidence", () => {
    const entries = groupEventsByStage([
      event(1, "stage-started", { stage: "IMPL" }),
      event(2, "gate-fail", {
        evidence: '{"exitCode":1}',
        gateName: "test-exit-code",
        reason: "test gate failed",
        stage: "IMPL",
      }),
      event(3, "stage-failed", { reason: "test gate failed", stage: "IMPL" }),
      event(4, "stage-started", { stage: "IMPL" }),
      event(5, "stage-completed", { stage: "IMPL" }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      attempt: 1,
      evidence: '{"exitCode":1}',
      gateName: "test-exit-code",
      outcome: "failed",
      reason: "test gate failed",
      stage: "IMPL",
    });
    expect(entries[1]).toMatchObject({ attempt: 2, outcome: "passed", stage: "IMPL" });
  });

  it("marks an in-progress stage as running with no end time", () => {
    const entries = groupEventsByStage([event(1, "stage-started", { stage: "SPEC" })]);

    expect(entries[0]).toMatchObject({ endedAt: null, outcome: "running", stage: "SPEC" });
  });

  it("falls back to payload durationMs when there is no bracketing end event", () => {
    const entries = groupEventsByStage([
      event(1, "stage-failed", { payload: { durationMs: 1234 }, reason: "boom", stage: "IMPL" }),
    ]);

    expect(entries[0]).toMatchObject({ durationMs: 1234, outcome: "failed" });
  });
});

function event(
  sequence: number,
  type: string,
  overrides: Partial<ApiJobEvent> & { payload?: Record<string, unknown> } = {},
): ApiJobEvent {
  return {
    createdAt: overrides.createdAt ?? `2026-06-07T00:00:0${sequence}.000Z`,
    evidence: overrides.evidence ?? null,
    gateName: overrides.gateName ?? null,
    jobId: "JOB-1",
    payload: overrides.payload ?? {},
    reason: overrides.reason ?? null,
    sequence,
    stage: overrides.stage ?? null,
    status: overrides.status ?? null,
    type,
  };
}
