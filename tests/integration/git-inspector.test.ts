import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectChangedFiles,
  collectFileChecksums,
  collectWorktreeDiff,
} from "../../src/git/inspector";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("collectChangedFiles", () => {
  it("reports added, modified, deleted, and renamed files against a base ref as DiffChange entries", async () => {
    const repo = await createRepo();

    await writeFile(join(repo, "src/added.ts"), "export const added = 1;\n");
    await writeFile(join(repo, "src/keep.ts"), "export const keep = 2;\n");
    await rm(join(repo, "src/remove.ts"));
    await git(repo, ["mv", "src/move-from.ts", "src/move-to.ts"]);
    await git(repo, ["add", "-A"]);

    const changes = await collectChangedFiles(repo, "develop");

    expect(changes).toEqual([
      { path: "src/added.ts", status: "added" },
      { path: "src/keep.ts", status: "modified" },
      { path: "src/move-to.ts", previousPath: "src/move-from.ts", status: "renamed" },
      { path: "src/remove.ts", status: "deleted" },
    ]);
  });

  it("includes untracked files as added so IMPL gates see uncommitted worker output", async () => {
    const repo = await createRepo();
    await writeFile(join(repo, "untracked.ts"), "export const untracked = 3;\n");

    const changes = await collectChangedFiles(repo, "develop");

    expect(changes).toContainEqual({ path: "untracked.ts", status: "added" });
  });

  it("returns no changes for a clean worktree", async () => {
    const repo = await createRepo();
    await expect(collectChangedFiles(repo, "develop")).resolves.toEqual([]);
  });

  it("wraps git failures with the failing command for non-repository directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-git-inspector-bare-"));
    roots.push(root);

    await expect(collectChangedFiles(root, "develop")).rejects.toThrow(/git diff .* failed/i);
  });
});

describe("collectFileChecksums", () => {
  it("hashes existing files and skips missing ones deterministically", async () => {
    const repo = await createRepo();
    await writeFile(join(repo, "src/keep.ts"), "export const keep = 2;\n");

    const checksums = await collectFileChecksums(repo, [
      "src/keep.ts",
      "src/move-from.ts",
      "does-not-exist.ts",
    ]);

    expect(checksums.map((entry) => entry.path)).toEqual(["src/keep.ts", "src/move-from.ts"]);
    for (const entry of checksums) {
      expect(entry.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
    // Same content yields a stable checksum.
    const again = await collectFileChecksums(repo, ["src/keep.ts"]);
    expect(again[0]?.checksum).toBe(checksums[0]?.checksum);
  });

  it("rethrows non-ENOENT read errors such as reading a directory", async () => {
    const repo = await createRepo();
    await expect(collectFileChecksums(repo, ["src"])).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("collectWorktreeDiff", () => {
  it("returns a unified diff that includes uncommitted and untracked changes", async () => {
    const repo = await createRepo();
    await writeFile(join(repo, "src/keep.ts"), "export const keep = 2;\n");
    await writeFile(join(repo, "fresh.ts"), "export const fresh = 9;\n");

    const diff = await collectWorktreeDiff(repo, "develop");

    expect(diff).toContain("src/keep.ts");
    expect(diff).toContain("fresh.ts");
    expect(diff).toContain("+export const keep = 2;");
  });

  it("returns an empty string for a clean worktree", async () => {
    const repo = await createRepo();
    await expect(collectWorktreeDiff(repo, "develop")).resolves.toBe("");
  });
});

async function createRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "pando-git-inspector-"));
  roots.push(repo);

  await git(repo, ["init", "-b", "develop"]);
  await git(repo, ["config", "user.email", "test@example.invalid"]);
  await git(repo, ["config", "user.name", "Pando Test"]);
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src/keep.ts"), "export const keep = 1;\n");
  await writeFile(join(repo, "src/remove.ts"), "export const remove = 1;\n");
  await writeFile(join(repo, "src/move-from.ts"), "export const move = 1;\n");
  await git(repo, ["add", "-A"]);
  await git(repo, ["commit", "-m", "seed"]);

  return repo;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
