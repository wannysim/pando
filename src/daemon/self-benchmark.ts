import { exec } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { JobStatus, StageName } from "../core/types";
import {
  runHostFullDaemonSmoke,
  type FullDaemonSmokeEvidence,
  type FullDaemonSmokeMode,
  type FullDaemonSmokeOptions,
} from "./full-daemon-smoke";

const execAsync = promisify(exec);
const DEFAULT_JOB_COUNT = 1;
const DEFAULT_GLOBAL_CONCURRENCY = 2;
const STAGE_ORDER: readonly StageName[] = ["SPEC", "PLAN", "TEST", "IMPL", "REVIEW", "PR"];

export interface SelfBenchmarkOptions {
  mode?: FullDaemonSmokeMode;
  jobCount?: number;
  globalConcurrency?: number;
  runId?: string;
  outputDir?: string;
  repoRoot?: string;
  now?: () => string;
  timer?: BenchmarkTimer;
  packageManager?: string;
  runSmoke?: SelfBenchmarkSmokeRunner;
  smokeOptions?: Partial<FullDaemonSmokeOptions>;
}

export interface BenchmarkTimer {
  nowMs(): number;
}

export type SelfBenchmarkSmokeRunner = (
  opts: FullDaemonSmokeOptions,
) => Promise<FullDaemonSmokeEvidence>;

export interface SelfBenchmarkResult {
  summary: SelfBenchmarkSummary;
  summaryPath: string;
  markdownPath: string;
  evidencePath: string;
  failureSummaryPath: string;
}

export interface SelfBenchmarkSummary {
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  mode: FullDaemonSmokeMode;
  packageManager: string;
  runtime: {
    name: "node";
    version: string;
  };
  runner: {
    kind: "full-daemon-smoke";
    jobCount: number;
    globalConcurrency: number;
    gateMode: "shell";
    worktreeMode: "current-checkout";
  };
  ok: boolean;
  checks: FullDaemonSmokeEvidence["checks"];
  totals: {
    totalMs: number;
    jobs: number;
    success: number;
    failure: number;
    timeout: number;
    cancel: number;
    escalated: number;
    running: number;
    retried: number;
  };
  stageDurations: SelfBenchmarkStageDuration[];
  jobs: SelfBenchmarkJob[];
  artifacts: {
    summaryPath: string;
    markdownPath: string;
    evidencePath: string;
    failureSummaryPath: string;
  };
}

export interface SelfBenchmarkStageDuration {
  stage: StageName;
  count: number;
  totalMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
  completed: number;
  failed: number;
}

export interface SelfBenchmarkJob {
  id: string;
  finalStatus: JobStatus;
  durationMs: number | null;
  stages: SelfBenchmarkJobStage[];
}

export interface SelfBenchmarkJobStage {
  stage: StageName;
  eventType: "stage-completed" | "stage-failed";
  durationMs: number;
}

export async function runSelfBenchmark(
  opts: SelfBenchmarkOptions = {},
): Promise<SelfBenchmarkResult> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const now = opts.now ?? (() => new Date().toISOString());
  const timer = opts.timer ?? monotonicTimer();
  const runId = sanitizeRunId(opts.runId ?? defaultRunId());
  const outputDir = resolve(opts.outputDir ?? join("/tmp", "pando-self-benchmark", runId));
  const summaryPath = join(outputDir, "benchmark.json");
  const markdownPath = join(outputDir, "benchmark.md");
  const evidencePath = join(outputDir, "full-daemon-smoke.json");
  const failureSummaryPath = join(outputDir, "failure-summary.json");
  const dbPath = join(outputDir, "pando.sqlite");
  const mode = opts.mode ?? "contract";
  const jobCount = opts.jobCount ?? DEFAULT_JOB_COUNT;
  const globalConcurrency = opts.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY;
  const runSmoke = opts.runSmoke ?? runHostFullDaemonSmoke;

  await mkdir(outputDir, { recursive: true });
  await rm(dbPath, { force: true });
  const startedAtMs = timer.nowMs();
  const evidence = await runSmoke({
    ...opts.smokeOptions,
    dbPath,
    engineRunners: opts.smokeOptions?.engineRunners ?? {
      claude: contractWorkerRunner,
      codex: contractWorkerRunner,
    },
    ensureWorktree:
      opts.smokeOptions?.ensureWorktree ??
      (jobCount === 1 ? currentCheckoutWorktree(repoRoot) : undefined),
    evidencePath,
    failureSummaryPath,
    gateRunner: opts.smokeOptions?.gateRunner ?? shellGateRunner,
    globalConcurrency,
    jobCount,
    mode,
    now,
    repoRoot,
    runId,
    worktreeRoot: join(outputDir, "worktrees"),
  });
  const totalMs = Math.max(0, Math.round(timer.nowMs() - startedAtMs));
  const packageManager = opts.packageManager ?? (await packageManagerFor(repoRoot));

  const summary = buildSelfBenchmarkSummary({
    artifacts: { evidencePath, failureSummaryPath, markdownPath, summaryPath },
    evidence,
    generatedAt: now(),
    globalConcurrency,
    jobCount,
    packageManager,
    totalMs,
  });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(markdownPath, renderSelfBenchmarkMarkdown(summary));

  return { evidencePath, failureSummaryPath, markdownPath, summary, summaryPath };
}

function buildSelfBenchmarkSummary(input: {
  evidence: FullDaemonSmokeEvidence;
  generatedAt: string;
  packageManager: string;
  jobCount: number;
  globalConcurrency: number;
  totalMs: number;
  artifacts: SelfBenchmarkSummary["artifacts"];
}): SelfBenchmarkSummary {
  const jobs = jobBenchmarks(input.evidence);
  const totals = input.evidence.failureSummary.totals;

  return {
    artifacts: input.artifacts,
    checks: input.evidence.checks,
    generatedAt: input.generatedAt,
    jobs,
    mode: input.evidence.mode,
    ok: benchmarkOk(input.evidence),
    packageManager: input.packageManager,
    runId: input.evidence.runId,
    runner: {
      gateMode: "shell",
      globalConcurrency: input.globalConcurrency,
      jobCount: input.jobCount,
      kind: "full-daemon-smoke",
      worktreeMode: "current-checkout",
    },
    runtime: {
      name: "node",
      version: process.version,
    },
    schemaVersion: 1,
    stageDurations: stageDurations(jobs),
    totals: {
      cancel: totals.cancel,
      escalated: totals.escalated,
      failure: totals.failure,
      jobs: input.evidence.failureSummary.summary.jobs.length,
      retried: totals.retried,
      running: totals.running,
      success: totals.success,
      timeout: totals.timeout,
      totalMs: input.totalMs,
    },
  };
}

function jobBenchmarks(evidence: FullDaemonSmokeEvidence): SelfBenchmarkJob[] {
  const terminalJobs = new Map(
    evidence.failureSummary.summary.jobs.map((job) => [job.jobId, job] as const),
  );

  return evidence.jobs.map((job) => ({
    durationMs: terminalJobs.get(job.id)?.durationMs ?? null,
    finalStatus: job.finalStatus,
    id: job.id,
    stages: job.stageEvents.flatMap((event) => {
      if (event.type !== "stage-completed" && event.type !== "stage-failed") return [];
      if (!isStageName(event.stage)) return [];
      const durationMs = finiteDuration(event.payload.durationMs);
      if (durationMs === undefined) return [];
      return [{ durationMs, eventType: event.type, stage: event.stage }];
    }),
  }));
}

function stageDurations(jobs: readonly SelfBenchmarkJob[]): SelfBenchmarkStageDuration[] {
  const byStage = new Map<StageName, SelfBenchmarkJobStage[]>();
  for (const job of jobs) {
    for (const stage of job.stages) {
      const entries = byStage.get(stage.stage) ?? [];
      entries.push(stage);
      byStage.set(stage.stage, entries);
    }
  }

  return STAGE_ORDER.flatMap((stage) => {
    const entries = byStage.get(stage);
    if (entries === undefined || entries.length === 0) return [];
    const durations = entries.map((entry) => entry.durationMs);
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    return [
      {
        completed: entries.filter((entry) => entry.eventType === "stage-completed").length,
        count: entries.length,
        failed: entries.filter((entry) => entry.eventType === "stage-failed").length,
        maxMs: Math.max(...durations),
        meanMs: roundMs(totalMs / entries.length),
        minMs: Math.min(...durations),
        stage,
        totalMs,
      },
    ];
  });
}

export function renderSelfBenchmarkMarkdown(summary: SelfBenchmarkSummary): string {
  const lines = [
    "# Pando self-benchmark",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Run ID | ${summary.runId} |`,
    `| Generated at | ${summary.generatedAt} |`,
    `| Package manager | ${summary.packageManager} |`,
    `| Runtime | ${summary.runtime.name} ${summary.runtime.version} |`,
    `| Mode | ${summary.mode} |`,
    `| Jobs | ${summary.totals.jobs} |`,
    `| Success | ${summary.totals.success} |`,
    `| Failure | ${summary.totals.failure} |`,
    `| Total duration | ${summary.totals.totalMs} ms |`,
    `| OK | ${summary.ok ? "yes" : "no"} |`,
    "",
    "## Stage durations",
    "",
    "| Stage | Count | Total ms | Mean ms | Min ms | Max ms | Completed | Failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...summary.stageDurations.map(
      (stage) =>
        `| ${stage.stage} | ${stage.count} | ${stage.totalMs} | ${stage.meanMs} | ${stage.minMs} | ${stage.maxMs} | ${stage.completed} | ${stage.failed} |`,
    ),
    "",
    "## Artifacts",
    "",
    "| Artifact | Path |",
    "| --- | --- |",
    `| Summary JSON | ${summary.artifacts.summaryPath} |`,
    `| Summary Markdown | ${summary.artifacts.markdownPath} |`,
    `| Smoke evidence | ${summary.artifacts.evidencePath} |`,
    `| Failure summary | ${summary.artifacts.failureSummaryPath} |`,
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function benchmarkOk(evidence: FullDaemonSmokeEvidence): boolean {
  const totals = evidence.failureSummary.totals;
  const totalJobs =
    totals.cancel +
    totals.escalated +
    totals.failure +
    totals.running +
    totals.success +
    totals.timeout;

  return (
    totalJobs > 0 &&
    totals.success === totalJobs &&
    evidence.checks.gateEvidence.pass &&
    evidence.checks.jobsClaimed.pass &&
    evidence.checks.providerCap.pass &&
    evidence.checks.worktreeCollision.pass
  );
}

function currentCheckoutWorktree(repoRoot: string): FullDaemonSmokeOptions["ensureWorktree"] {
  return async (opts) => ({
    branch: opts.branch,
    path: repoRoot,
    reused: true,
  });
}

async function contractWorkerRunner(): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  return {
    exitCode: 0,
    stderr: "",
    stdout: '{"message":"benchmark contract worker ok","cost_usd":0}\n',
  };
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

async function packageManagerFor(repoRoot: string): Promise<string> {
  const raw = await readFile(join(repoRoot, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { packageManager?: unknown };
  return typeof parsed.packageManager === "string" ? parsed.packageManager : "unknown";
}

function monotonicTimer(): BenchmarkTimer {
  return {
    nowMs() {
      return Number(process.hrtime.bigint() / 1_000_000n);
    },
  };
}

function finiteDuration(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.round(value));
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function isStageName(value: unknown): value is StageName {
  return typeof value === "string" && STAGE_ORDER.includes(value as StageName);
}

function sanitizeRunId(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function defaultRunId(): string {
  return `self-${process.pid}-${Date.now()}`;
}

function asText(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : value;
}
