#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, resolve } from "node:path";
import process from "node:process";
import { homedir } from "node:os";

const args = parseArgs(process.argv.slice(2));
const requestedMode = args.mode ?? (process.env.PANDO_LIVE_SMOKE === "1" ? "live" : "fake");
const evidencePath = resolve(args.evidence ?? "smoke/evidence/two-job-smoke.json");
const requestedTarget = args.target ?? "host";

const evidence = await (requestedMode === "readiness"
  ? readinessEvidence(process.env, requestedTarget)
  : requestedMode === "live"
    ? liveOrFallbackEvidence(process.env, requestedTarget)
    : fakeEvidence("deterministic fake smoke requested"));

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${evidence.mode} two-job smoke evidence: ${evidencePath}`);

async function liveOrFallbackEvidence(env, target) {
  const readiness = readinessEvidence(env, target);
  if (readiness.blockers.length > 0) {
    return fakeEvidence("live smoke prerequisites missing", readiness);
  }

  return liveEvidence(env, target, readiness);
}

function readinessEvidence(env, target) {
  const globalConcurrency = globalConcurrencyCheck(env);
  const workerCli = workerCliCheck(env);
  const auth = workerAuthCheck(env);
  const mounts = mountContractCheck(env, target);
  const blockers = [
    ...globalConcurrency.blockers,
    ...workerCli.blockers,
    ...auth.blockers,
    ...mounts.blockers,
  ];

  return {
    blockers,
    checks: {
      auth: auth.check,
      globalConcurrency: globalConcurrency.check,
      mounts: mounts.check,
      workerCli: workerCli.check,
    },
    mode: "readiness",
    schemaVersion: 1,
    target,
  };
}

async function liveEvidence(env, target, readiness) {
  const jobs = await Promise.all(
    liveProbeSpecs(env, readiness).map((spec) => runLiveProbe(spec, env)),
  );

  return {
    checks: {
      gateEvidence: {
        pass: jobs.every(
          (job) =>
            job.worker.exitCode === 0 &&
            job.gateEvidence.some((evidence) => evidence.gateName === "worker-exit-code"),
        ),
      },
      globalConcurrency: readiness.checks.globalConcurrency,
      providerCap: { pass: jobs.every((job) => providerUsageWithinCap(job.providerUsage)) },
      worktreeCollision: {
        pass: new Set(jobs.map((job) => job.worktreePath)).size === jobs.length,
      },
    },
    jobs,
    mode: "live",
    readiness,
    schemaVersion: 1,
    target,
  };
}

function liveProbeSpecs(env, readiness) {
  const runId = smokeRunId(env);
  const root = join(readiness.checks.mounts.paths.worktrees.path, "pando-live-smoke", runId);
  const timeoutMs = Number.parseInt(env.PANDO_WORKER_SMOKE_TIMEOUT_MS ?? "120000", 10);

  return [
    {
      args: [
        "-p",
        "Reply exactly: pando-claude-live-smoke-ok",
        "--model",
        env.PANDO_CLAUDE_SMOKE_MODEL ?? "sonnet",
        "--output-format",
        "json",
        "--allowedTools",
        "Read",
      ],
      command: "claude",
      engine: "claude-code",
      id: "SMOKE-LIVE-CLAUDE",
      model: env.PANDO_CLAUDE_SMOKE_MODEL ?? "sonnet",
      timeoutMs,
      worktreePath: join(root, "claude"),
    },
    {
      args: [
        "exec",
        "--skip-git-repo-check",
        "--json",
        "--sandbox",
        "workspace-write",
        "--model",
        env.PANDO_CODEX_SMOKE_MODEL ?? "gpt-5-codex",
        "Reply exactly: pando-codex-live-smoke-ok. Do not edit files.",
      ],
      command: "codex",
      engine: "codex",
      id: "SMOKE-LIVE-CODEX",
      model: env.PANDO_CODEX_SMOKE_MODEL ?? "gpt-5-codex",
      timeoutMs,
      worktreePath: join(root, "codex"),
    },
  ];
}

async function runLiveProbe(spec, env) {
  await mkdir(spec.worktreePath, { recursive: true });
  const startedAt = Date.now();
  const result = await execFileResult(spec.command, spec.args, {
    cwd: spec.worktreePath,
    env,
    timeout: spec.timeoutMs,
  });

  return {
    gateEvidence: [
      {
        evidence: JSON.stringify(
          removeUndefined({
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
          }),
        ),
        gateName: "worker-exit-code",
        stage: "WORKER",
      },
    ],
    id: spec.id,
    providerUsage: { confluence: 0, figma: 0 },
    repo: "pando-smoke",
    worker: {
      command: spec.command,
      durationMs: Math.max(0, Date.now() - startedAt),
      engine: spec.engine,
      exitCode: result.exitCode,
      model: spec.model,
      signal: result.signal,
      stderrBytes: Buffer.byteLength(result.stderr),
      stdoutBytes: Buffer.byteLength(result.stdout),
      timedOut: result.timedOut,
    },
    worktreePath: spec.worktreePath,
  };
}

async function execFileResult(command, args, opts) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let timedOut = false;
    const maxBuffer = 10 * 1024 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, opts.timeout);

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < maxBuffer) stdout += asText(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxBuffer) stderr += asText(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 1,
        signal: undefined,
        stderr: error.message,
        stdout,
        timedOut,
      });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: typeof code === "number" ? code : 1,
        signal: signal ?? undefined,
        stderr,
        stdout,
        timedOut,
      });
    });
  });
}

function providerUsageWithinCap(usage) {
  return usage.confluence <= 1 && usage.figma <= 1;
}

function smokeRunId(env) {
  return (env.PANDO_SMOKE_RUN_ID ?? `run-${process.pid}-${Date.now()}`).replace(
    /[^A-Za-z0-9._-]+/g,
    "-",
  );
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function globalConcurrencyCheck(env) {
  const globalConcurrency = Number.parseInt(env.PANDO_GLOBAL_CONCURRENCY ?? "", 10);
  const withinLiveCap = [2, 3].includes(globalConcurrency);
  return {
    blockers: withinLiveCap ? [] : ["PANDO_GLOBAL_CONCURRENCY must be 2 or 3"],
    check: {
      value: Number.isNaN(globalConcurrency) ? null : globalConcurrency,
      withinLiveCap,
    },
  };
}

function workerCliCheck(env) {
  const commands = Object.fromEntries(
    ["claude", "codex"].map((command) => [command, commandEvidence(command, env)]),
  );
  const blockers = Object.entries(commands)
    .filter(([, evidence]) => !evidence.available)
    .map(([command]) => `${command} CLI is not available`);

  return {
    blockers,
    check: {
      commands,
      pass: blockers.length === 0,
    },
  };
}

function commandEvidence(command, env) {
  const path = findCommand(command, env.PATH ?? "");
  if (path === null) {
    return { available: false, path: null, version: null };
  }

  const version = spawnSync(command, ["--version"], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  const versionText = `${version.stdout}${version.stderr}`.trim().split("\n")[0] ?? null;

  return {
    available: true,
    path,
    version: version.status === 0 && versionText !== "" ? versionText : null,
  };
}

function findCommand(command, pathValue) {
  for (const pathEntry of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(pathEntry, command);
    if (pathExists(candidate) && !pathIsDirectory(candidate)) {
      return candidate;
    }
  }
  return null;
}

function workerAuthCheck(env) {
  const home = env.HOME ?? homedir();
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
  const codexConfigDir = env.CODEX_HOME ?? join(home, ".codex");
  const claude = {
    apiKeyPresent: env.ANTHROPIC_API_KEY !== undefined,
    configDirPresent: pathExists(resolvePath(claudeConfigDir)),
  };
  const codex = {
    apiKeyPresent: env.OPENAI_API_KEY !== undefined,
    configDirPresent: pathExists(resolvePath(codexConfigDir)),
  };
  const blockers = [];
  if (!claude.apiKeyPresent && !claude.configDirPresent) {
    blockers.push("Claude authentication is not configured");
  }
  if (!codex.apiKeyPresent && !codex.configDirPresent) {
    blockers.push("Codex authentication is not configured");
  }

  return {
    blockers,
    check: {
      pass: blockers.length === 0,
      signals: { claude, codex },
    },
  };
}

function mountContractCheck(env, target) {
  const home = env.HOME ?? homedir();
  const docker = target === "docker";
  const sqlitePath = resolvePath(
    env.PANDO_DB ?? (docker ? "/data/pando.sqlite" : "./pando.sqlite"),
  );
  const paths = {
    config: pathCheck(resolvePath(env.PANDO_CONFIG_DIR ?? (docker ? "/config" : "config"))),
    repos: pathCheck(
      resolvePath(env.PANDO_REPOS_ROOT ?? (docker ? "/repos" : join(home, "Github"))),
    ),
    skills: pathCheck(
      resolvePath(env.PANDO_SKILLS_ROOT ?? (docker ? "/skills" : join(home, ".ai-skills"))),
    ),
    sqlite: sqlitePathCheck(sqlitePath),
    worktrees: pathCheck(
      resolvePath(env.PANDO_WORKTREE_ROOT ?? (docker ? "/worktrees" : join(home, ".worktrees"))),
    ),
  };
  const blockers = Object.entries(paths)
    .filter(([, evidence]) => !evidence.ready)
    .map(([name, evidence]) => `${name} path is not ready: ${evidence.path}`);

  return {
    blockers,
    check: {
      pass: blockers.length === 0,
      paths,
    },
  };
}

function pathCheck(path) {
  return { exists: pathExists(path), path, ready: pathExists(path) };
}

function sqlitePathCheck(path) {
  const parent = dirname(path);
  return { parentExists: pathExists(parent), path, ready: pathExists(parent) };
}

function resolvePath(path) {
  if (path === "~") {
    return homedir();
  }
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  return resolve(path);
}

function pathExists(path) {
  return existsSync(path);
}

function pathIsDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function asText(value) {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

function fakeEvidence(fallbackReason, readiness) {
  const jobs = [
    fakeJob("SMOKE-FAKE-1", "/worktrees/smoke-repo/feat-SMOKE-FAKE-1"),
    fakeJob("SMOKE-FAKE-2", "/worktrees/smoke-repo/feat-SMOKE-FAKE-2"),
  ];

  return {
    checks: {
      gateEvidence: { pass: jobs.every((job) => job.gateEvidence.length > 0) },
      globalConcurrency: { value: 2, withinLiveCap: true },
      providerCap: { pass: true },
      worktreeCollision: {
        pass: new Set(jobs.map((job) => job.worktreePath)).size === jobs.length,
      },
    },
    fallback: { reason: fallbackReason },
    jobs,
    mode: "fake",
    ...(readiness === undefined ? {} : { readiness }),
    schemaVersion: 1,
  };
}

function fakeJob(id, worktreePath) {
  return {
    gateEvidence: [
      {
        evidence: "exitCode=0",
        gateName: "exit-code",
        stage: "TEST",
      },
      {
        evidence: "checksumManifest=stable",
        gateName: "checksum",
        stage: "IMPL",
      },
    ],
    id,
    providerUsage: { confluence: 1, figma: 0 },
    repo: "smoke-repo",
    worktreePath,
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--mode" || token === "--evidence" || token === "--target") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${token}: expected value`);
      }
      parsed[token.slice(2)] = value;
      index += 1;
    }
  }
  return parsed;
}
