import type { Gate, GateContext, GateResult } from "../../core/types";
import { isTestFilePath, matchesPath, normalizeGitPath } from "./checksum";

export type DiffStatus = "added" | "modified" | "deleted" | "renamed";

export interface DiffChange {
  path: string;
  status: DiffStatus;
  previousPath?: string;
}

export interface DiffRulesInput {
  changes: readonly DiffChange[];
  forbidTestEditInImpl: boolean;
  protectedPaths: readonly string[];
}

export interface DiffRulesGateOptions {
  changes: readonly DiffChange[];
  protectedPaths?: readonly string[];
}

export type CollectChangesPort = (
  worktree: string,
  baseRef: string,
) => Promise<readonly DiffChange[]>;

export interface WorktreeDiffRulesGateOptions {
  collectChanges: CollectChangesPort;
  forbidTestEditInImpl?: boolean;
  protectedPaths?: readonly string[];
  baseRefFor?: (ctx: GateContext) => string;
}

export interface WorkspaceDescriptor {
  name: string;
  root: string;
}

export type WorkspaceScope =
  | { kind: "all"; workspaces: string[]; evidence: string[] }
  | { kind: "none"; workspaces: []; evidence: string[] }
  | { kind: "selected"; workspaces: string[]; evidence: string[] };

interface DiffRuleViolation {
  path: string;
  status: DiffStatus;
}

interface ProtectedPathViolation extends DiffRuleViolation {
  matchedPath: string;
}

interface DiffRulesEvidence {
  protectedPathViolations: ProtectedPathViolation[];
  testFileViolations: DiffRuleViolation[];
}

const ROOT_PACKAGE_METADATA = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "package-lock.json",
] as const;

export function createDiffRulesGate(opts: DiffRulesGateOptions): Gate {
  return {
    name: "diff-rules",
    async check(ctx) {
      return evaluateDiffRules({
        changes: opts.changes,
        forbidTestEditInImpl: ctx.profile.guards.forbidTestEditInImpl,
        protectedPaths: opts.protectedPaths ?? [],
      });
    },
  };
}

export function createWorktreeDiffRulesGate(opts: WorktreeDiffRulesGateOptions): Gate {
  const baseRefFor = opts.baseRefFor ?? defaultBaseRef;
  return {
    name: "diff-rules",
    async check(ctx) {
      const changes = await opts.collectChanges(ctx.worktree, baseRefFor(ctx));
      return evaluateDiffRules({
        changes,
        forbidTestEditInImpl: opts.forbidTestEditInImpl ?? ctx.profile.guards.forbidTestEditInImpl,
        protectedPaths: opts.protectedPaths ?? [],
      });
    },
  };
}

function defaultBaseRef(ctx: GateContext): string {
  return `origin/${ctx.profile.baseBranch}`;
}

export function evaluateDiffRules(input: DiffRulesInput): GateResult {
  const evidence = diffRulesEvidence(input);
  if (evidence.protectedPathViolations.length === 0 && evidence.testFileViolations.length === 0) {
    return { pass: true };
  }

  return {
    evidence: JSON.stringify(evidence, null, 2),
    pass: false,
    reason: "diff rules rejected IMPL changes",
  };
}

export function resolveWorkspaceScope(
  changes: readonly DiffChange[],
  workspaces: readonly WorkspaceDescriptor[],
): WorkspaceScope {
  const sortedWorkspaces = workspaces
    .map((workspace) => ({ name: workspace.name, root: normalizeWorkspaceRoot(workspace.root) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const normalizedChanges = changes
    .map((change) => ({ ...change, path: normalizeGitPath(change.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const rootMetadataChange = normalizedChanges.find((change) =>
    ROOT_PACKAGE_METADATA.includes(change.path as (typeof ROOT_PACKAGE_METADATA)[number]),
  );

  if (rootMetadataChange !== undefined) {
    return {
      evidence: [`${rootMetadataChange.path} changed root package metadata`],
      kind: "all",
      workspaces: sortedWorkspaces.map((workspace) => workspace.name),
    };
  }

  const selected = new Set<string>();
  const evidence: string[] = [];

  for (const change of normalizedChanges) {
    const workspace = sortedWorkspaces.find(
      (candidate) => change.path === candidate.root || change.path.startsWith(`${candidate.root}/`),
    );

    if (workspace === undefined) continue;
    selected.add(workspace.name);
    evidence.push(`${change.path} -> ${workspace.name}`);
  }

  if (selected.size === 0) return { evidence, kind: "none", workspaces: [] };

  return {
    evidence,
    kind: "selected",
    workspaces: [...selected].sort((left, right) => left.localeCompare(right)),
  };
}

function diffRulesEvidence(input: DiffRulesInput): DiffRulesEvidence {
  const changes = input.changes
    .map((change) => ({ ...change, path: normalizeGitPath(change.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    protectedPathViolations: protectedPathViolations(changes, input.protectedPaths),
    testFileViolations: input.forbidTestEditInImpl ? testFileViolations(changes) : [],
  };
}

function testFileViolations(changes: readonly DiffChange[]): DiffRuleViolation[] {
  return changes
    .filter((change) => isTestFilePath(change.path) || isPreviousTestFilePath(change))
    .map((change) => ({ path: change.path, status: change.status }));
}

function protectedPathViolations(
  changes: readonly DiffChange[],
  protectedPaths: readonly string[],
): ProtectedPathViolation[] {
  const violations: ProtectedPathViolation[] = [];

  for (const change of changes) {
    for (const protectedPath of protectedPaths) {
      if (!matchesPath(change.path, protectedPath)) continue;
      violations.push({
        matchedPath: normalizeGitPath(protectedPath),
        path: change.path,
        status: change.status,
      });
    }
  }

  return violations;
}

function isPreviousTestFilePath(change: DiffChange): boolean {
  return change.previousPath === undefined ? false : isTestFilePath(change.previousPath);
}

function normalizeWorkspaceRoot(root: string): string {
  return normalizeGitPath(root).replace(/\/$/, "");
}
