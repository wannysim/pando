import { exec, execFile } from "node:child_process";
import { copyFile, mkdir, open, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export interface EnsureWorktreeOptions {
  repoPath: string;
  branch: string;
  baseBranch: string;
  worktreeRoot: string;
  envFiles?: string[];
  setupCommand?: string;
  setupEnv?: Record<string, string>;
  lockTimeoutMs?: number;
  lockRetryMs?: number;
}

export interface EnsureWorktreeResult {
  path: string;
  branch: string;
  reused: boolean;
}

export interface WorktreePathOptions {
  repoPath: string;
  branch: string;
  worktreeRoot: string;
}

export interface RemoveWorktreeOptions {
  repoPath: string;
  worktreePath: string;
  force?: boolean;
}

export function branchSlug(branch: string): string {
  return branch.replaceAll("/", "-").replace(/-+/g, "-");
}

export function worktreePathFor(opts: WorktreePathOptions): string {
  return join(opts.worktreeRoot, basename(opts.repoPath), branchSlug(opts.branch));
}

export async function ensureWorktree(opts: EnsureWorktreeOptions): Promise<EnsureWorktreeResult> {
  const path = worktreePathFor(opts);
  const lockPath = join(await gitDir(opts.repoPath), ".dispatch.lock");

  return withFileLock(
    lockPath,
    {
      retryMs: opts.lockRetryMs ?? 100,
      timeoutMs: opts.lockTimeoutMs ?? 30_000,
    },
    async () => {
      await git(opts.repoPath, ["fetch", "origin", opts.baseBranch]);

      if (await pathExists(path)) {
        await assertWorktreeBranch(path, opts.branch);
        return { path, branch: opts.branch, reused: true };
      }

      await mkdir(dirname(path), { recursive: true });
      await git(opts.repoPath, [
        "worktree",
        "add",
        path,
        "-b",
        opts.branch,
        `origin/${opts.baseBranch}`,
      ]);
      await copyEnvFiles(opts.repoPath, path, opts.envFiles ?? []);

      if (opts.setupCommand !== undefined) {
        await execAsync(opts.setupCommand, {
          cwd: path,
          env: { ...process.env, ...opts.setupEnv },
        });
      }

      return { path, branch: opts.branch, reused: false };
    },
  );
}

export interface PruneWorktreesOptions {
  repoPath: string;
}

export async function pruneWorktrees(opts: PruneWorktreesOptions): Promise<void> {
  await git(opts.repoPath, ["worktree", "prune"]);
}

export async function removeWorktree(opts: RemoveWorktreeOptions): Promise<void> {
  const args = ["worktree", "remove"];
  if (opts.force ?? true) args.push("--force");
  args.push(opts.worktreePath);
  await git(opts.repoPath, args);
}

async function assertWorktreeBranch(path: string, expectedBranch: string): Promise<void> {
  let actualBranch: string;
  try {
    actualBranch = await git(path, ["rev-parse", "--abbrev-ref", "HEAD"]);
  } catch (error) {
    throw new Error(`worktree path exists but is not a git worktree: ${path}`, {
      cause: error,
    });
  }

  if (actualBranch !== expectedBranch) {
    throw new Error(
      `worktree path collision: ${path} is ${actualBranch}, expected ${expectedBranch}`,
    );
  }
}

async function copyEnvFiles(
  repoPath: string,
  worktreePath: string,
  envFiles: readonly string[],
): Promise<void> {
  for (const envFile of envFiles) {
    const source = join(repoPath, envFile);
    if (!(await pathExists(source))) continue;

    const target = join(worktreePath, envFile);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function gitDir(repoPath: string): Promise<string> {
  const rawGitDir = await git(repoPath, ["rev-parse", "--git-dir"]);
  return isAbsolute(rawGitDir) ? rawGitDir : resolve(repoPath, rawGitDir);
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], { cwd });
    return stdout.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed: ${detail}`, { cause: error });
  }
}

async function withFileLock<T>(
  lockPath: string,
  opts: { timeoutMs: number; retryMs: number },
  fn: () => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + opts.timeoutMs;
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  while (handle === undefined) {
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
    } catch (error) {
      if (!isErrno(error) || error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`lock timeout: ${lockPath}`);
      await delay(Math.max(1, Math.min(opts.retryMs, deadline - Date.now())));
    }
  }

  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lockPath).catch((error: unknown) => {
      if (!isErrno(error) || error.code !== "ENOENT") throw error;
    });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
