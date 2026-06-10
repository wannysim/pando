import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  branchSlug,
  ensureWorktree,
  pruneWorktrees,
  worktreePathFor,
} from "../../src/worktree/manager";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("worktree path helpers", () => {
  it("follows the worktree-dispatch path convention and branch slug rules", () => {
    expect(branchSlug("feat/DEMO-1234")).toBe("feat-DEMO-1234");
    expect(branchSlug("feat//DEMO-1234")).toBe("feat-DEMO-1234");
    expect(
      worktreePathFor({
        branch: "feat/DEMO-1234",
        repoPath: "/Users/me/Github/web",
        worktreeRoot: "/Users/me/.worktrees",
      }),
    ).toBe("/Users/me/.worktrees/web/feat-DEMO-1234");
  });
});

// Real-git integration: bare repo init + clone + worktree add can exceed the
// 5s default under parallel coverage load, so give this suite a wider timeout.
describe("ensureWorktree", { timeout: 30_000 }, () => {
  it("creates a daemon-mode worktree from the origin base without touching the source checkout", async () => {
    const repo = await createRepo();
    const beforeBranch = await git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const beforeHead = await git(repo.path, ["rev-parse", "HEAD"]);

    const result = await ensureWorktree({
      repoPath: repo.path,
      branch: "feat/DEMO-1234",
      baseBranch: "develop",
      worktreeRoot: repo.worktreeRoot,
      envFiles: [".env.local"],
    });

    expect(result).toEqual({
      branch: "feat/DEMO-1234",
      path: join(repo.worktreeRoot, basename(repo.path), "feat-DEMO-1234"),
      reused: false,
    });
    expect(await git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(beforeBranch);
    expect(await git(repo.path, ["rev-parse", "HEAD"])).toBe(beforeHead);
    expect(await git(repo.path, ["status", "--porcelain"])).toBe("");
    expect(await git(result.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("feat/DEMO-1234");
    expect(await git(result.path, ["rev-parse", "HEAD"])).toBe(beforeHead);
    await expect(readFile(join(result.path, ".env.local"), "utf8")).resolves.toBe("TOKEN=test\n");
  });

  it("reuses an existing worktree for the same branch slug", async () => {
    const repo = await createRepo();

    await ensureWorktree({
      repoPath: repo.path,
      branch: "feat/DEMO-1234",
      baseBranch: "develop",
      worktreeRoot: repo.worktreeRoot,
    });
    const reused = await ensureWorktree({
      repoPath: repo.path,
      branch: "feat/DEMO-1234",
      baseBranch: "develop",
      worktreeRoot: repo.worktreeRoot,
    });

    expect(reused.reused).toBe(true);
    expect(await git(reused.path, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("feat/DEMO-1234");
  });

  it("runs the setup command after creating a worktree and skips missing env files", async () => {
    const repo = await createRepo();

    const result = await ensureWorktree({
      repoPath: repo.path,
      branch: "feat/DEMO-1234",
      baseBranch: "develop",
      worktreeRoot: repo.worktreeRoot,
      envFiles: [".missing.env"],
      setupCommand: `"${process.execPath}" -e "require('node:fs').writeFileSync('setup-ran.txt','yes\\n')"`,
    });

    await expect(readFile(join(result.path, "setup-ran.txt"), "utf8")).resolves.toBe("yes\n");
  });

  it("fails on path collision when the existing worktree points to another branch", async () => {
    const repo = await createRepo();

    await ensureWorktree({
      repoPath: repo.path,
      branch: "feat/DEMO-1234",
      baseBranch: "develop",
      worktreeRoot: repo.worktreeRoot,
    });

    await expect(
      ensureWorktree({
        repoPath: repo.path,
        branch: "feat-DEMO/1234",
        baseBranch: "develop",
        worktreeRoot: repo.worktreeRoot,
      }),
    ).rejects.toThrow(/worktree path collision/i);
  });

  it("fails when the existing path is not a git worktree", async () => {
    const repo = await createRepo();
    await mkdir(
      worktreePathFor({
        repoPath: repo.path,
        branch: "feat/DEMO-1234",
        worktreeRoot: repo.worktreeRoot,
      }),
      { recursive: true },
    );

    await expect(
      ensureWorktree({
        repoPath: repo.path,
        branch: "feat/DEMO-1234",
        baseBranch: "develop",
        worktreeRoot: repo.worktreeRoot,
      }),
    ).rejects.toThrow(/not a git worktree/i);
  });

  it("fails with timeout when .git/.dispatch.lock cannot be acquired", async () => {
    const repo = await createRepo();
    await writeFile(join(repo.path, ".git", ".dispatch.lock"), "held\n");

    await expect(
      ensureWorktree({
        repoPath: repo.path,
        branch: "feat/DEMO-1234",
        baseBranch: "develop",
        worktreeRoot: repo.worktreeRoot,
        lockTimeoutMs: 20,
        lockRetryMs: 5,
      }),
    ).rejects.toThrow(/lock timeout/i);
  });
});

// ADR-012: gc reaps a run-root with `rm -rf`, which leaves the worktree
// registration dangling in the source repo. pruneWorktrees clears it.
describe("pruneWorktrees", { timeout: 30_000 }, () => {
  it("clears registrations whose worktree directory was deleted out from under git", async () => {
    const repo = await createRepo();
    const created = await ensureWorktree({
      repoPath: repo.path,
      branch: "feat/DEMO-1234",
      baseBranch: "develop",
      worktreeRoot: repo.worktreeRoot,
    });

    await rm(created.path, { recursive: true, force: true });
    expect(await git(repo.path, ["worktree", "list"])).toContain(created.path);

    await pruneWorktrees({ repoPath: repo.path });

    expect(await git(repo.path, ["worktree", "list"])).not.toContain(created.path);
  });

  it("is a safe no-op when there is nothing to prune", async () => {
    const repo = await createRepo();
    await expect(pruneWorktrees({ repoPath: repo.path })).resolves.toBeUndefined();
  });
});

async function createRepo(): Promise<{ path: string; worktreeRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "pando-worktree-"));
  roots.push(root);

  const origin = join(root, "origin.git");
  const seed = join(root, "seed");
  const repo = join(root, "repo");
  const worktreeRoot = join(root, "worktrees");

  await git(root, ["init", "--bare", origin]);
  await git(root, ["clone", origin, seed]);
  await git(seed, ["config", "user.email", "test@example.invalid"]);
  await git(seed, ["config", "user.name", "Pando Test"]);
  await git(seed, ["switch", "-c", "develop"]);
  await writeFile(join(seed, "README.md"), "seed\n");
  await writeFile(join(seed, "yarn.lock"), "# yarn lock\n");
  await writeFile(join(seed, ".env.local"), "TOKEN=test\n");
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "seed"]);
  await git(seed, ["push", "-u", "origin", "develop"]);
  await git(origin, ["symbolic-ref", "HEAD", "refs/heads/develop"]);
  await git(root, ["clone", origin, repo]);
  await mkdir(worktreeRoot, { recursive: true });

  return { path: repo, worktreeRoot };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
