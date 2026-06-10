import { describe, expect, it } from "vitest";
import type { GateContext } from "../../src/core/types";
import { createWorktreeChecksumGate } from "../../src/pipeline/gates/checksum";
import {
  createWorktreeDiffRulesGate,
  type CollectChangesPort,
} from "../../src/pipeline/gates/diff-rules";
import type { CollectChecksumsPort } from "../../src/pipeline/gates/checksum";

describe("createWorktreeDiffRulesGate", () => {
  it("collects changes from the worktree base ref and blocks protected-path edits", async () => {
    const calls: Array<{ worktree: string; baseRef: string }> = [];
    const collect: CollectChangesPort = async (worktree, baseRef) => {
      calls.push({ baseRef, worktree });
      return [
        { path: "src/button.ts", status: "modified" },
        { path: "config/repos.yaml", status: "modified" },
      ];
    };
    const gate = createWorktreeDiffRulesGate({
      collectChanges: collect,
      protectedPaths: ["config/repos.yaml"],
    });

    const result = await gate.check(context());

    expect(calls).toEqual([{ baseRef: "origin/develop", worktree: "/worktree" }]);
    expect(result.pass).toBe(false);
    expect(JSON.parse(result.evidence ?? "{}")).toEqual({
      protectedPathViolations: [
        { matchedPath: "config/repos.yaml", path: "config/repos.yaml", status: "modified" },
      ],
      testFileViolations: [],
    });
  });

  it("blocks IMPL test edits using the profile guard and live changes", async () => {
    const gate = createWorktreeDiffRulesGate({
      collectChanges: async () => [{ path: "tests/unit/button.test.ts", status: "modified" }],
    });

    const result = await gate.check(context());

    expect(result.pass).toBe(false);
    expect(result.reason).toBe("diff rules rejected IMPL changes");
  });

  it("can skip test-file violations when checksum gates enforce IMPL test immutability", async () => {
    const gate = createWorktreeDiffRulesGate({
      collectChanges: async () => [{ path: "tests/unit/button.test.ts", status: "modified" }],
      forbidTestEditInImpl: false,
    });

    await expect(gate.check(context())).resolves.toEqual({ pass: true });
  });

  it("passes when the live diff only touches implementation files", async () => {
    const gate = createWorktreeDiffRulesGate({
      collectChanges: async () => [{ path: "src/button.ts", status: "modified" }],
      protectedPaths: ["config/repos.yaml"],
    });

    await expect(gate.check(context())).resolves.toEqual({ pass: true });
  });
});

describe("createWorktreeChecksumGate", () => {
  it("compares the expected manifest against checksums collected from the worktree", async () => {
    const collect: CollectChecksumsPort = async (worktree, paths) => {
      expect(worktree).toBe("/worktree");
      expect(paths).toEqual(["tests/unit/button.test.ts"]);
      return [{ checksum: "after", path: "tests/unit/button.test.ts" }];
    };
    const gate = createWorktreeChecksumGate({
      collectChecksums: collect,
      expected: { entries: [{ checksum: "before", path: "tests/unit/button.test.ts" }] },
    });

    const result = await gate.check(context());

    expect(result.pass).toBe(false);
    expect(JSON.parse(result.evidence ?? "{}")).toEqual({
      changed: [
        {
          actualChecksum: "after",
          expectedChecksum: "before",
          path: "tests/unit/button.test.ts",
        },
      ],
      missing: [],
    });
  });

  it("passes when the worktree checksums match the recorded manifest", async () => {
    const gate = createWorktreeChecksumGate({
      collectChecksums: async () => [{ checksum: "same", path: "tests/unit/button.test.ts" }],
      expected: { entries: [{ checksum: "same", path: "tests/unit/button.test.ts" }] },
    });

    await expect(gate.check(context())).resolves.toEqual({ pass: true });
  });

  it("passes immediately without collecting when the expected manifest is empty", async () => {
    let called = false;
    const gate = createWorktreeChecksumGate({
      collectChecksums: async () => {
        called = true;
        return [];
      },
      expected: { entries: [] },
    });

    await expect(gate.check(context())).resolves.toEqual({ pass: true });
    expect(called).toBe(false);
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
