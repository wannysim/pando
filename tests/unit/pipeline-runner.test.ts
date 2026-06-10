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
import { createPrDraftGate } from "../../src/pipeline/gates/pr-draft";
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

  it("rejects a non-draft PR at the PR stage via the pr-draft gate", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", []),
        codex: engine("codex", []),
      },
      gates: {
        PR: [
          createPrDraftGate({
            async readText() {
              return JSON.stringify({ isDraft: false, number: 42, url: "https://x/pull/42" });
            },
          }),
        ],
      },
      initialState: { attemptsLeft: 1, status: "PR" },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("FAILED");
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: JSON.stringify({ isDraft: false, number: 42, url: "https://x/pull/42" }),
          gateName: "pr-draft",
          reason: "PR was created as a non-draft",
          stage: "PR",
          type: "gate-fail",
        }),
      ]),
    );
  });

  it("advances a draft PR through the PR stage via the pr-draft gate", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", []),
        codex: engine("codex", []),
      },
      gates: {
        PR: [
          createPrDraftGate({
            async readText() {
              return JSON.stringify({ isDraft: true, number: 42, url: "https://x/pull/42" });
            },
          }),
        ],
      },
      initialState: { attemptsLeft: 1, status: "PR" },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("DONE");
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

  it("escalates a non-retryable auth engine failure without burning the retry budget", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": failingEngine("claude-code", { errorCode: "not_logged_in", exitCode: 1 }),
        codex: engine("codex", []),
      },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: { ...stageConfig(), defaults: { retryBudget: 3, timeoutMinutes: 30 } },
      worktree: "/worktree",
    });

    expect(result.final).toEqual({ attemptsLeft: 3, status: "ESCALATED" });
    const failed = result.events.find((event) => event.type === "engine-fail");
    expect(failed?.payload).toMatchObject({ providerKind: "auth" });
  });

  it("retries a transient engine failure with backoff until the budget is exhausted", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": failingEngine("claude-code", { exitCode: 1 }),
        codex: engine("codex", []),
      },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: { ...stageConfig(), defaults: { retryBudget: 2, timeoutMinutes: 30 } },
      worktree: "/worktree",
    });

    expect(result.final).toEqual({ attemptsLeft: 0, status: "FAILED" });
    const engineFails = result.events.filter((event) => event.type === "engine-fail");
    expect(engineFails).toHaveLength(2);
    expect(engineFails[0]?.payload).toMatchObject({ backoffMs: 2_000, providerKind: "transient" });
  });

  it("classifies a timed-out engine failure as a retryable timeout", async () => {
    const result = await runPipeline({
      engines: {
        "claude-code": failingEngine("claude-code", { exitCode: 1, timedOut: true }),
        codex: engine("codex", []),
      },
      item: workItem(),
      profile: repoProfile(),
      stageConfig: { ...stageConfig(), defaults: { retryBudget: 1, timeoutMinutes: 30 } },
      worktree: "/worktree",
    });

    expect(result.final.status).toBe("FAILED");
    const failed = result.events.find((event) => event.type === "engine-fail");
    expect(failed?.payload).toMatchObject({ providerKind: "timeout" });
  });

  it("stops cooperatively once shouldCancel turns true after a stage runs", async () => {
    const calls: string[] = [];
    const result = await runPipeline({
      engines: {
        "claude-code": engine("claude-code", calls),
        codex: engine("codex", calls),
      },
      gates: {
        PLAN: [gate("plan-gate", () => ({ pass: true }))],
        SPEC: [gate("spec-gate", () => ({ pass: true }))],
      },
      item: workItem(),
      profile: repoProfile(),
      shouldCancel: () => calls.length >= 1, // cancel as soon as SPEC has run
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(result.canceled).toBe(true);
    expect(result.final.status).toBe("SPEC");
    expect(calls).toEqual(["claude-code:Run SPEC"]);
  });

  it("treats a mid-stage abort as cancellation, not a stage failure", async () => {
    const controller = new AbortController();
    let receivedSignal = false;
    const result = await runPipeline({
      engines: {
        "claude-code": {
          name: "claude-code",
          async run(opts) {
            receivedSignal = opts.signal === controller.signal;
            controller.abort(); // simulate the worker being killed mid-stage
            return { exitCode: 1, ok: false, output: "aborted" };
          },
        },
        codex: engine("codex", []),
      },
      item: workItem(),
      profile: repoProfile(),
      signal: controller.signal,
      stageConfig: stageConfig(),
      worktree: "/worktree",
    });

    expect(receivedSignal).toBe(true);
    expect(result.canceled).toBe(true);
    expect(result.final.status).not.toBe("FAILED");
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

function failingEngine(
  name: WorkerEngine["name"],
  failure: { exitCode?: number; timedOut?: boolean; errorCode?: string },
): WorkerEngine {
  return {
    name,
    async run(): Promise<WorkerResult> {
      return { ok: false, output: "failed", ...failure };
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
