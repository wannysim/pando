import { describe, expect, it } from "vitest";
import type {
  Gate,
  GateContext,
  GateResult,
  WorkerEngine,
  WorkerRunOptions,
  WorkerResult,
} from "../../src/core/types.js";
import { runPipeline } from "../../src/pipeline/runner.js";
import type { StageConfig } from "../../src/core/stage-config.js";

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
    ]);
    expect(runner.events.map((event) => `${event.stage}:${event.type}`)).toEqual([
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
    expect(result.events.at(-1)).toMatchObject({
      evidence: "base branch missing",
      gateName: "plan-artifact-schema",
      reason: "PLAN.md has blocking open questions",
      stage: "PLAN",
      type: "gate-blocking",
    });
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

function gate(name: string, check: (ctx: GateContext) => GateResult): Gate {
  return {
    name,
    async check(ctx) {
      return check(ctx);
    },
  };
}

function stageConfig(): StageConfig {
  return {
    defaults: { retryBudget: 10, timeoutMinutes: 30 },
    stages: {
      impl: { engine: "codex", model: "gpt-5-codex" },
      plan: { engine: "claude-code", model: "opus", skill: "implement-jira" },
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

function repoProfile() {
  return {
    baseBranch: "develop",
    concurrency: 1,
    contextProviders: [],
    conventions: "repo-local",
    gates: { test: "test" as const },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
    packageManager: "pnpm" as const,
    path: "/repo",
    portRange: [3000, 3099] as [number, number],
    scope: "external" as const,
    setup: "install" as const,
    workItemSource: "jira" as const,
  };
}
