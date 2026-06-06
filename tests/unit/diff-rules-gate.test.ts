import { describe, expect, it } from "vitest";
import type { GateContext } from "../../src/core/types";
import {
  createDiffRulesGate,
  evaluateDiffRules,
  resolveWorkspaceScope,
} from "../../src/pipeline/gates/diff-rules";

describe("diff rules safety gate", () => {
  it("blocks IMPL test file modifications when test edits are forbidden", () => {
    const result = evaluateDiffRules({
      changes: [{ path: "tests/unit/button.test.ts", status: "modified" }],
      forbidTestEditInImpl: true,
      protectedPaths: [],
    });

    expect(result.pass).toBe(false);
    expect(result.reason).toBe("diff rules rejected IMPL changes");
    expect(JSON.parse(result.evidence ?? "{}")).toEqual({
      protectedPathViolations: [],
      testFileViolations: [{ path: "tests/unit/button.test.ts", status: "modified" }],
    });
  });

  it("blocks IMPL test file deletions through the gate wrapper", async () => {
    const gate = createDiffRulesGate({
      changes: [{ path: "src/button.test.ts", status: "deleted" }],
      protectedPaths: [],
    });

    await expect(gate.check(context())).resolves.toEqual({
      evidence: JSON.stringify(
        {
          protectedPathViolations: [],
          testFileViolations: [{ path: "src/button.test.ts", status: "deleted" }],
        },
        null,
        2,
      ),
      pass: false,
      reason: "diff rules rejected IMPL changes",
    });
  });

  it("blocks protected path changes", () => {
    const result = evaluateDiffRules({
      changes: [
        { path: "src/button.ts", status: "modified" },
        { path: "config/repos.yaml", status: "modified" },
        { path: "prompts/impl-from-plan.md", status: "modified" },
      ],
      forbidTestEditInImpl: true,
      protectedPaths: ["config/repos.yaml", "prompts/"],
    });

    expect(result.pass).toBe(false);
    expect(JSON.parse(result.evidence ?? "{}")).toEqual({
      protectedPathViolations: [
        { matchedPath: "config/repos.yaml", path: "config/repos.yaml", status: "modified" },
        { matchedPath: "prompts/", path: "prompts/impl-from-plan.md", status: "modified" },
      ],
      testFileViolations: [],
    });
  });

  it("allows implementation-only changes when no deterministic rule is violated", () => {
    expect(
      evaluateDiffRules({
        changes: [{ path: "src/button.ts", status: "modified" }],
        forbidTestEditInImpl: true,
        protectedPaths: ["config/repos.yaml"],
      }),
    ).toEqual({ pass: true });
  });
});

describe("resolveWorkspaceScope", () => {
  it("selects changed workspaces from deterministic path prefixes", () => {
    expect(
      resolveWorkspaceScope(
        [
          { path: "packages/ui/src/button.ts", status: "modified" },
          { path: "apps/dashboard/package.json", status: "modified" },
        ],
        [
          { name: "@pando/ui", root: "packages/ui" },
          { name: "dashboard", root: "apps/dashboard" },
        ],
      ),
    ).toEqual({
      evidence: [
        "apps/dashboard/package.json -> dashboard",
        "packages/ui/src/button.ts -> @pando/ui",
      ],
      kind: "selected",
      workspaces: ["@pando/ui", "dashboard"],
    });
  });

  it("falls back to all workspaces for root package metadata changes", () => {
    expect(
      resolveWorkspaceScope(
        [{ path: "pnpm-lock.yaml", status: "modified" }],
        [{ name: "@pando/ui", root: "packages/ui" }],
      ),
    ).toEqual({
      evidence: ["pnpm-lock.yaml changed root package metadata"],
      kind: "all",
      workspaces: ["@pando/ui"],
    });
  });
});

function context(): GateContext {
  return {
    item: {
      id: "DEMO-1234",
      payload: { kind: "jira", ticketKey: "DEMO-1234" },
      repo: "web",
      source: "jira",
      title: "Example",
    },
    profile: {
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
    },
    worktree: "/worktree",
  };
}
