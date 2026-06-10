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
    const runner: GateCommandRunner = async (command) => {
      calls.push(command);
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
      "git add -A",
      "git commit -m 'chore: Demo task'",
      "git push -u origin HEAD",
      "gh pr create --draft --base 'develop' --title 'Demo task' --body 'Automated pando result for DEMO-1234.'",
      "gh pr view --json isDraft,number,url",
    ]);
    await expect(readFile(join(root, "pr.json"), "utf8")).resolves.toBe(
      `${JSON.stringify({ isDraft: true, number: 42, url: "https://x/pull/42" })}\n`,
    );
  });

  it("fails with command output when a git or gh command fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-draft-pr-gate-"));
    roots.push(root);
    const runner: GateCommandRunner = async (command) =>
      command.startsWith("git commit")
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
      reason: "draft-pr-create command failed: git commit",
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
