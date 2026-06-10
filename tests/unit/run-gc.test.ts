import { describe, expect, it } from "bun:test";
import { planRunGc, type RunRecord } from "../../src/core/run-gc";

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "local-20260607-010101",
    runRoot: "/tmp/pando-local-20260607-010101",
    pid: 1234,
    startedAt: "2026-06-07T01:01:01.000Z",
    ...overrides,
  };
}

const alive = () => true;
const dead = () => false;

describe("planRunGc", () => {
  it("reaps a run whose owning process is dead (orphaned)", () => {
    const run = record({ pid: 4242 });

    const plan = planRunGc({ runs: [run], isAlive: dead });

    expect(plan.reap).toEqual([{ run, reason: "orphaned" }]);
    expect(plan.keep).toEqual([]);
  });

  it("keeps a run whose owning process is still alive (running)", () => {
    const run = record({ pid: 4242 });

    const plan = planRunGc({ runs: [run], isAlive: alive });

    expect(plan.keep).toEqual([{ run, reason: "running" }]);
    expect(plan.reap).toEqual([]);
  });

  it("reaps a run marked finished even when the process still appears alive", () => {
    const run = record({ finishedAt: "2026-06-07T02:00:00.000Z" });

    const plan = planRunGc({ runs: [run], isAlive: alive });

    expect(plan.reap).toEqual([{ run, reason: "finished" }]);
    expect(plan.keep).toEqual([]);
  });

  it("keeps an already-cleaned run as a no-op regardless of liveness", () => {
    const run = record({
      finishedAt: "2026-06-07T02:00:00.000Z",
      cleanedAt: "2026-06-07T02:05:00.000Z",
    });

    expect(planRunGc({ runs: [run], isAlive: dead })).toEqual({
      reap: [],
      keep: [{ run, reason: "already-cleaned" }],
    });
  });

  it("classifies a mixed manifest and preserves input order in each bucket", () => {
    const orphan = record({ id: "a", pid: 1, runRoot: "/tmp/pando-a" });
    const running = record({ id: "b", pid: 2, runRoot: "/tmp/pando-b" });
    const finished = record({
      id: "c",
      pid: 3,
      runRoot: "/tmp/pando-c",
      finishedAt: "2026-06-07T02:00:00.000Z",
    });
    const cleaned = record({
      id: "d",
      pid: 4,
      runRoot: "/tmp/pando-d",
      cleanedAt: "2026-06-07T02:05:00.000Z",
    });
    const isAlive = (pid: number) => pid === 2;

    const plan = planRunGc({ runs: [orphan, running, finished, cleaned], isAlive });

    expect(plan.reap).toEqual([
      { run: orphan, reason: "orphaned" },
      { run: finished, reason: "finished" },
    ]);
    expect(plan.keep).toEqual([
      { run: running, reason: "running" },
      { run: cleaned, reason: "already-cleaned" },
    ]);
  });

  it("returns empty buckets for an empty manifest", () => {
    expect(planRunGc({ runs: [], isAlive: alive })).toEqual({ reap: [], keep: [] });
  });
});
