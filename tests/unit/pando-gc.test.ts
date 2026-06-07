import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../src/core/run-gc";
import { runPandoGc, type PandoGcDeps } from "../../src/cli/pando-gc";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: "local-a",
    runRoot: "/tmp/pando-local-a",
    pid: 11,
    startedAt: "2026-06-07T01:00:00.000Z",
    ...overrides,
  };
}

interface Harness {
  deps: PandoGcDeps;
  removed: string[];
  cleaned: string[];
  pruneCalls: number;
  lines: string[];
}

function harness(runs: RunRecord[], alivePids: number[] = []): Harness {
  const removed: string[] = [];
  const cleaned: string[] = [];
  const lines: string[] = [];
  let pruneCalls = 0;

  const deps: PandoGcDeps = {
    now: () => new Date("2026-06-07T05:00:00.000Z"),
    isAlive: (pid) => alivePids.includes(pid),
    readManifest: () => Promise.resolve(runs),
    removeRunRoot: (runRoot) => {
      removed.push(runRoot);
      return Promise.resolve();
    },
    pruneRepos: () => {
      pruneCalls += 1;
      return Promise.resolve(["/repo/pando"]);
    },
    markCleaned: (id) => {
      cleaned.push(id);
      return Promise.resolve();
    },
    log: (line) => lines.push(line),
  };

  return {
    deps,
    removed,
    cleaned,
    get pruneCalls() {
      return pruneCalls;
    },
    lines,
  };
}

describe("runPandoGc — dry run (default)", () => {
  it("lists reap candidates without deleting anything", async () => {
    const orphan = makeRun({ id: "dead", pid: 99 });
    const live = makeRun({ id: "alive", pid: 11 });
    const h = harness([orphan, live], [11]);

    const code = await runPandoGc([], h.deps);

    expect(code).toBe(0);
    expect(h.removed).toEqual([]);
    expect(h.cleaned).toEqual([]);
    expect(h.pruneCalls).toBe(0);
    const text = h.lines.join("\n");
    expect(text).toContain("/tmp/pando-local-a");
    expect(text).toMatch(/--force/);
  });
});

describe("runPandoGc --force", () => {
  it("removes each reaped run-root, marks it cleaned, and prunes repos once", async () => {
    const orphan = makeRun({ id: "dead", runRoot: "/tmp/pando-dead", pid: 99 });
    const finished = makeRun({
      id: "done",
      runRoot: "/tmp/pando-done",
      pid: 11,
      finishedAt: "2026-06-07T02:00:00.000Z",
    });
    const live = makeRun({ id: "alive", runRoot: "/tmp/pando-alive", pid: 11 });
    const h = harness([orphan, finished, live], [11]);

    const code = await runPandoGc(["--force"], h.deps);

    expect(code).toBe(0);
    expect(h.removed).toEqual(["/tmp/pando-dead", "/tmp/pando-done"]);
    expect(h.cleaned).toEqual(["dead", "done"]);
    expect(h.pruneCalls).toBe(1);
  });

  it("never touches a live run-root", async () => {
    const live = makeRun({ id: "alive", runRoot: "/tmp/pando-alive", pid: 11 });
    const h = harness([live], [11]);

    await runPandoGc(["--force"], h.deps);

    expect(h.removed).toEqual([]);
    expect(h.pruneCalls).toBe(0);
  });

  it("continues past a failed removal, skips its cleaned-mark, and exits non-zero", async () => {
    const bad = makeRun({ id: "bad", runRoot: "/tmp/pando-bad", pid: 1 });
    const good = makeRun({ id: "good", runRoot: "/tmp/pando-good", pid: 2 });
    const h = harness([bad, good], []);
    h.deps.removeRunRoot = (runRoot) => {
      if (runRoot === "/tmp/pando-bad") return Promise.reject(new Error("EBUSY"));
      return Promise.resolve();
    };

    const code = await runPandoGc(["--force"], h.deps);

    expect(code).toBe(1);
    expect(h.cleaned).toEqual(["good"]);
  });
});

describe("runPandoGc — reporting", () => {
  it("reports a clean manifest when nothing needs reaping", async () => {
    const h = harness([makeRun({ pid: 11 })], [11]);

    const code = await runPandoGc([], h.deps);

    expect(code).toBe(0);
    expect(h.lines.join("\n")).toMatch(/nothing to reap/i);
  });

  it("emits a machine-readable summary with --json", async () => {
    const orphan = makeRun({ id: "dead", runRoot: "/tmp/pando-dead", pid: 99 });
    const h = harness([orphan, makeRun({ id: "alive", pid: 11 })], [11]);

    await runPandoGc(["--json"], h.deps);

    const payload = JSON.parse(h.lines.join("\n")) as {
      mode: string;
      reap: { id: string; reason: string }[];
    };
    expect(payload.mode).toBe("dry-run");
    expect(payload.reap).toEqual([
      { id: "dead", runRoot: "/tmp/pando-dead", pid: 99, reason: "orphaned" },
    ]);
  });

  it("prints usage on help", async () => {
    const h = harness([]);
    const code = await runPandoGc(["help"], h.deps);
    expect(code).toBe(0);
    expect(h.lines.join("\n")).toMatch(/pando gc/i);
  });
});
