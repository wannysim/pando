import { describe, expect, it } from "vitest";
import type { RepoProfile, WorkerEngine, WorkerResult } from "../../src/core/types";
import type { StageConfig } from "../../src/core/stage-config";
import { runDaemonOnce } from "../../src/daemon/loop";
import { createSqliteJobStore } from "../../src/db/index";
import { createSpecArtifactGate } from "../../src/pipeline/gates/artifact-schema";

describe("null-agent safety gates", () => {
  it("fails a submitted no-op job at an artifact gate with structured evidence", async () => {
    const store = createSqliteJobStore({ path: ":memory:" });
    store.enqueueJob({
      item: {
        id: "DEMO-NULL-1",
        payload: { kind: "jira", ticketKey: "DEMO-NULL-1" },
        repo: "web",
        source: "jira",
        title: "No-op agent should not pass gates",
      },
      retryBudget: 1,
    });

    const result = await runDaemonOnce({
      engines: {
        "claude-code": nullEngine("claude-code"),
        codex: nullEngine("codex"),
      },
      gates: {
        SPEC: [
          createSpecArtifactGate({
            async readText() {
              return undefined;
            },
          }),
        ],
      },
      profiles: { web: repoProfile() },
      stageConfig: stageConfig(),
      store,
      worktrees: {
        async ensure(input) {
          return { branch: input.branch, path: "/worktrees/web/feat-DEMO-NULL-1" };
        },
      },
    });

    expect(result).toEqual({
      finalStatus: "FAILED",
      jobId: "DEMO-NULL-1",
      status: "ran",
    });
    expect(store.getJob("DEMO-NULL-1")).toMatchObject({
      attemptsLeft: 0,
      status: "FAILED",
      worktreePath: "/worktrees/web/feat-DEMO-NULL-1",
    });
    expect(store.listEvents("DEMO-NULL-1")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: "/worktrees/web/feat-DEMO-NULL-1/_spec.md",
          gateName: "spec-artifact-schema",
          reason: "_spec.md not found",
          stage: "SPEC",
          type: "gate-fail",
        }),
      ]),
    );

    store.close();
  });
});

function nullEngine(name: WorkerEngine["name"]): WorkerEngine {
  return {
    name,
    async run(): Promise<WorkerResult> {
      return { ok: true, output: "" };
    },
  };
}

function repoProfile(): RepoProfile {
  return {
    baseBranch: "develop",
    concurrency: 1,
    context: { policyRefs: [], providers: [] },
    contextProviders: [],
    conventions: "repo-local",
    gates: { test: "test" },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
    packageManager: "pnpm",
    path: "/repo",
    portRange: [3000, 3099],
    scope: "external",
    setup: "install",
    intake: { sources: ["jira"] },
    workItemSource: "jira",
  };
}

function stageConfig(): StageConfig {
  return {
    defaults: { retryBudget: 1, timeoutMinutes: 30 },
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
