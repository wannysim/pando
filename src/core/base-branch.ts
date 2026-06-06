/**
 * Deterministic base-branch resolution (ADR-011).
 *
 * Precedence, highest first:
 *   1. WorkItem.baseBranch        — explicit per-item override
 *   2. Jira fixVersion → template — RepoProfile.releaseBranchTemplate render
 *   3. RepoProfile.baseBranch     — fixed profile default
 *
 * Pure: no I/O. The Jira fixVersion is mapped onto the WorkItem by the intake
 * adapter; this resolver only reads the already-normalized contract.
 */

import type { RepoProfile, WorkItem } from "./types";

export interface ResolveBaseBranchInput {
  item: WorkItem;
  profile: RepoProfile;
}

const FIX_VERSION_TOKEN = "{fixVersion}";

export function resolveBaseBranch(input: ResolveBaseBranchInput): string {
  const override = nonBlank(input.item.baseBranch);
  if (override !== undefined) return override;

  const releaseBranch = releaseBranchFromFixVersion(input);
  if (releaseBranch !== undefined) return releaseBranch;

  return input.profile.baseBranch;
}

function releaseBranchFromFixVersion(input: ResolveBaseBranchInput): string | undefined {
  if (input.item.payload.kind !== "jira") return undefined;

  const template = nonBlank(input.profile.releaseBranchTemplate);
  if (template === undefined) return undefined;

  const fixVersion = nonBlank(input.item.payload.fixVersion);
  if (fixVersion === undefined) return undefined;

  return template.replaceAll(FIX_VERSION_TOKEN, fixVersion);
}

function nonBlank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
