import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { createDraftPrAutomationGate } from "../../src/pipeline/gates/draft-pr";
import type { GateCommandRunner } from "../../src/pipeline/gates/exit-code";
import type { GateContext } from "../../src/core/types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("createDraftPrAutomationGate", () => {
  it("commits, pushes, creates a draft PR, and writes pr.json deterministically", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-draft-pr-gate-"));
    roots.push(root);
    const calls: string[] = [];
    let viewCalls = 0;
    const runner: GateCommandRunner = async (command) => {
      calls.push(command);
      if (command === "git rev-parse --verify 'origin/develop^{commit}'") {
        return { exitCode: 0, stderr: "", stdout: "base-sha\n" };
      }
      if (command === "git merge-base HEAD 'origin/develop'") {
        return { exitCode: 0, stderr: "", stdout: "base-sha\n" };
      }
      if (command === "git diff --cached --quiet") {
        return { exitCode: 1, stderr: "", stdout: "" };
      }
      if (command === "git rev-parse --abbrev-ref HEAD") {
        return { exitCode: 0, stderr: "", stdout: "feat/demo\n" };
      }
      if (command === "gh pr view --json isDraft,number,url") {
        viewCalls += 1;
        if (viewCalls === 1) return { exitCode: 1, stderr: "no pull requests found\n", stdout: "" };
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ isDraft: true, number: 42, url: "https://x/pull/42" }),
        };
      }
      return { exitCode: 0, stderr: "", stdout: "" };
    };

    const result = await createDraftPrAutomationGate({
      files: {
        async writeText(path, text) {
          await writeFile(path, text, "utf8");
        },
      },
      runner,
    }).check(context(root));

    expect(result.pass).toBe(true);
    expect(calls).toEqual([
      "git fetch origin 'develop'",
      "git rev-parse --verify 'origin/develop^{commit}'",
      "git merge-base HEAD 'origin/develop'",
      "git add -A",
      "git diff --cached --quiet",
      "git commit -m 'chore: Demo task'",
      "git push -u origin HEAD",
      "gh pr view --json isDraft,number,url",
      "git rev-parse --abbrev-ref HEAD",
      "gh pr create --draft --base 'develop' --head 'feat/demo' --title 'Demo task' --body 'Automated pando result for DEMO-1234.'",
      "gh pr view --json isDraft,number,url",
    ]);
    await expect(readFile(join(root, "pr.json"), "utf8")).resolves.toBe(
      `${JSON.stringify({ isDraft: true, number: 42, url: "https://x/pull/42" })}\n`,
    );
  });

  it("skips commit on a clean retry and reuses the existing draft PR", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-draft-pr-gate-"));
    roots.push(root);
    const calls: string[] = [];
    const runner: GateCommandRunner = async (command) => {
      calls.push(command);
      if (command === "git rev-parse --verify 'origin/develop^{commit}'") {
        return { exitCode: 0, stderr: "", stdout: "base-sha\n" };
      }
      if (command === "git merge-base HEAD 'origin/develop'") {
        return { exitCode: 0, stderr: "", stdout: "base-sha\n" };
      }
      if (command === "git diff --cached --quiet") {
        return { exitCode: 0, stderr: "", stdout: "" };
      }
      if (command === "gh pr view --json isDraft,number,url") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ isDraft: true, number: 42, url: "https://x/pull/42" }),
        };
      }
      return { exitCode: 0, stderr: "", stdout: "" };
    };

    const result = await createDraftPrAutomationGate({
      files: {
        async writeText(path, text) {
          await writeFile(path, text, "utf8");
        },
      },
      runner,
    }).check(context(root));

    expect(result.pass).toBe(true);
    expect(calls).toEqual([
      "git fetch origin 'develop'",
      "git rev-parse --verify 'origin/develop^{commit}'",
      "git merge-base HEAD 'origin/develop'",
      "git add -A",
      "git diff --cached --quiet",
      "git push -u origin HEAD",
      "gh pr view --json isDraft,number,url",
    ]);
  });

  it("fails without retrying when the remote base has moved since the worktree forked", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-draft-pr-gate-"));
    roots.push(root);
    const calls: string[] = [];
    const runner: GateCommandRunner = async (command) => {
      calls.push(command);
      if (command === "git rev-parse --verify 'origin/develop^{commit}'") {
        return { exitCode: 0, stderr: "", stdout: "new-base\n" };
      }
      if (command === "git merge-base HEAD 'origin/develop'") {
        return { exitCode: 0, stderr: "", stdout: "old-base\n" };
      }
      return { exitCode: 0, stderr: "", stdout: "" };
    };

    const result = await createDraftPrAutomationGate({
      files: {
        async writeText(path, text) {
          await writeFile(path, text, "utf8");
        },
      },
      runner,
    }).check(context(root));

    expect(result).toEqual({
      evidence: JSON.stringify(
        {
          baseBranch: "develop",
          currentBaseSha: "new-base",
          forkBaseSha: "old-base",
        },
        null,
        2,
      ),
      failureKind: "non-retryable",
      pass: false,
      reason: "base branch drifted before PR creation",
    });
    expect(calls).toEqual([
      "git fetch origin 'develop'",
      "git rev-parse --verify 'origin/develop^{commit}'",
      "git merge-base HEAD 'origin/develop'",
    ]);
  });

  it("fails with command output when a git or gh command fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-draft-pr-gate-"));
    roots.push(root);
    const runner: GateCommandRunner = async (command) =>
      command === "git fetch origin 'develop'"
        ? { exitCode: 1, stderr: "nothing to commit\n", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: "" };

    await expect(
      createDraftPrAutomationGate({
        files: {
          async writeText(path, text) {
            await writeFile(path, text, "utf8");
          },
        },
        runner,
      }).check(context(root)),
    ).resolves.toEqual({
      evidence: "nothing to commit\n",
      pass: false,
      reason: "draft-pr-create command failed: git fetch",
    });
  });
});

function context(worktree: string): GateContext {
  return {
    item: {
      id: "DEMO-1234",
      payload: { kind: "brief", briefPath: "/brief.md" },
      repo: "pando",
      source: "brief",
      title: "Demo task",
    },
    profile: {
      baseBranch: "develop",
      concurrency: 1,
      context: { policyRefs: [], providers: [] },
      contextProviders: [],
      conventions: "repo-local",
      gates: { test: "test" },
      guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
      intake: { sources: ["brief"] },
      packageManager: "pnpm",
      path: "/repo",
      portRange: [3300, 3399],
      scope: "external",
      setup: "install",
      workItemSource: "brief",
    },
    worktree,
  };
}
