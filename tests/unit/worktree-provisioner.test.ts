import { describe, expect, it } from "vitest";
import { createWorktreeProvisioner } from "../../src/daemon/worktree-provisioner.js";
import type { EnsureWorktreeOptions, EnsureWorktreeResult } from "../../src/worktree/manager.js";
import type { RepoProfile, WorkItem } from "../../src/core/types.js";

describe("createWorktreeProvisioner", () => {
  it("builds daemon-mode worktree options from the repo profile", async () => {
    const calls: EnsureWorktreeOptions[] = [];
    const provisioner = createWorktreeProvisioner({
      ensureWorktree: async (opts) => {
        calls.push(opts);
        return {
          branch: opts.branch,
          path: "/worktrees/web/feat-DEMO-4001",
          reused: false,
        };
      },
      worktreeRoot: "/worktrees",
    });

    const result = await provisioner.ensure({
      branch: "feat/DEMO-4001",
      item: workItem(),
      profile: repoProfile(),
    });

    expect(result).toEqual({
      branch: "feat/DEMO-4001",
      path: "/worktrees/web/feat-DEMO-4001",
      reused: false,
    });
    expect(calls).toEqual([
      {
        baseBranch: "develop",
        branch: "feat/DEMO-4001",
        envFiles: [".env.local"],
        repoPath: "/repo",
        setupCommand: "pnpm install",
        worktreeRoot: "/worktrees",
      },
    ]);
  });

  it("fails fast when the repo profile has no detected package manager", async () => {
    const provisioner = createWorktreeProvisioner({
      ensureWorktree: async (): Promise<EnsureWorktreeResult> => {
        throw new Error("should not reach worktree manager");
      },
      worktreeRoot: "/worktrees",
    });

    await expect(
      provisioner.ensure({
        branch: "feat/DEMO-4001",
        item: workItem(),
        profile: { ...repoProfile(), packageManager: undefined },
      }),
    ).rejects.toThrow(/package manager/i);
  });
});

function workItem(): WorkItem {
  return {
    id: "DEMO-4001",
    payload: { kind: "jira", ticketKey: "DEMO-4001" },
    repo: "web",
    source: "jira",
    title: "Example",
  };
}

function repoProfile(): RepoProfile {
  return {
    baseBranch: "develop",
    concurrency: 1,
    context: { policyRefs: [], providers: [] },
    contextProviders: [],
    conventions: "repo-local",
    envFiles: [".env.local"],
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
