import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { loadRepoProfilesFromYaml } from "../core/config";
import { markRunCleaned, defaultManifestPath, readManifest } from "../worktree/run-manifest";
import { pruneWorktrees } from "../worktree/manager";
import { planRunGc, type ReapReason, type RunRecord } from "../core/run-gc";

/**
 * `pando gc` — reaper for leaked worktree run-roots (ADR-012). Reads the central
 * manifest, asks the pure planner what is safe to reap, and (only with --force)
 * removes each dead run-root, prunes dangling worktree registrations, and stamps
 * the manifest. Dry-run is the default so a live daemon's run-root is never lost.
 */

export interface PandoGcDeps {
  now(): Date;
  isAlive(pid: number): boolean;
  readManifest(): Promise<RunRecord[]>;
  removeRunRoot(runRoot: string): Promise<void>;
  pruneRepos(): Promise<string[]>;
  markCleaned(id: string, cleanedAt: string): Promise<void>;
  log(line: string): void;
}

interface GcFlags {
  force: boolean;
  json: boolean;
}

const HELP_TOKENS: readonly string[] = ["help", "--help", "-h"];

export async function runPandoGc(argv: readonly string[], deps: PandoGcDeps): Promise<number> {
  // The pandoctl router forwards the full argv including the leading "gc"
  // command token (same contract as `start`); drop it before parsing flags.
  const flags = parseFlags(argv[0] === "gc" ? argv.slice(1) : argv);
  if (flags === "help") {
    for (const line of usageLines()) deps.log(line);
    return 0;
  }

  const runs = await deps.readManifest();
  const plan = planRunGc({ runs, isAlive: deps.isAlive });

  if (plan.reap.length === 0) {
    report(deps, flags, { reaped: [], failed: [], prunedRepos: [], plan });
    return 0;
  }

  if (!flags.force) {
    report(deps, flags, { reaped: [], failed: [], prunedRepos: [], plan });
    return 0;
  }

  const reaped: { run: RunRecord; reason: ReapReason }[] = [];
  const failed: { run: RunRecord; error: string }[] = [];
  for (const candidate of plan.reap) {
    try {
      await deps.removeRunRoot(candidate.run.runRoot);
      await deps.markCleaned(candidate.run.id, deps.now().toISOString());
      reaped.push(candidate);
    } catch (error) {
      failed.push({
        run: candidate.run,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const prunedRepos = reaped.length > 0 ? await deps.pruneRepos() : [];
  report(deps, flags, { reaped, failed, prunedRepos, plan });
  return failed.length > 0 ? 1 : 0;
}

interface ReportInput {
  reaped: { run: RunRecord; reason: ReapReason }[];
  failed: { run: RunRecord; error: string }[];
  prunedRepos: string[];
  plan: ReturnType<typeof planRunGc>;
}

function report(deps: PandoGcDeps, flags: GcFlags, input: ReportInput): void {
  const running = input.plan.keep.filter((entry) => entry.reason === "running").length;

  if (flags.json) {
    deps.log(
      JSON.stringify(
        {
          mode: flags.force ? "force" : "dry-run",
          reap: input.plan.reap.map((entry) => ({
            id: entry.run.id,
            runRoot: entry.run.runRoot,
            pid: entry.run.pid,
            reason: entry.reason,
          })),
          reaped: input.reaped.map((entry) => entry.run.id),
          failed: input.failed.map((entry) => ({ id: entry.run.id, error: entry.error })),
          prunedRepos: input.prunedRepos,
          running,
        },
        undefined,
        2,
      ),
    );
    return;
  }

  if (input.plan.reap.length === 0) {
    deps.log(
      `Nothing to reap. ${input.plan.keep.length} run(s) tracked, ${running} still running.`,
    );
    return;
  }

  if (!flags.force) {
    deps.log("pando gc — dry run (re-run with --force to delete)");
    for (const entry of input.plan.reap) {
      deps.log(`  reap  ${entry.reason.padEnd(9)}  ${entry.run.runRoot}  (pid ${entry.run.pid})`);
    }
    deps.log(
      `${input.plan.reap.length} run-root(s) would be reclaimed; ${running} live run(s) kept.`,
    );
    return;
  }

  for (const entry of input.reaped) {
    deps.log(`  reclaimed  ${entry.run.runRoot}`);
  }
  for (const entry of input.failed) {
    deps.log(`  FAILED     ${entry.run.runRoot}: ${entry.error}`);
  }
  deps.log(
    `Reclaimed ${input.reaped.length} run-root(s); pruned ${input.prunedRepos.length} repo(s); ${input.failed.length} failed.`,
  );
}

function parseFlags(argv: readonly string[]): GcFlags | "help" {
  const flags: GcFlags = { force: false, json: false };
  for (const token of argv) {
    if (HELP_TOKENS.includes(token)) return "help";
    if (token === "--force") flags.force = true;
    else if (token === "--json") flags.json = true;
    else return "help";
  }
  return flags;
}

function usageLines(): string[] {
  return [
    "pando gc — reclaim leaked worktree run-roots",
    "",
    "Usage:",
    "  pando gc [--force] [--json]",
    "",
    "Without --force this only lists dead run-roots (dry run).",
    "Live run-roots (owning process still alive) are never reaped.",
  ];
}

/* v8 ignore start -- default deps wire real fs/git/process; covered by runbook, not unit tests. */
export function defaultPandoGcDeps(configDir = "config"): PandoGcDeps {
  const manifestPath = defaultManifestPath(process.env, homedir());
  return {
    now: () => new Date(),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // ESRCH = no such process (dead); EPERM = alive but not ours (keep).
        return isErrno(error) && error.code === "EPERM";
      }
    },
    readManifest: () => readManifest(manifestPath),
    removeRunRoot: (runRoot) => rm(runRoot, { recursive: true, force: true }),
    pruneRepos: () => pruneConfiguredRepos(configDir),
    markCleaned: (id, cleanedAt) => markRunCleaned(manifestPath, id, cleanedAt),
    log: (line) => console.log(line),
  };
}

async function pruneConfiguredRepos(configDir: string): Promise<string[]> {
  const repos = new Set<string>([process.cwd()]);
  try {
    const reposYaml = await readFile(join(resolve(configDir), "repos.yaml"), "utf8");
    const profiles = await loadRepoProfilesFromYaml(reposYaml, {
      files: { exists: (path) => existsSync(path) },
      homeDir: homedir(),
    });
    for (const profile of Object.values(profiles)) repos.add(resolve(profile.path));
  } catch {
    // No/invalid config: still prune the cwd repo (the dogfood self-run case).
  }

  const pruned: string[] = [];
  for (const repoPath of repos) {
    try {
      await pruneWorktrees({ repoPath });
      pruned.push(repoPath);
    } catch {
      // Not a git repo or prune failed; skip — disk was already reclaimed by rm.
    }
  }
  return pruned;
}

export function runPandoGcCli(argv: readonly string[]): Promise<number> {
  return runPandoGc(argv, defaultPandoGcDeps());
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
/* v8 ignore stop */
