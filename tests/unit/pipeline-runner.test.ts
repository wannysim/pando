import { describe, expect, it } from "vitest";
import type {
  Gate,
  GateContext,
  GateResult,
  RepoProfile,
  WorkerEngine,
  WorkerRunOptions,
  WorkerResult,
} from "../../src/core/types";
import { runPipeline } from "../../src/pipeline/runner";
import type { StageConfig } from "../../src/core/stage-config";

describe("runPipeline", () => {
  it("runs worker stages and gates through DONE on the happy path", async () => {
    const calls: string[] = [];
    const runner = await runPipeline({
      buildPrompt(stage) {
        return `prompt:${stage}`;
      },
      engines: {
        "claude-code": engine("claude-code", calls),
        codex: engine("codex", calls),
      },
      gates: {
        IMPL: [gate("impl-gate", () => ({ pass: true }))],
        PLAN: [gate("plan-gate", () => ({ pass: true }))],
        PR: [gate("pr-gate", () => ({ pass: true }))],
      },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(runner.final.status).toBe("DONE");
    expect(calls).toEqual([
      "claude-code:prompt:SPEC",
      "claude-code:prompt:PLAN",
      "codex:prompt:TEST",
      "codex:prompt:IMPL",
      "claude-code:prompt:REVIEW",
      "claude-code:prompt:PR",
    ]);
    expect(
      runner.events.filter(isLegacyEvent).map((event) => `${event.stage}:${event.type}`),
    ).toEqual([
      "SPEC:engine-pass",
      "SPEC:stage-pass",
      "PLAN:engine-pass",
      "PLAN:gate-pass",
      "PLAN:stage-pass",
      "TEST:engine-pass",
      "TEST:stage-pass",
      "IMPL:engine-pass",
      "IMPL:gate-pass",
      "IMPL:stage-pass",
      "REVIEW:engine-pass",
      "REVIEW:stage-pass",
      "PR:engine-pass",
      "PR:gate-pass",
      "PR:stage-pass",
    ]);
  });

  it("maps blocking PLAN gate failures to ESCALATED", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", []),
        codex: engine("codex", []),
      },
      gates: {
        PLAN: [
          gate("plan-artifact-schema", () => ({
            evidence: "base branch missing",
            failureKind: "blocking-questions",
            pass: false,
            reason: "PLAN.md has blocking open questions",
          })),
        ],
      },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("ESCALATED");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: "base branch missing",
          gateName: "plan-artifact-schema",
          reason: "PLAN.md has blocking open questions",
          stage: "PLAN",
          type: "gate-blocking",
        }),
      ]),
    );
  });

  it("maps blocking SPEC gate failures to ESCALATED before planning", async () => {
    const calls: string[] = [];

    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", calls),
        codex: engine("codex", calls),
      },
      gates: {
        SPEC: [
          gate("brief-intake-schema", () => ({
            evidence: "[Blocker] Need final copy",
            failureKind: "blocking-questions",
            pass: false,
            reason: "brief has blocking open questions",
          })),
        ],
      },
      item: {
        ...workItem(),
        payload: { briefPath: "briefs/demo/brief.md", kind: "brief" },
        source: "brief",
      },
      profile: { ...repoProfile(), intake: { sources: ["brief"] }, workItemSource: "brief" },
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("ESCALATED");
    expect(calls).toEqual(["claude-code:Run SPEC"]);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: "[Blocker] Need final copy",
          gateName: "brief-intake-schema",
          reason: "brief has blocking open questions",
          stage: "SPEC",
          type: "gate-blocking",
        }),
      ]),
    );
  });

  it("passes source-specific allowed tools to worker engines", async () => {
    const allowedTools: Array<readonly string[] | undefined> = [];

    await runPipeline({
      engines: {
        "claude-code": {
          name: "claude-code",
          async run(opts) {
            allowedTools.push(opts.allowedTools);
            return { ok: true, output: "ok" };
          },
        },
        codex: engine("codex", []),
      },
      initialState: { attemptsLeft: 3, status: "SPEC" },
      item: {
        ...workItem(),
        payload: { briefPath: "briefs/demo/brief.md", kind: "brief" },
        source: "brief",
      },
      profile: { ...repoProfile(), intake: { sources: ["brief"] }, workItemSource: "brief" },
      stageConfig: {
        ...stageConfig(),
        stages: {
          ...stageConfig().stages,
          spec: {
            engine: "claude-code",
            model: "sonnet",
            allowedToolsBySource: {
              brief: ["Read", "Glob", "Grep"],
              jira: ["Read", "Glob", "Grep", "mcp__claude_ai_Atlassian"],
            },
          },
        },
      },
      worktree: "/worktree",
    });

    expect(allowedTools[0]).toEqual(["Read", "Glob", "Grep"]);
  });

  it("keeps IMPL and REVIEW worker configs independently resolved", async () => {
    const calls: Array<{
      allowedTools?: string[];
      engine: string;
      env?: Record<string, string>;
      model: string;
      prompt: string;
    }> = [];
    const config: StageConfig = {
      ...stageConfig(),
      stages: {
        ...stageConfig().stages,
        impl: {
          allowedTools: ["Read", "Write", "Bash(pnpm test)"],
          engine: "codex",
          env: { IMPL_ONLY: "1" },
          model: "impl-model",
        },
        review: {
          allowedTools: ["Read", "Grep", "Bash(git diff *)"],
          engine: "claude-code",
          env: { REVIEW_ONLY: "1" },
          model: "review-model",
          skill: "reviewer",
        },
      },
    };

    const result = await runPipeline({
      buildPrompt(stage) {
        return `prompt:${stage}`;
      },
      engines: {
        "claude-code": recordingEngine("claude-code", calls),
        codex: recordingEngine("codex", calls),
      },
      env: { JOB_ENV: "shared" },
      initialState: { attemptsLeft: 3, status: "IMPL" },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: config,
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("DONE");
    expect(calls).toEqual([
      {
        allowedTools: ["Read", "Write", "Bash(pnpm test)"],
        engine: "codex",
        env: { IMPL_ONLY: "1", JOB_ENV: "shared" },
        model: "impl-model",
        prompt: "prompt:IMPL",
      },
      {
        allowedTools: ["Read", "Grep", "Bash(git diff *)"],
        engine: "claude-code",
        env: { JOB_ENV: "shared", REVIEW_ONLY: "1" },
        model: "review-model",
        prompt: "prompt:REVIEW",
      },
      {
        allowedTools: undefined,
        engine: "claude-code",
        env: { JOB_ENV: "shared" },
        model: "sonnet",
        prompt: "prompt:PR",
      },
    ]);
  });

  it("emits stage duration and worker cost telemetry from an injected clock", async () => {
    const result = await runPipeline({
      clock: sequenceClock([1_000, 1_375, 2_000, 2_250, 3_000, 3_050]),
      engines: {
        "claude-code": engine("claude-code", []),
        codex: {
          name: "codex",
          async run() {
            return { costUsd: 0.42, ok: true, output: "ok" };
          },
        },
      },
      initialState: { attemptsLeft: 3, status: "IMPL" },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: { engine: "codex", model: "gpt-5-codex" },
          stage: "IMPL",
          type: "stage-started",
        }),
        expect.objectContaining({
          payload: { costUsd: 0.42, engine: "codex", model: "gpt-5-codex" },
          stage: "IMPL",
          type: "worker-cost",
        }),
        expect.objectContaining({
          payload: { durationMs: 375, engine: "codex", model: "gpt-5-codex" },
          stage: "IMPL",
          type: "stage-completed",
        }),
      ]),
    );
  });

  it("emits structured failure telemetry for failed gates", async () => {
    const result = await runPipeline({
      clock: sequenceClock([10, 35]),
      engines: {
        "claude-code": engine("claude-code", []),
        codex: engine("codex", []),
      },
      gates: {
        IMPL: [
          gate("checksum", () => ({
            evidence: '{"changed":["src/example.test.ts"]}',
            pass: false,
            reason: "test checksum changed",
          })),
        ],
      },
      initialState: { attemptsLeft: 1, status: "IMPL" },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("FAILED");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: '{"changed":["src/example.test.ts"]}',
          gateName: "checksum",
          payload: expect.objectContaining({
            evidence: '{"changed":["src/example.test.ts"]}',
            failureKind: "gate-fail",
            gateName: "checksum",
            reason: "test checksum changed",
          }),
          reason: "test checksum changed",
          stage: "IMPL",
          type: "gate-fail",
        }),
        expect.objectContaining({
          evidence: '{"changed":["src/example.test.ts"]}',
          payload: expect.objectContaining({
            durationMs: 25,
            evidence: '{"changed":["src/example.test.ts"]}',
            failureKind: "gate-fail",
            gateName: "checksum",
            reason: "test checksum changed",
          }),
          reason: "test checksum changed",
          stage: "IMPL",
          type: "stage-failed",
        }),
      ]),
    );
  });

  it("persists deterministic evidence from passing gates", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", []),
        codex: engine("codex", []),
      },
      gates: {
        PR: [
          gate("types-exit-code", () => ({
            evidence: '{"command":"pnpm exec tsc --noEmit","exitCode":0}',
            pass: true,
          })),
        ],
      },
      initialState: { attemptsLeft: 1, status: "PR" },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("DONE");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: '{"command":"pnpm exec tsc --noEmit","exitCode":0}',
          gateName: "types-exit-code",
          stage: "PR",
          type: "gate-pass",
        }),
      ]),
    );
  });

  it("retries deterministic gate failures until the budget is exhausted", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", []),
        codex: engine("codex", []),
      },
      gates: {
        SPEC: [gate("spec-artifact-schema", () => ({ pass: false, reason: "missing" }))],
      },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: { ...stageConfig(), defaults: { retryBudget: 2, timeoutMinutes: 30 } },
      worktree: "/worktree",
    });

    expect(result.final).toEqual({ attemptsLeft: 0, status: "FAILED" });
    expect(result.events.filter((event) => event.type === "gate-fail")).toHaveLength(2);
  });

  it("resumes from a persisted stage without rerunning earlier stages", async () => {
    const calls: string[] = [];

    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", calls),
        codex: engine("codex", calls),
      },
      initialState: { attemptsLeft: 4, status: "IMPL" },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("DONE");
    expect(calls).toEqual(["codex:Run IMPL", "claude-code:Run REVIEW", "claude-code:Run PR"]);
  });

  it("emits state changes and pipeline events for persistence adapters", async () => {
    const transitions: string[] = [];
    const persistedEvents: string[] = [];

    await runPipeline({
      engines: {
        "claude-code": engine("claude-code", []),
        codex: engine("codex", []),
      },
      gates: {
        PLAN: [gate("plan-gate", () => ({ pass: true }))],
      },
      item: workItem(),
      onEvent(event) {
        persistedEvents.push(`${event.stage}:${event.type}`);
      },
      onStateChange(change) {
        transitions.push(`${change.previous.status}->${change.next.status}:${change.event}`);
      },
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(transitions).toEqual([
      "QUEUED->SPEC:START",
      "SPEC->PLAN:GATE_PASS",
      "PLAN->TEST:GATE_PASS",
      "TEST->IMPL:GATE_PASS",
      "IMPL->REVIEW:GATE_PASS",
      "REVIEW->PR:GATE_PASS",
      "PR->DONE:GATE_PASS",
    ]);
    expect(persistedEvents).toContain("PLAN:gate-pass");
    expect(persistedEvents.at(-1)).toBe("PR:stage-pass");
  });
});

function engine(name: WorkerEngine["name"], calls: string[]): WorkerEngine {
  return {
    name,
    async run(opts: WorkerRunOptions): Promise<WorkerResult> {
      calls.push(`${name}:${opts.prompt}`);
      return { ok: true, output: "ok" };
    },
  };
}

function recordingEngine(
  name: WorkerEngine["name"],
  calls: Array<{
    allowedTools?: string[];
    engine: string;
    env?: Record<string, string>;
    model: string;
    prompt: string;
  }>,
): WorkerEngine {
  return {
    name,
    async run(opts: WorkerRunOptions): Promise<WorkerResult> {
      calls.push({
        allowedTools: opts.allowedTools,
        engine: name,
        env: opts.env,
        model: opts.model,
        prompt: opts.prompt,
      });
      return { ok: true, output: "ok" };
    },
  };
}

function gate(name: string, check: (ctx: GateContext) => GateResult): Gate {
  return {
    name,
    async check(ctx) {
      return check(ctx);
    },
  };
}

function isLegacyEvent(event: { type: string }): boolean {
  return !["stage-started", "stage-completed", "stage-failed", "worker-cost"].includes(event.type);
}

function sequenceClock(values: readonly number[]) {
  let index = 0;
  return {
    nowMs() {
      return values[Math.min(index++, values.length - 1)] ?? 0;
    },
  };
}

function stageConfig(): StageConfig {
  return {
    defaults: { retryBudget: 10, timeoutMinutes: 30 },
    stages: {
      impl: { engine: "codex", model: "gpt-5-codex" },
      plan: { engine: "claude-code", model: "opus", skill: "implement-jira" },
      pr: { engine: "claude-code", model: "sonnet", skill: "create-pr" },
      review: { engine: "claude-code", model: "opus", skill: "verifier" },
      spec: { engine: "claude-code", model: "sonnet" },
      test: { engine: "codex", model: "gpt-5-codex", skill: "test-writer" },
    },
  };
}

function workItem() {
  return {
    id: "DEMO-1234",
    payload: { kind: "jira" as const, ticketKey: "DEMO-1234" },
    repo: "web",
    source: "jira" as const,
    title: "Example",
  };
}

function repoProfile(): RepoProfile {
  return {
    baseBranch: "develop",
    concurrency: 1,
    contextProviders: [],
    context: { policyRefs: [], providers: [] },
    conventions: "repo-local",
    gates: { test: "test" as const },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
    packageManager: "pnpm" as const,
    path: "/repo",
    portRange: [3000, 3099] as [number, number],
    scope: "external" as const,
    setup: "install" as const,
    intake: { sources: ["jira"] },
    workItemSource: "jira" as const,
  };
}
