/**
 * Pure decision layer for worktree run-root garbage collection (ADR-012).
 *
 * Given the run manifest and a process-liveness probe, classify each run into
 * "reap" (safe to tear down) or "keep" using deterministic signals only —
 * never wall-clock heuristics that could reap a live daemon's run-root.
 */

export interface RunRecord {
  id: string;
  runRoot: string;
  pid: number;
  startedAt: string;
  finishedAt?: string;
  cleanedAt?: string;
}

export type ReapReason = "finished" | "orphaned";
export type KeepReason = "running" | "already-cleaned";

export interface PlanRunGcInput {
  runs: readonly RunRecord[];
  isAlive: (pid: number) => boolean;
}

export interface RunGcPlan {
  reap: { run: RunRecord; reason: ReapReason }[];
  keep: { run: RunRecord; reason: KeepReason }[];
}

export function planRunGc(input: PlanRunGcInput): RunGcPlan {
  const plan: RunGcPlan = { reap: [], keep: [] };

  for (const run of input.runs) {
    if (run.cleanedAt !== undefined) {
      plan.keep.push({ run, reason: "already-cleaned" });
    } else if (run.finishedAt !== undefined) {
      plan.reap.push({ run, reason: "finished" });
    } else if (!input.isAlive(run.pid)) {
      plan.reap.push({ run, reason: "orphaned" });
    } else {
      plan.keep.push({ run, reason: "running" });
    }
  }

  return plan;
}
