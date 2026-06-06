import { resolveBaseBranch } from "../core/base-branch";
import { packageCommand } from "../core/config";
import type { RepoProfile } from "../core/types";
import { createWorktreeIsolation } from "./worktree-isolation";
import {
  ensureWorktree as defaultEnsureWorktree,
  type EnsureWorktreeOptions,
  type EnsureWorktreeResult,
} from "../worktree/manager";
import type { WorktreeProvisioner, WorktreeProvisionInput, WorktreeProvisionResult } from "./loop";

export interface WorktreeProvisionerOptions {
  worktreeRoot: string;
  ensureWorktree?: EnsureWorktreePort;
}

export type EnsureWorktreePort = (opts: EnsureWorktreeOptions) => Promise<EnsureWorktreeResult>;

export function createWorktreeProvisioner(opts: WorktreeProvisionerOptions): WorktreeProvisioner {
  const ensureWorktree = opts.ensureWorktree ?? defaultEnsureWorktree;

  return {
    async ensure(input: WorktreeProvisionInput): Promise<WorktreeProvisionResult> {
      const isolation =
        input.isolation ??
        createWorktreeIsolation({
          branch: input.branch,
          cacheRoot: opts.worktreeRoot,
          item: input.item,
          profile: input.profile,
        });
      const result = await ensureWorktree({
        baseBranch: resolveBaseBranch({ item: input.item, profile: input.profile }),
        branch: input.branch,
        envFiles: input.profile.envFiles,
        repoPath: input.profile.path,
        setupCommand: setupCommand(input.profile),
        setupEnv: isolation.env,
        worktreeRoot: opts.worktreeRoot,
      });

      return {
        ...result,
        isolation,
      };
    },
  };
}

function setupCommand(profile: RepoProfile): string {
  if (profile.packageManager === undefined) {
    throw new Error("repo profile package manager is required for worktree setup");
  }
  return packageCommand(profile.packageManager, profile.setup);
}
