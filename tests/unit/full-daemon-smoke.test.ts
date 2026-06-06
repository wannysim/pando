import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runHostFullDaemonSmoke } from "../../src/daemon/full-daemon-smoke";
import type { EnsureWorktreeOptions, EnsureWorktreeResult } from "../../src/worktree/manager";

describe("runHostFullDaemonSmoke", () => {
  it("runs exactly two pando brief jobs through the host daemon wiring contract", async () => {
    const root = mkdtempSync(join(tmpdir(), "pando-full-daemon-smoke-test-"));
    const evidencePath = join(root, "evidence.json");
    const dbPath = join(root, "pando.sqlite");
    const worktreeRoot = join(root, "worktrees");
    const provisioned: EnsureWorktreeOptions[] = [];
    const workerCalls: Array<{ args: string[]; command: string; cwd: string }> = [];
    const gateCalls: Array<{ command: string; cwd: string }> = [];

    const evidence = await runHostFullDaemonSmoke({
      clock: sequenceClock(),
      dbPath,
      engineRunners: {
        async claude(command, args, opts) {
          workerCalls.push({ args, command, cwd: opts.cwd });
          return {
            exitCode: 0,
            stderr: "do-not-record-worker-output",
            stdout: "do-not-record-worker-output",
          };
        },
        async codex(command, args, opts) {
          workerCalls.push({ args, command, cwd: opts.cwd });
          return {
            exitCode: 0,
            stderr: "do-not-record-worker-output",
            stdout: '{"message":"do-not-record-worker-output","cost_usd":0.01}\n',
          };
        },
      },
      ensureWorktree: async (opts): Promise<EnsureWorktreeResult> => {
        provisioned.push(opts);
        const path = join(worktreeRoot, "pando", opts.branch.replaceAll("/", "-"));
        mkdirSync(path, { recursive: true });
        return { branch: opts.branch, path, reused: false };
      },
      evidencePath,
      gateRunner: async (command, opts) => {
        gateCalls.push({ command, cwd: opts.cwd });
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      globalConcurrency: 2,
      mode: "contract",
      now: () => "2026-06-07T00:00:00.000Z",
      repoRoot: process.cwd(),
      runId: "unit",
      worktreeRoot,
    });

    expect(evidence).toMatchObject({
      checks: {
        gateEvidence: { pass: true },
        globalConcurrency: { value: 2, withinLiveCap: true },
        providerCap: { pass: true },
        twoJobsClaimed: { actual: 2, expected: 2, pass: true },
        worktreeCollision: { pass: true },
      },
      mode: "contract",
      schemaVersion: 1,
      target: "host",
    });
    expect(evidence.jobs.map((job) => job.id)).toEqual([
      "PANDO-FULL-SMOKE-1",
      "PANDO-FULL-SMOKE-2",
    ]);
    expect(evidence.jobs.map((job) => job.finalStatus)).toEqual(["DONE", "DONE"]);
    expect(new Set(evidence.jobs.map((job) => job.worktreePath)).size).toBe(2);
    expect(evidence.jobs.every((job) => job.gateEvidence.length === 3)).toBe(true);
    expect(evidence.jobs[0]?.gateEvidence[0]?.evidence).toMatchObject({
      command: "pnpm test",
      exitCode: 0,
    });

    expect(provisioned).toHaveLength(2);
    expect(provisioned.map((opts) => opts.baseBranch)).toEqual(["develop", "develop"]);
    expect(provisioned.map((opts) => opts.setupCommand)).toEqual(["pnpm install", "pnpm install"]);
    expect(new Set(workerCalls.map((call) => call.command))).toEqual(new Set(["claude"]));
    expect(gateCalls.map((call) => call.command)).toEqual(
      expect.arrayContaining(["pnpm test", "pnpm lint", "pnpm exec tsc --noEmit"]),
    );
    expect(JSON.parse(readFileSync(evidencePath, "utf8"))).toEqual(evidence);
    expect(JSON.stringify(evidence)).not.toContain("do-not-record-worker-output");
  });

  it("uses contract runners by default and sanitizes the smoke run id", async () => {
    const root = mkdtempSync(join(tmpdir(), "pando-full-daemon-smoke-default-"));
    const worktreeRoot = join(root, "worktrees");

    const evidence = await runHostFullDaemonSmoke({
      dbPath: join(root, "pando.sqlite"),
      ensureWorktree: fakeEnsureWorktree(worktreeRoot),
      evidencePath: join(root, "evidence.json"),
      now: () => "2026-06-07T00:00:00.000Z",
      repoRoot: process.cwd(),
      runId: "unit default/id",
      worktreeRoot,
    });

    expect(evidence.mode).toBe("contract");
    expect(evidence.runId).toBe("unit-default-id");
    expect(evidence.checks.twoJobsClaimed).toEqual({ actual: 2, expected: 2, pass: true });
    expect(evidence.jobs.map((job) => job.finalStatus)).toEqual(["DONE", "DONE"]);
  });

  it("supports live mode wiring with injected process runners", async () => {
    const root = mkdtempSync(join(tmpdir(), "pando-full-daemon-smoke-live-"));
    const worktreeRoot = join(root, "worktrees");
    const commands: string[] = [];

    const evidence = await runHostFullDaemonSmoke({
      dbPath: join(root, "pando.sqlite"),
      engineRunners: {
        async claude(command) {
          commands.push(command);
          return { exitCode: 0, stderr: "", stdout: "" };
        },
        async codex(command) {
          commands.push(command);
          return { exitCode: 0, stderr: "", stdout: '{"message":"ok"}\n' };
        },
      },
      ensureWorktree: fakeEnsureWorktree(worktreeRoot),
      evidencePath: join(root, "evidence.json"),
      gateRunner: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      mode: "live",
      now: () => "2026-06-07T00:00:00.000Z",
      repoRoot: process.cwd(),
      runId: "unit-live",
      worktreeRoot,
    });

    expect(evidence.mode).toBe("live");
    expect(new Set(commands)).toEqual(new Set(["claude"]));
    expect(evidence.checks.gateEvidence.pass).toBe(true);
  });

  it("can use the live shell gate runner without calling live worker CLIs", async () => {
    const root = mkdtempSync(join(tmpdir(), "pando-full-daemon-smoke-shell-gate-"));
    const configDir = join(root, "config");
    const worktreeRoot = join(root, "worktrees");
    mkdirSync(configDir);
    writeSmokeConfig(configDir, join(root, "target-repo"));

    const evidence = await runHostFullDaemonSmoke({
      configDir,
      dbPath: join(root, "pando.sqlite"),
      engineRunners: {
        async claude() {
          return { exitCode: 0, stderr: "", stdout: "" };
        },
        async codex() {
          return { exitCode: 0, stderr: "", stdout: '{"message":"ok"}\n' };
        },
      },
      ensureWorktree: async (opts): Promise<EnsureWorktreeResult> => {
        const path = join(worktreeRoot, "pando", opts.branch.replaceAll("/", "-"));
        mkdirSync(path, { recursive: true });
        writeFileSync(
          join(path, "package.json"),
          JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
        );
        return { branch: opts.branch, path, reused: false };
      },
      evidencePath: join(root, "evidence.json"),
      mode: "live",
      now: () => "2026-06-07T00:00:00.000Z",
      repoRoot: process.cwd(),
      runId: "unit-shell-gate",
      worktreeRoot,
    });

    expect(evidence.mode).toBe("live");
    expect(evidence.jobs.map((job) => job.finalStatus)).toEqual(["DONE", "DONE"]);
    expect(evidence.jobs[0]?.gateEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidence: { command: "npm run test", exitCode: 0 },
          gateName: "test-exit-code",
        }),
        expect.objectContaining({
          evidence: "lint gate is not configured",
          gateName: "lint-exit-code",
        }),
      ]),
    );
  });

  it("records uncapped provider usage without failing the provider cap check", async () => {
    const root = mkdtempSync(join(tmpdir(), "pando-full-daemon-smoke-provider-"));
    const configDir = join(root, "config");
    const worktreeRoot = join(root, "worktrees");
    mkdirSync(configDir);
    writeSmokeConfig(configDir, join(root, "target-repo"), "[confluence]");

    const evidence = await runHostFullDaemonSmoke({
      configDir,
      dbPath: join(root, "pando.sqlite"),
      ensureWorktree: fakeEnsureWorktree(worktreeRoot),
      evidencePath: join(root, "evidence.json"),
      gateRunner: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
      now: () => "2026-06-07T00:00:00.000Z",
      repoRoot: process.cwd(),
      runId: "unit-provider",
      worktreeRoot,
    });

    expect(evidence.checks.twoJobsClaimed.pass).toBe(true);
    expect(evidence.checks.providerCap).toEqual({
      pass: true,
      usage: { confluence: 2 },
    });
  });

  it("fails fast when the checked config has no pando self-profile", async () => {
    const root = mkdtempSync(join(tmpdir(), "pando-full-daemon-smoke-missing-profile-"));
    const configDir = join(root, "config");
    mkdirSync(configDir);
    writeFileSync(
      join(configDir, "repos.yaml"),
      `
repos:
  other:
    path: ~/Github/other
    scope: external
    base_branch: main
    intake:
      sources: [brief]
    context:
      providers: []
      policy_refs: []
    conventions: repo-local
    package_manager: pnpm
    setup: install
    gates:
      test: test
    concurrency: 1
    port_range: [3400, 3499]
    guards:
      protected_branches: [main]
      forbid_test_edit_in_impl: true
`,
    );
    writeFileSync(
      join(configDir, "stages.yaml"),
      `
stages:
  spec: { engine: claude-code, model: sonnet }
  plan: { engine: claude-code, model: opus }
  test: { engine: codex, model: gpt-5-codex }
  impl: { engine: codex, model: gpt-5-codex }
  review: { engine: claude-code, model: opus }
  pr: { engine: claude-code, model: sonnet }
defaults:
  retry_budget: 1
  timeout_minutes: 1
`,
    );
    writeFileSync(
      join(configDir, "orchestrator.yaml"),
      `
global_concurrency: 2
worktree_root: ~/.worktrees
skills_root: ~/.ai-skills
providers: {}
db: ./pando.sqlite
`,
    );

    await expect(
      runHostFullDaemonSmoke({
        configDir,
        dbPath: join(root, "pando.sqlite"),
        evidencePath: join(root, "evidence.json"),
        repoRoot: process.cwd(),
      }),
    ).rejects.toThrow("pando repo profile is not configured");
  });
});

function sequenceClock() {
  let value = 0;
  return {
    nowMs() {
      value += 10;
      return value;
    },
  };
}

function fakeEnsureWorktree(worktreeRoot: string) {
  return async (opts: EnsureWorktreeOptions): Promise<EnsureWorktreeResult> => {
    const path = join(worktreeRoot, "pando", opts.branch.replaceAll("/", "-"));
    mkdirSync(path, { recursive: true });
    return { branch: opts.branch, path, reused: false };
  };
}

function writeSmokeConfig(configDir: string, repoPath: string, providers = "[]"): void {
  writeFileSync(
    join(configDir, "repos.yaml"),
    `
repos:
  pando:
    path: ${repoPath}
    scope: external
    base_branch: develop
    intake:
      sources: [brief]
    context:
      providers: ${providers}
      policy_refs: []
    conventions: repo-local
    package_manager: npm
    setup: install
    gates:
      test: test
    concurrency: 2
    port_range: [3300, 3399]
    guards:
      protected_branches: [main, develop]
      forbid_test_edit_in_impl: true
`,
  );
  writeFileSync(
    join(configDir, "stages.yaml"),
    `
stages:
  spec: { engine: claude-code, model: sonnet }
  plan: { engine: claude-code, model: opus }
  test: { engine: codex, model: gpt-5-codex }
  impl: { engine: codex, model: gpt-5-codex }
  review: { engine: claude-code, model: opus }
  pr: { engine: claude-code, model: sonnet }
defaults:
  retry_budget: 1
  timeout_minutes: 1
`,
  );
  writeFileSync(
    join(configDir, "orchestrator.yaml"),
    `
global_concurrency: 2
worktree_root: ~/.worktrees
skills_root: ~/.ai-skills
providers: {}
db: ./pando.sqlite
`,
  );
}
