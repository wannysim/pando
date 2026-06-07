import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  loadOrchestratorConfigFromYaml,
  loadRepoProfilesFromYaml,
  packageCommand,
} from "../core/config";
import type { RepoProfile, StageName, WorkItem } from "../core/types";
import { loadStageConfigFromYaml } from "../core/stage-config";
import { createSqliteJobStore } from "../db/index";
import { ClaudeCodeEngine } from "../engines/claude-code";
import { CodexEngine } from "../engines/codex";
import { createBriefIntakeGate } from "../intake/brief";
import { createSpecArtifactGate, createPlanArtifactGate } from "../pipeline/gates/artifact-schema";
import { createPackageActionGate, type GateCommandRunner } from "../pipeline/gates/exit-code";
import { createWorktreeDiffRulesGate, type CollectChangesPort } from "../pipeline/gates/diff-rules";
import { collectChangedFiles } from "../git/inspector";
import { createRunScheduler } from "../scheduler/scheduler";
import { runDaemonOnce } from "./loop";
import { createWorktreeProvisioner, type EnsureWorktreePort } from "./worktree-provisioner";
import type { WorkerEngineName } from "../core/stage-config";
import type { WorkerEngine } from "../core/types";

export interface DaemonLoopController {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
}

export interface DaemonLoopControllerOptions {
  intervalMs: number;
  runOnce(): Promise<void>;
  onError?: (error: unknown) => void;
  onStop?: () => void;
}

export interface LocalDaemonRuntimeOptions {
  configDir: string;
  dbPath: string;
  globalConcurrency: number;
  repoRoot?: string;
  worktreeRoot?: string;
  tickMs: number;
  onError?: (error: unknown) => void;
  engines?: Record<WorkerEngineName, WorkerEngine>;
  ensureWorktree?: EnsureWorktreePort;
  gateRunner?: GateCommandRunner;
  collectChanges?: CollectChangesPort;
}

const execAsync = promisify(exec);
const PR_GATE_ORDER = ["test", "lint", "types"] as const;

export function createDaemonLoopController(
  opts: DaemonLoopControllerOptions,
): DaemonLoopController {
  let interval: NodeJS.Timeout | undefined;
  let running = false;
  let used = false;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    if (running) return;
    used = true;
    running = true;
    try {
      await opts.runOnce();
    } catch (error) {
      opts.onError?.(error);
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (stopped) return;
      if (interval !== undefined) return;
      used = true;
      interval = setInterval(() => {
        void tick();
      }, opts.intervalMs);
      void tick();
    },
    stop() {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
      if (stopped || !used) return;
      stopped = true;
      opts.onStop?.();
    },
    tick,
  };
}

export async function createLocalDaemonRuntime(
  opts: LocalDaemonRuntimeOptions,
): Promise<DaemonLoopController> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const configDir = resolve(opts.configDir);
  const [reposYaml, stagesYaml, orchestratorYaml] = await Promise.all([
    readFile(join(configDir, "repos.yaml"), "utf8"),
    readFile(join(configDir, "stages.yaml"), "utf8"),
    readFile(join(configDir, "orchestrator.yaml"), "utf8"),
  ]);
  const profiles = await loadRepoProfilesFromYaml(reposYaml, {
    files: { exists: asyncExists },
    homeDir: homedir(),
  });
  const stageConfig = loadStageConfigFromYaml(stagesYaml);
  const orchestrator = loadOrchestratorConfigFromYaml(orchestratorYaml);
  const store = createSqliteJobStore({ path: opts.dbPath });
  const gateRunner = opts.gateRunner ?? shellGateRunner;
  const collectChanges = opts.collectChanges ?? collectChangedFiles;
  const scheduler = createRunScheduler({
    globalConcurrency: opts.globalConcurrency,
    providerConcurrency: orchestrator.providerConcurrency,
  });

  return createDaemonLoopController({
    intervalMs: opts.tickMs,
    onError: opts.onError,
    onStop() {
      store.close();
    },
    async runOnce() {
      await runDaemonOnce({
        buildPrompt: buildLocalPipelinePrompt,
        engines: opts.engines ?? {
          "claude-code": new ClaudeCodeEngine(),
          codex: new CodexEngine(),
        },
        gates: {
          IMPL: [
            createWorktreeDiffRulesGate({ collectChanges }),
            createPackageActionGate("lint", gateRunner),
          ],
          PLAN: [createPlanArtifactGate({ readText: optionalReadText })],
          PR: [
            createPackageActionGate("test", gateRunner),
            createPackageActionGate("lint", gateRunner),
            createPackageActionGate("types", gateRunner),
          ],
          SPEC: [
            createBriefIntakeGate({ readText: optionalReadText }),
            createSpecArtifactGate({ readText: optionalReadText }),
          ],
        },
        profiles: localProfiles(profiles, repoRoot),
        scheduler,
        stageConfig,
        store,
        worktrees: createWorktreeProvisioner({
          ensureWorktree: opts.ensureWorktree,
          worktreeRoot: opts.worktreeRoot ?? join(homedir(), ".worktrees"),
        }),
      });
    },
  });
}

function localProfiles(
  profiles: Record<string, RepoProfile>,
  repoRoot: string,
): Record<string, RepoProfile> {
  const pando = profiles.pando;
  /* v8 ignore next -- non-pando local profiles are allowed but not used by current self-runner tests. */
  if (pando === undefined) return profiles;
  return { ...profiles, pando: { ...pando, path: repoRoot } };
}

export function buildLocalPipelinePrompt(
  stage: StageName,
  context: { item: WorkItem; profile: RepoProfile; worktree: string },
): string {
  const item = context.item;
  const briefPath = item.payload.kind === "brief" ? item.payload.briefPath : undefined;
  const header = [
    `Stage: ${stage}`,
    `Job: ${item.id}`,
    `Title: ${item.title}`,
    `Repo: ${item.repo}`,
    `Repo path: ${context.profile.path}`,
    `Base branch: ${context.profile.baseBranch}`,
    `Worktree: ${context.worktree}`,
    briefPath === undefined ? undefined : `Brief path: ${briefPath}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  if (stage === "SPEC") {
    return `${header}

Read the brief and write _spec.md.
_spec.md must start with an H1 title and include a ## Requirements Overview section.
Keep _spec.md focused on concrete requirements and acceptance criteria.
Do not print secrets.`;
  }

  if (stage === "PLAN") {
    return `${header}

Read _spec.md and write PLAN.md.
PLAN.md must start with an H1 title that includes [${item.id}].
PLAN.md must include ## Requirements Overview, ## Implementation Roadmap, ## Acceptance Criteria, and ## Open Questions.
Under ## Implementation Roadmap, use headings exactly like "### Commit 1: Short title" for each commit unit.
Use one PR with task-sized commits unless the change is genuinely large.
Record blockers as [Blocker] open questions only when work cannot continue.`;
  }

  if (stage === "TEST") {
    return `${header}

Read PLAN.md and add focused regression tests for the requested behavior.
Use the repository's existing test framework when one exists.
If this repository has no configured test gate, do not introduce a new test
framework unless PLAN.md explicitly calls for it; add the smallest deterministic
validation artifact that fits the repo.
Edit files directly in this worktree; do not spawn subagents.
Before exiting, make sure git diff contains at least one relevant test change.
Keep the change scoped to this job.`;
  }

  if (stage === "IMPL") {
    return `${header}

Implement the smallest change that satisfies PLAN.md and the tests.
Edit files directly in this worktree; do not spawn subagents.
Before exiting, make sure git diff contains the implementation change.
Never modify, add, or delete files under tests/ in this stage. The diff-rules
gate hard-rejects any test-file change in IMPL and fails the stage, so adjust
the implementation instead. If a test looks wrong, leave it untouched.
Keep unrelated files untouched.`;
  }

  if (stage === "REVIEW") {
    return `${header}

Review the current diff for correctness, scope, deterministic gates, and secrets.
Fix concrete issues only. Do not rely on LLM output text for pass/fail decisions.`;
  }

  const verificationCommands = buildPrVerificationCommands(context.profile);
  const verificationInstructions =
    verificationCommands.length === 0
      ? "No package verification gates are configured for this repo. Inspect repo-local docs before choosing any extra verification command, and mention the missing configured gates in the PR description."
      : `Run the configured verification commands:
${verificationCommands.map((command, index) => `${index + 1}. ${command}`).join("\n")}`;

  return `${header}

Prepare the result for human review:
${verificationInstructions}
Then:
1. Commit with an English message.
2. Push the branch.
3. Create a Draft PR against the repo base branch with gh pr create.
Do not print secrets. Do not merge the PR.`;
}

function buildPrVerificationCommands(profile: RepoProfile): string[] {
  const manager = profile.packageManager;
  if (manager === undefined) return [];

  return PR_GATE_ORDER.flatMap((gateName) => {
    const action = profile.gates[gateName];
    return action === undefined ? [] : [packageCommand(manager, action)];
  });
}

export async function shellGateRunner(command: string, opts: { cwd: string }) {
  try {
    const { stderr, stdout } = await execAsync(command, {
      cwd: opts.cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 10 * 60_000,
    });
    return { exitCode: 0, stderr: asText(stderr), stdout: asText(stdout) };
  } catch (error) {
    const failure = error as Partial<{
      code: number | string;
      stderr: string | Buffer;
      stdout: string | Buffer;
    }>;
    return {
      /* v8 ignore next -- child_process failures normally expose numeric shell exit codes. */
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stderr: asText(failure.stderr),
      stdout: asText(failure.stdout),
    };
  }
}

export async function optionalReadText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function asyncExists(path: string): boolean {
  return existsSync(path);
}

function asText(value: string | Buffer | undefined): string {
  /* v8 ignore next -- command adapters normalize observed stdout/stderr to strings in tests. */
  if (value === undefined) return "";
  /* v8 ignore next -- Buffer output is a child_process compatibility branch. */
  return typeof value === "string" ? value : value.toString("utf8");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
