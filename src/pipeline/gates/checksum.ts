import type { Gate, GateResult } from "../../core/types";

export interface ChecksumFile {
  path: string;
  checksum: string;
}

export interface ChecksumEntry {
  path: string;
  checksum: string;
}

export interface ChecksumManifest {
  entries: ChecksumEntry[];
}

export interface ChecksumManifestOptions {
  criticalPaths?: readonly string[];
}

interface ChecksumMismatchEvidence {
  changed: Array<{
    path: string;
    expectedChecksum: string;
    actualChecksum: string;
  }>;
  missing: Array<{
    path: string;
    expectedChecksum: string;
  }>;
}

export function createChecksumManifest(
  files: readonly ChecksumFile[],
  opts: ChecksumManifestOptions = {},
): ChecksumManifest {
  const entries = files
    .map((file) => ({ checksum: file.checksum, path: normalizeGitPath(file.path) }))
    .filter(
      (file) => isTestFilePath(file.path) || matchesAnyPath(file.path, opts.criticalPaths ?? []),
    )
    .sort((left, right) => left.path.localeCompare(right.path));

  return { entries };
}

export function createChecksumGate(expected: ChecksumManifest, actual: ChecksumManifest): Gate {
  return {
    name: "checksum",
    async check() {
      return evaluateChecksumManifest(expected, actual);
    },
  };
}

export type CollectChecksumsPort = (
  worktree: string,
  paths: readonly string[],
) => Promise<readonly ChecksumFile[]>;

export interface WorktreeChecksumGateOptions {
  expected: ChecksumManifest;
  collectChecksums: CollectChecksumsPort;
}

export function createWorktreeChecksumGate(opts: WorktreeChecksumGateOptions): Gate {
  return {
    name: "checksum",
    async check(ctx) {
      if (opts.expected.entries.length === 0) return { pass: true };
      const files = await opts.collectChecksums(
        ctx.worktree,
        opts.expected.entries.map((entry) => entry.path),
      );
      const actual: ChecksumManifest = {
        entries: files.map((file) => ({ checksum: file.checksum, path: file.path })),
      };
      return evaluateChecksumManifest(opts.expected, actual);
    },
  };
}

export function evaluateChecksumManifest(
  expected: ChecksumManifest,
  actual: ChecksumManifest,
): GateResult {
  const evidence = checksumMismatchEvidence(expected, actual);
  if (evidence.changed.length === 0 && evidence.missing.length === 0) return { pass: true };

  return {
    evidence: JSON.stringify(evidence, null, 2),
    pass: false,
    reason: "checksum manifest changed",
  };
}

export function isTestFilePath(path: string): boolean {
  const normalized = normalizeGitPath(path);
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? normalized;

  return (
    segments.includes("__tests__") ||
    normalized.startsWith("tests/") ||
    fileName.includes(".test.") ||
    fileName.includes(".spec.")
  );
}

export function normalizeGitPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
}

export function matchesPath(path: string, protectedPath: string): boolean {
  const normalizedPath = normalizeGitPath(path);
  const normalizedProtectedPath = normalizeGitPath(protectedPath);

  if (normalizedProtectedPath.endsWith("/")) {
    return normalizedPath.startsWith(normalizedProtectedPath);
  }

  return normalizedPath === normalizedProtectedPath;
}

function matchesAnyPath(path: string, protectedPaths: readonly string[]): boolean {
  return protectedPaths.some((protectedPath) => matchesPath(path, protectedPath));
}

function checksumMismatchEvidence(
  expected: ChecksumManifest,
  actual: ChecksumManifest,
): ChecksumMismatchEvidence {
  const actualByPath = new Map(actual.entries.map((entry) => [entry.path, entry.checksum]));
  const changed: ChecksumMismatchEvidence["changed"] = [];
  const missing: ChecksumMismatchEvidence["missing"] = [];

  for (const expectedEntry of expected.entries) {
    const actualChecksum = actualByPath.get(expectedEntry.path);

    if (actualChecksum === undefined) {
      missing.push({
        expectedChecksum: expectedEntry.checksum,
        path: expectedEntry.path,
      });
      continue;
    }

    if (actualChecksum !== expectedEntry.checksum) {
      changed.push({
        actualChecksum,
        expectedChecksum: expectedEntry.checksum,
        path: expectedEntry.path,
      });
    }
  }

  return { changed, missing };
}
