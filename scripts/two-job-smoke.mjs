#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const args = parseArgs(process.argv.slice(2));
const requestedMode = args.mode ?? (process.env.PANDO_LIVE_SMOKE === "1" ? "live" : "fake");
const evidencePath = resolve(args.evidence ?? "smoke/evidence/two-job-smoke.json");

const evidence =
  requestedMode === "live"
    ? liveOrFallbackEvidence(process.env)
    : fakeEvidence("deterministic fake smoke requested");

await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`wrote ${evidence.mode} two-job smoke evidence: ${evidencePath}`);

function liveOrFallbackEvidence(env) {
  const missing = liveReadinessFailures(env);
  if (missing.length > 0) {
    return fakeEvidence(`live smoke prerequisites missing: ${missing.join(", ")}`);
  }

  return fakeEvidence(
    "live smoke runner is intentionally manual in W5; use docs/runbooks/two-job-smoke.md",
  );
}

function liveReadinessFailures(env) {
  const failures = [];
  const globalConcurrency = Number.parseInt(env.PANDO_GLOBAL_CONCURRENCY ?? "", 10);
  if (![2, 3].includes(globalConcurrency)) {
    failures.push("PANDO_GLOBAL_CONCURRENCY must be 2 or 3");
  }
  if (env.ANTHROPIC_API_KEY === undefined && env.CLAUDE_CONFIG_DIR === undefined) {
    failures.push("Claude authentication is not configured");
  }
  if (env.OPENAI_API_KEY === undefined && env.CODEX_HOME === undefined) {
    failures.push("Codex authentication is not configured");
  }
  return failures;
}

function fakeEvidence(fallbackReason) {
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
    if (token === "--mode" || token === "--evidence") {
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
