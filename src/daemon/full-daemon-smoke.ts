import { exec } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { loadOrchestratorConfigFromYaml, loadRepoProfilesFromYaml } from "../core/config";
import type { ContextProvider, JobStatus, RepoProfile, StageName, WorkItem } from "../core/types";
import { loadStageConfigFromYaml } from "../core/stage-config";
import { createSqliteJobStore } from "../db/index";
import {
  ClaudeCodeEngine,
  type CommandRunner as ClaudeCommandRunner,
} from "../engines/claude-code";
import { CodexEngine, type CommandRunner as CodexCommandRunner } from "../engines/codex";
import { createPackageActionGate, type GateCommandRunner } from "../pipeline/gates/exit-code";
import type { PipelineClock } from "../pipeline/runner";
import { createRunScheduler } from "../scheduler/scheduler";
import { runDaemonOnce, type DaemonJobResult, type DaemonOnceResult } from "./loop";
import { summarizeTerminalJobs, type TerminalRunSummary } from "./failure-analytics";
import { createWorktreeProvisioner, type EnsureWorktreePort } from "./worktree-provisioner";

export type FullDaemonSmokeMode = "contract" | "live";

export interface FullDaemonSmokeOptions {
  mode?: FullDaemonSmokeMode;
  repoRoot?: string;
  configDir?: string;
  worktreeRoot?: string;
  dbPath?: string;
  evidencePath?: string;
  failureSummaryPath?: string;
  runId?: string;
  globalConcurrency?: number;
  jobCount?: number;
  maxTicks?: number;
  now?: () => string;
  clock?: PipelineClock;
  ensureWorktree?: EnsureWorktreePort;
  gateRunner?: GateCommandRunner;
  engineRunners?: {
    claude?: ClaudeCommandRunner;
    codex?: CodexCommandRunner;
  };
}

export interface FullDaemonSmokeEvidence {
  schemaVersion: 1;
  mode: FullDaemonSmokeMode;
  target: "host";
  runId: string;
  checks: {
    jobsClaimed: { expected: number; actual: number; pass: boolean };
    twoJobsClaimed?: { expected: 2; actual: number; pass: boolean };
    globalConcurrency: { value: number; withinLiveCap: boolean };
    worktreeCollision: { pass: boolean };
    providerCap: { pass: boolean; usage: Partial<Record<ContextProvider, number>> };
    gateEvidence: { pass: boolean };
  };
  failureSummary: {
    path: string;
    summary: TerminalRunSummary;
    totals: TerminalRunSummary["totals"];
  };
  jobs: FullDaemonSmokeJobEvidence[];
}

export interface FullDaemonSmokeJobEvidence {
  id: string;
  repo: string;
  finalStatus: JobStatus;
  worktreePath?: string;
  gateEvidence: Array<{
    type: string;
    stage?: StageName;
    gateName?: string;
    evidence?: unknown;
  }>;
  stageEvents: Array<{
    type: string;
    stage?: StageName;
    payload: Record<string, unknown>;
    reason?: string;
  }>;
}

const execAsync = promisify(exec);
const DEFAULT_SMOKE_JOB_COUNT = 2;
const MAX_SOAK_JOB_COUNT = 5;
const MIN_SMOKE_JOB_COUNT = 1;
const TERMINAL_STATUSES = new Set<JobStatus>(["CANCELED", "DONE", "ESCALATED", "FAILED"]);

export async function runHostFullDaemonSmoke(
  opts: FullDaemonSmokeOptions = {},
): Promise<FullDaemonSmokeEvidence> {
  const mode = opts.mode ?? "contract";
  const runId = sanitizeRunId(opts.runId ?? defaultRunId());
  const jobCount = smokeJobCount(opts.jobCount ?? DEFAULT_SMOKE_JOB_COUNT);
  const tmpRoot = join("/tmp", "pando-full-daemon-smoke", runId);
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const configDir = resolvePath(opts.configDir ?? join(repoRoot, "config"), repoRoot);
  const worktreeRoot = resolvePath(opts.worktreeRoot ?? join(tmpRoot, "worktrees"), repoRoot);
  const dbPath = resolvePath(opts.dbPath ?? join(tmpRoot, "pando.sqlite"), repoRoot);
  const evidencePath = resolvePath(
    opts.evidencePath ?? join(tmpRoot, "full-daemon-smoke.json"),
    repoRoot,
  );
  const failureSummaryPath = resolvePath(
    opts.failureSummaryPath ?? join(tmpRoot, "failure-summary.json"),
    repoRoot,
  );
  const targetJobIds = smokeJobIds(jobCount);

  await mkdir(dirname(dbPath), { recursive: true });
  await mkdir(dirname(evidencePath), { recursive: true });
  await mkdir(dirname(failureSummaryPath), { recursive: true });

  const [reposYaml, stagesYaml, orchestratorYaml] = await Promise.all([
    readFile(join(configDir, "repos.yaml"), "utf8"),
    readFile(join(configDir, "stages.yaml"), "utf8"),
    readFile(join(configDir, "orchestrator.yaml"), "utf8"),
  ]);
  const profiles = await loadRepoProfilesFromYaml(reposYaml, {
    files: NODE_FILE_PROBE,
    homeDir: homedir(),
  });
  const rawPandoProfile = profiles.pando;
  if (rawPandoProfile === undefined) throw new Error("pando repo profile is not configured");

  const pandoProfile: RepoProfile = { ...rawPandoProfile, path: repoRoot };
  const stageConfig = loadStageConfigFromYaml(stagesYaml);
  const orchestrator = loadOrchestratorConfigFromYaml(orchestratorYaml);
  const globalConcurrency = opts.globalConcurrency ?? 2;
  const store = createSqliteJobStore({ now: opts.now, path: dbPath });

  try {
    for (const item of await createSmokeWorkItems(runId, tmpRoot, targetJobIds)) {
      store.enqueueJob({ item, retryBudget: stageConfig.defaults.retryBudget });
    }

    const scheduler = createRunScheduler({
      globalConcurrency,
      providerConcurrency: orchestrator.providerConcurrency,
    });
    const daemonJobs = await runSmokeDaemonUntilSettled({
      buildPrompt: smokePrompt,
      clock: opts.clock,
      engines: createSmokeEngines(mode, opts.engineRunners),
      gates: createSmokeGates(opts.gateRunner ?? defaultGateRunner(mode)),
      maxTicks: opts.maxTicks ?? Math.max(jobCount, 1) * (stageConfig.defaults.retryBudget + 2),
      profiles: { pando: pandoProfile },
      scheduler,
      stageConfig,
      store,
      targetJobIds,
      worktrees: createWorktreeProvisioner({
        ensureWorktree: opts.ensureWorktree,
        worktreeRoot,
      }),
    });
    const failureSummary = buildFailureSummary({
      generatedAt: opts.now?.() ?? new Date().toISOString(),
      path: failureSummaryPath,
      store,
      targetJobIds,
    });
    await writeFailureSummary(failureSummaryPath, failureSummary);
    const evidence = buildEvidence({
      daemonJobs,
      expectedJobCount: jobCount,
      failureSummary,
      failureSummaryPath,
      globalConcurrency,
      mode,
      profile: pandoProfile,
      providerConcurrency: orchestrator.providerConcurrency,
      runId,
      store,
      targetJobIds,
    });

    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    return evidence;
  } finally {
    store.close();
  }
}

async function runSmokeDaemonUntilSettled(input: {
  buildPrompt: typeof smokePrompt;
  clock: FullDaemonSmokeOptions["clock"];
  engines: ReturnType<typeof createSmokeEngines>;
  gates: ReturnType<typeof createSmokeGates>;
  maxTicks: number;
  profiles: Record<string, RepoProfile>;
  scheduler: ReturnType<typeof createRunScheduler>;
  stageConfig: ReturnType<typeof loadStageConfigFromYaml>;
  store: ReturnType<typeof createSqliteJobStore>;
  targetJobIds: readonly string[];
  worktrees: ReturnType<typeof createWorktreeProvisioner>;
}): Promise<DaemonJobResult[]> {
  const results = new Map<string, DaemonJobResult>();

  for (let tick = 0; tick < input.maxTicks; tick += 1) {
    if (targetJobsSettled(input.store, input.targetJobIds)) break;

    const result = await runDaemonOnce({
      buildPrompt: input.buildPrompt,
      clock: input.clock,
      engines: input.engines,
      gates: input.gates,
      profiles: input.profiles,
      scheduler: input.scheduler,
      stageConfig: input.stageConfig,
      store: input.store,
      worktrees: input.worktrees,
    });

    for (const job of daemonJobResults(result)) {
      results.set(job.jobId, job);
    }

    if (result.status === "idle") break;
  }

  return [...results.values()];
}

function createSmokeEngines(
  mode: FullDaemonSmokeMode,
  runners: FullDaemonSmokeOptions["engineRunners"],
) {
  const contractRunner = mode === "contract" ? contractWorkerRunner : undefined;
  return {
    "claude-code": new ClaudeCodeEngine({
      runner: runners?.claude ?? contractRunner,
    }),
    codex: new CodexEngine({
      runner: runners?.codex ?? contractRunner,
    }),
  };
}

function createSmokeGates(runner: GateCommandRunner) {
  return {
    IMPL: [createPackageActionGate("lint", runner)],
    PR: [createPackageActionGate("types", runner)],
    TEST: [createPackageActionGate("test", runner)],
  };
}

async function createSmokeWorkItems(
  runId: string,
  tmpRoot: string,
  jobIds: readonly string[],
): Promise<WorkItem[]> {
  const briefRoot = join(tmpRoot, "briefs");
  await mkdir(briefRoot, { recursive: true });

  return await Promise.all(
    jobIds.map(async (id, index): Promise<WorkItem> => {
      const briefPath = join(briefRoot, `${id}.md`);
      await writeFile(briefPath, smokeBrief(id, jobIds.length), "utf8");

      return {
        branch: `chore/pando-full-daemon-smoke-${runId}-${index + 1}`,
        id,
        payload: { briefPath, kind: "brief" },
        repo: "pando",
        source: "brief",
        title: `Pando full daemon smoke ${index + 1}`,
      };
    }),
  );
}

function smokeBrief(id: string, jobCount: number): string {
  return `# Goal
Run a deterministic pando full-daemon smoke contract for ${id}.

# User Story
As the daemon operator, I want pando to run ${jobCount} self-profile jobs through the host daemon path.

# Acceptance Criteria
- Exactly ${jobCount} jobs are claimed.
- Worktree paths do not collide.
- Provider caps are not exceeded.
- Gate evidence is structured JSON.

# Screens or Behavior
No UI behavior is required.

# Non-Goals
- Do not add public auth.
- Do not add database tables.
- Do not use worker output text for gate decisions.

# Assets
None.

# Open Questions
None.
`;
}

function smokePrompt(stage: StageName): string {
  return [
    "Run the pando full-daemon smoke contract for the current stage.",
    `Stage: ${stage}`,
    "Do not print secrets.",
    "Do not modify tracked files.",
    "Keep the response short; deterministic gates decide pass or fail.",
  ].join("\n");
}

function defaultGateRunner(mode: FullDaemonSmokeMode): GateCommandRunner {
  return mode === "contract" ? contractGateRunner : shellGateRunner;
}

async function contractWorkerRunner(): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return {
    exitCode: 0,
    stderr: "",
    stdout: '{"message":"contract worker ok","cost_usd":0}\n',
  };
}

async function contractGateRunner(): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return { exitCode: 0, stderr: "", stdout: "" };
}

async function shellGateRunner(
  command: string,
  opts: { cwd: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
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
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stderr: asText(failure.stderr),
      stdout: asText(failure.stdout),
    };
  }
}

function buildEvidence(input: {
  daemonJobs: readonly DaemonJobResult[];
  expectedJobCount: number;
  failureSummary: TerminalRunSummary;
  failureSummaryPath: string;
  store: ReturnType<typeof createSqliteJobStore>;
  targetJobIds: readonly string[];
  globalConcurrency: number;
  profile: RepoProfile;
  providerConcurrency: Partial<Record<ContextProvider, number>>;
  mode: FullDaemonSmokeMode;
  runId: string;
}): FullDaemonSmokeEvidence {
  const daemonJobs = input.daemonJobs;
  const jobs = input.targetJobIds.map((jobId) => {
    const job = input.store.getJob(jobId);
    if (job === undefined) throw new Error(`smoke job missing from store: ${jobId}`);
    const events = input.store.listEvents(jobId);

    return {
      finalStatus: job.status,
      gateEvidence: events
        .filter((event) => event.type.startsWith("gate-"))
        .map((event) =>
          removeUndefined({
            evidence: structuredEvidence(event.evidence),
            gateName: event.gateName,
            stage: event.stage,
            type: event.type,
          }),
        ),
      id: jobId,
      repo: job.item.repo,
      stageEvents: events
        .filter((event) =>
          ["stage-started", "stage-completed", "stage-failed", "worker-cost"].includes(event.type),
        )
        .map((event) =>
          removeUndefined({
            payload: event.payload,
            reason: event.reason,
            stage: event.stage,
            type: event.type,
          }),
        ),
      worktreePath: job.worktreePath,
    };
  });
  const providerUsage = providerUsageFor(input.profile, daemonJobs.length);
  const jobsClaimed = {
    actual: daemonJobs.length,
    expected: input.expectedJobCount,
    pass: daemonJobs.length === input.expectedJobCount,
  };

  return {
    checks: {
      gateEvidence: {
        pass: jobs.every(
          (job) =>
            job.gateEvidence.length > 0 &&
            job.gateEvidence.every((event) => event.evidence !== undefined),
        ),
      },
      globalConcurrency: {
        value: input.globalConcurrency,
        withinLiveCap: [2, 3].includes(input.globalConcurrency),
      },
      providerCap: {
        pass: providerCapPass(providerUsage, input.providerConcurrency),
        usage: providerUsage,
      },
      jobsClaimed,
      ...(input.expectedJobCount === 2
        ? {
            twoJobsClaimed: {
              actual: daemonJobs.length,
              expected: 2 as const,
              pass: daemonJobs.length === 2,
            },
          }
        : {}),
      worktreeCollision: {
        pass: new Set(jobs.map((job) => job.worktreePath).filter(isString)).size === jobs.length,
      },
    },
    failureSummary: {
      path: input.failureSummaryPath,
      summary: input.failureSummary,
      totals: input.failureSummary.totals,
    },
    jobs,
    mode: input.mode,
    runId: input.runId,
    schemaVersion: 1,
    target: "host",
  };
}

function buildFailureSummary(input: {
  generatedAt: string;
  path: string;
  store: ReturnType<typeof createSqliteJobStore>;
  targetJobIds: readonly string[];
}): TerminalRunSummary {
  const jobs = input.targetJobIds.map((jobId) => {
    const job = input.store.getJob(jobId);
    if (job === undefined) throw new Error(`smoke job missing from store: ${jobId}`);
    return job;
  });
  const eventsByJobId = Object.fromEntries(
    input.targetJobIds.map((jobId) => [jobId, input.store.listEvents(jobId)]),
  );

  return summarizeTerminalJobs({
    evidenceRoot: join(dirname(input.path), "job-evidence"),
    eventsByJobId,
    generatedAt: input.generatedAt,
    jobs,
  });
}

async function writeFailureSummary(path: string, summary: TerminalRunSummary): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  for (const job of summary.jobs) {
    await mkdir(dirname(job.evidence.path), { recursive: true });
    await writeFile(job.evidence.path, `${JSON.stringify(job, null, 2)}\n`);
  }
  await writeFile(path, `${JSON.stringify(summary, null, 2)}\n`);
}

function daemonJobResults(result: DaemonOnceResult): DaemonJobResult[] {
  if (result.status === "idle") return [];
  if ("jobs" in result) return result.jobs;
  return [result];
}

function targetJobsSettled(
  store: ReturnType<typeof createSqliteJobStore>,
  jobIds: readonly string[],
): boolean {
  return jobIds.every((jobId) => {
    const job = store.getJob(jobId);
    return job !== undefined && TERMINAL_STATUSES.has(job.status);
  });
}

function smokeJobCount(value: number): number {
  if (!Number.isInteger(value) || value < MIN_SMOKE_JOB_COUNT || value > MAX_SOAK_JOB_COUNT) {
    throw new Error(
      `full daemon smoke jobCount must be an integer from ${MIN_SMOKE_JOB_COUNT} to ${MAX_SOAK_JOB_COUNT}`,
    );
  }
  return value;
}

function smokeJobIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `PANDO-FULL-SMOKE-${index + 1}`);
}

function providerUsageFor(
  profile: RepoProfile,
  jobCount: number,
): Partial<Record<ContextProvider, number>> {
  return Object.fromEntries(
    profile.context.providers.map((provider) => [provider, jobCount]),
  ) as Partial<Record<ContextProvider, number>>;
}

function providerCapPass(
  usage: Partial<Record<ContextProvider, number>>,
  caps: Partial<Record<ContextProvider, number>>,
): boolean {
  return Object.entries(usage).every(([provider, value]) => {
    if (value === undefined) return true;
    const cap = caps[provider as ContextProvider];
    return cap === undefined || value <= cap;
  });
}

function structuredEvidence(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function resolvePath(value: string, baseDir: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  if (isAbsolute(value)) return value;
  return resolve(baseDir, value);
}

function sanitizeRunId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function defaultRunId(): string {
  return `run-${process.pid}-${Date.now()}`;
}

function asText(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

const NODE_FILE_PROBE = {
  async exists(path: string): Promise<boolean> {
    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") return false;
      throw error;
    }
  },
};

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
