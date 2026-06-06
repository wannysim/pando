import { join } from "node:path";
import type { RepoProfile, WorkItem } from "../core/types";

export interface WorktreeIsolation {
  port: number;
  cacheDir: string;
  env: Record<string, string>;
}

export interface CreateWorktreeIsolationInput {
  item: WorkItem;
  profile: RepoProfile;
  branch: string;
  cacheRoot: string;
}

export function createWorktreeIsolation(input: CreateWorktreeIsolationInput): WorktreeIsolation {
  const port = portForJob(input.item.id, input.profile.portRange);
  const cacheDir = join(input.cacheRoot, ".cache", input.item.repo, branchSlug(input.branch));
  const portValue = String(port);

  return {
    cacheDir,
    env: {
      PANDO_ASSIGNED_PORT: portValue,
      PANDO_CACHE_DIR: cacheDir,
      PANDO_JOB_ID: input.item.id,
      PORT: portValue,
      XDG_CACHE_HOME: cacheDir,
    },
    port,
  };
}

function portForJob(jobId: string, [start, end]: [number, number]): number {
  const size = end - start + 1;
  return start + (stableHash(jobId) % size);
}

function stableHash(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function branchSlug(branch: string): string {
  return branch.replaceAll("/", "-").replace(/-+/g, "-");
}
