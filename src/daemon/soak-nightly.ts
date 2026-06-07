import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  runHostFullDaemonSmoke,
  type FullDaemonSmokeEvidence,
  type FullDaemonSmokeMode,
  type FullDaemonSmokeOptions,
} from "./full-daemon-smoke";
import {
  aggregateSoakRuns,
  type SoakIterationInput,
  type SoakNightlySummary,
} from "./soak-analytics";

const DEFAULT_ITERATIONS = 3;
const DEFAULT_JOB_COUNT = 3;
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 20;

export type SoakSmokeRunner = (opts: FullDaemonSmokeOptions) => Promise<FullDaemonSmokeEvidence>;

export interface SoakNightlyOptions {
  mode?: FullDaemonSmokeMode;
  iterations?: number;
  jobCount?: number;
  globalConcurrency?: number;
  runId?: string;
  outputDir?: string;
  now?: () => string;
  runSmoke?: SoakSmokeRunner;
  smokeOptions?: Partial<FullDaemonSmokeOptions>;
}

export interface SoakNightlyResult {
  summary: SoakNightlySummary;
  summaryPath: string;
  iterations: SoakIterationInput[];
}

export async function runSoakNightly(opts: SoakNightlyOptions = {}): Promise<SoakNightlyResult> {
  const mode = opts.mode ?? "contract";
  const iterationCount = boundedIterations(opts.iterations ?? DEFAULT_ITERATIONS);
  const jobCount = opts.jobCount ?? DEFAULT_JOB_COUNT;
  const now = opts.now ?? (() => new Date().toISOString());
  const runId = sanitize(opts.runId ?? defaultRunId());
  const outputDir = opts.outputDir ?? join("/tmp", "pando-soak-nightly", runId);
  const runSmoke = opts.runSmoke ?? runHostFullDaemonSmoke;

  const iterations: SoakIterationInput[] = [];
  for (let index = 1; index <= iterationCount; index += 1) {
    const iterationDir = join(outputDir, `iteration-${index}`);
    const iterationRunId = `${runId}-iter-${index}`;
    const evidencePath = join(iterationDir, "full-daemon-smoke.json");
    const failureSummaryPath = join(iterationDir, "failure-summary.json");

    const evidence = await runSmoke({
      ...opts.smokeOptions,
      dbPath: join(iterationDir, "pando.sqlite"),
      evidencePath,
      failureSummaryPath,
      globalConcurrency: opts.globalConcurrency ?? opts.smokeOptions?.globalConcurrency,
      jobCount,
      mode,
      now,
      runId: iterationRunId,
      worktreeRoot: join(iterationDir, "worktrees"),
    });

    iterations.push({
      evidencePath,
      failureSummaryPath,
      iteration: index,
      runId: iterationRunId,
      summary: evidence.failureSummary.summary,
    });
  }

  const summary = aggregateSoakRuns({
    generatedAt: now(),
    iterations,
    jobsPerIteration: jobCount,
    mode,
  });
  const summaryPath = join(outputDir, "nightly-summary.json");
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  return { iterations, summary, summaryPath };
}

function boundedIterations(value: number): number {
  if (!Number.isInteger(value) || value < MIN_ITERATIONS || value > MAX_ITERATIONS) {
    throw new Error(
      `soak nightly iterations must be an integer from ${MIN_ITERATIONS} to ${MAX_ITERATIONS}`,
    );
  }
  return value;
}

function sanitize(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-");
}

function defaultRunId(): string {
  return `nightly-${process.pid}-${Date.now()}`;
}
