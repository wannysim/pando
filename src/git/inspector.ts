import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ChecksumFile } from "../pipeline/gates/checksum";
import type { DiffChange, DiffStatus } from "../pipeline/gates/diff-rules";

const execFileAsync = promisify(execFile);

const STATUS_BY_CODE: Record<string, DiffStatus> = {
  A: "added",
  C: "added",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "modified",
};

export async function collectChangedFiles(
  worktree: string,
  baseRef: string,
): Promise<DiffChange[]> {
  const tracked = parseNameStatus(
    await git(worktree, ["diff", "--name-status", "-M", "--no-color", baseRef]),
  );
  const untracked = await collectUntrackedFiles(worktree);
  const byPath = new Map<string, DiffChange>();

  for (const change of [...tracked, ...untracked]) byPath.set(change.path, change);

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export async function collectFileChecksums(
  worktree: string,
  paths: readonly string[],
): Promise<ChecksumFile[]> {
  const checksums: ChecksumFile[] = [];

  for (const path of paths) {
    const content = await readFileOrUndefined(join(worktree, path));
    if (content === undefined) continue;
    checksums.push({ checksum: sha256(content), path });
  }

  return checksums;
}

export async function collectWorktreeDiff(worktree: string, baseRef: string): Promise<string> {
  const tracked = await git(worktree, ["diff", "--no-color", baseRef]);
  const untracked = await collectUntrackedFiles(worktree);
  const untrackedDiffs = await Promise.all(
    untracked.map((change) =>
      git(worktree, ["diff", "--no-color", "--no-index", NULL_DEVICE, change.path]),
    ),
  );

  return [tracked, ...untrackedDiffs].filter((part) => part.length > 0).join("\n");
}

function parseNameStatus(output: string): DiffChange[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(parseNameStatusLine)
    .filter((change): change is DiffChange => change !== undefined);
}

function parseNameStatusLine(line: string): DiffChange | undefined {
  const fields = line.split("\t");
  const code = fields[0]?.[0];
  if (code === undefined) return undefined;
  const status = STATUS_BY_CODE[code];
  if (status === undefined) return undefined;

  if (status === "renamed") {
    const previousPath = fields[1];
    const path = fields[2];
    if (previousPath === undefined || path === undefined) return undefined;
    return { path, previousPath, status };
  }

  const path = fields[1];
  if (path === undefined) return undefined;
  return { path, status };
}

async function collectUntrackedFiles(worktree: string): Promise<DiffChange[]> {
  const output = await git(worktree, ["ls-files", "--others", "--exclude-standard", "-z"]);

  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .map((path) => ({ path, status: "added" as const }));
}

async function readFileOrUndefined(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout.replace(/\n$/, "");
  } catch (error) {
    if (isDiffNoIndexExit(error)) {
      const failure = error as { stdout?: string };
      return (failure.stdout ?? "").replace(/\n$/, "");
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`git ${args.join(" ")} failed: ${detail}`, { cause: error });
  }
}

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

function isDiffNoIndexExit(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 1
  );
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
