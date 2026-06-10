import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("two-job smoke contract", () => {
  it("defaults evidence to tmp instead of writing smoke artifacts into the cwd", () => {
    const cwd = mkdtempSync(join(tmpdir(), "pando-smoke-cwd-"));
    const scriptPath = resolve("scripts/two-job-smoke.mjs");

    const output = execFileSync(process.execPath, [scriptPath, "--mode", "fake"], {
      cwd,
      encoding: "utf8",
    });

    expect(output).toContain("/tmp/pando-two-job-smoke/two-job-smoke.json");
    expect(existsSync(join(cwd, "smoke"))).toBe(false);
  });

  it("documents the live-smoke limits and deterministic fallback requirements", () => {
    const contract = JSON.parse(readFileSync("smoke/two-job-smoke.contract.json", "utf8")) as {
      checks: Array<{ id: string }>;
      fallback: { allowed: boolean; recordReason: boolean };
      jobs: { requiredCount: number };
      limits: { globalConcurrency: { max: number; min: number } };
      live: {
        requiredEnv: string[];
        workerProbe: {
          deterministicEvidence: string[];
          gateName: string;
          requiredJobIds: string[];
        };
      };
      readiness: {
        authSignals: string[];
        gitCredentialSignals: string[];
        requiredChecks: string[];
        workerCommands: string[];
      };
    };

    expect(contract.jobs.requiredCount).toBe(2);
    expect(contract.limits.globalConcurrency).toEqual({ max: 3, min: 2 });
    expect(contract.live.requiredEnv).toEqual(
      expect.arrayContaining([
        "PANDO_LIVE_SMOKE=1",
        "PANDO_GLOBAL_CONCURRENCY=2 or 3",
        "Codex/OpenAI authentication or API key mode",
      ]),
    );
    expect(contract.live.workerProbe).toEqual({
      deterministicEvidence: ["exitCode", "timedOut", "signal"],
      gateName: "worker-exit-code",
      requiredJobIds: ["SMOKE-LIVE-CODEX-1", "SMOKE-LIVE-CODEX-2"],
    });
    expect(contract.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "two-jobs-recorded",
        "worktree-collision",
        "provider-cap",
        "gate-evidence",
      ]),
    );
    expect(contract.fallback).toEqual({ allowed: true, recordReason: true });
    expect(contract.readiness).toEqual({
      authSignals: [
        "ANTHROPIC_API_KEY",
        "CLAUDE_CONFIG_DIR",
        "CLAUDE_CONFIG_FILE",
        "Claude config file present",
        "Claude config file non-empty",
        "OPENAI_API_KEY",
        "CODEX_HOME",
        "Codex config dir writable",
      ],
      gitCredentialSignals: [
        "PANDO_DEPLOY_KEY",
        "PANDO_SSH_KNOWN_HOSTS",
        "PANDO_GIT_CREDENTIALS",
        "PANDO_GITCONFIG",
        "GH_TOKEN",
        "GITHUB_TOKEN",
      ],
      requiredChecks: [
        "global-concurrency",
        "worker-cli",
        "worker-auth",
        "git-credentials",
        "mount-contract",
      ],
      workerCommands: ["codex"],
    });
  });

  it("runs the deterministic fake smoke and records two non-colliding jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-smoke-"));
    const evidencePath = join(dir, "fake-smoke.json");

    execFileSync("node", [
      "scripts/two-job-smoke.mjs",
      "--mode",
      "fake",
      "--evidence",
      evidencePath,
    ]);

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      checks: {
        gateEvidence: { pass: boolean };
        globalConcurrency: { value: number; withinLiveCap: boolean };
        providerCap: { pass: boolean };
        worktreeCollision: { pass: boolean };
      };
      jobs: Array<{ id: string; worktreePath: string }>;
      mode: string;
    };

    expect(evidence.mode).toBe("fake");
    expect(evidence.jobs.map((job) => job.id)).toEqual(["SMOKE-FAKE-1", "SMOKE-FAKE-2"]);
    expect(new Set(evidence.jobs.map((job) => job.worktreePath)).size).toBe(2);
    expect(evidence.checks).toEqual({
      gateEvidence: { pass: true },
      globalConcurrency: { value: 2, withinLiveCap: true },
      providerCap: { pass: true },
      worktreeCollision: { pass: true },
    });
  });

  it("records host worker readiness as structured evidence without secret values", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-readiness-"));
    const evidencePath = join(dir, "readiness.json");
    const fakeBin = join(dir, "bin");
    const configDir = join(dir, "config");
    const dataDir = join(dir, "data");
    const reposDir = join(dir, "repos");
    const worktreesDir = join(dir, "worktrees");
    const homeDir = join(dir, "home");
    const skillsDir = join(dir, "skills");

    mkdirSync(fakeBin);
    mkdirSync(configDir);
    mkdirSync(dataDir);
    mkdirSync(homeDir);
    mkdirSync(reposDir);
    mkdirSync(worktreesDir);
    mkdirSync(skillsDir);
    for (const command of ["codex"]) {
      const commandPath = join(fakeBin, command);
      writeFileSync(commandPath, "#!/bin/sh\nprintf '%s fake\\n' \"$0\"\n");
      chmodSync(commandPath, 0o755);
    }
    const deployKeyPath = join(dir, "deploy_key");
    writeFileSync(deployKeyPath, "PRIVATE-KEY-SECRET-DO-NOT-LEAK");
    chmodSync(deployKeyPath, 0o600);

    execFileSync(
      process.execPath,
      [
        "scripts/two-job-smoke.mjs",
        "--mode",
        "readiness",
        "--target",
        "host",
        "--evidence",
        evidencePath,
      ],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          OPENAI_API_KEY: "redacted",
          PANDO_CONFIG_DIR: configDir,
          PANDO_DB: join(dataDir, "pando.sqlite"),
          PANDO_DEPLOY_KEY: deployKeyPath,
          PANDO_GLOBAL_CONCURRENCY: "2",
          PANDO_REPOS_ROOT: reposDir,
          PANDO_SKILLS_ROOT: skillsDir,
          PANDO_WORKTREE_ROOT: worktreesDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      blockers: string[];
      checks: {
        auth: {
          pass: boolean;
          signals: {
            claude: { apiKeyPresent: boolean; configDirPresent: boolean };
            codex: { apiKeyPresent: boolean; configDirPresent: boolean };
          };
        };
        gitCreds: {
          pass: boolean;
          signals: {
            credentialStorePresent: boolean;
            deployKeyPath: null | string;
            deployKeyPresent: boolean;
            gitconfigPresent: boolean;
            knownHostsPresent: boolean;
            tokenEnvPresent: boolean;
          };
        };
        globalConcurrency: { value: number; withinLiveCap: boolean };
        mounts: { pass: boolean };
        workerCli: { pass: boolean };
      };
      mode: string;
      target: string;
    };

    expect(evidence.mode).toBe("readiness");
    expect(evidence.target).toBe("host");
    expect(evidence.blockers).toEqual([]);
    expect(evidence.checks.globalConcurrency).toEqual({
      value: 2,
      withinLiveCap: true,
    });
    expect(evidence.checks.workerCli.pass).toBe(true);
    expect(evidence.checks.auth.pass).toBe(true);
    expect(evidence.checks.auth.signals.claude).toMatchObject({
      apiKeyPresent: false,
      configDirPresent: false,
    });
    expect(evidence.checks.auth.signals.codex).toMatchObject({
      apiKeyPresent: true,
      configDirPresent: false,
    });
    expect(evidence.checks.mounts.pass).toBe(true);
    expect(evidence.checks.gitCreds.pass).toBe(true);
    expect(evidence.checks.gitCreds.signals.deployKeyPresent).toBe(true);
    expect(evidence.checks.gitCreds.signals.deployKeyPath).toBe(deployKeyPath);
    expect(evidence.checks.gitCreds.signals.credentialStorePresent).toBe(false);
    expect(evidence.checks.gitCreds.signals.tokenEnvPresent).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain("redacted");
    expect(JSON.stringify(evidence)).not.toContain("PRIVATE-KEY-SECRET");
  });

  it("does not treat Docker auth directories alone as live-ready", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-docker-auth-"));
    const evidencePath = join(dir, "readiness.json");
    const fakeBin = join(dir, "bin");
    const claudeDir = join(dir, "claude");
    const codexDir = join(dir, "codex");
    const configDir = join(dir, "config");
    const dataDir = join(dir, "data");
    const homeDir = join(dir, "home");
    const reposDir = join(dir, "repos");
    const skillsDir = join(dir, "skills");
    const worktreesDir = join(dir, "worktrees");

    for (const made of [
      fakeBin,
      claudeDir,
      codexDir,
      configDir,
      dataDir,
      homeDir,
      reposDir,
      skillsDir,
      worktreesDir,
    ]) {
      mkdirSync(made);
    }
    for (const command of ["codex"]) {
      const commandPath = join(fakeBin, command);
      writeFileSync(commandPath, "#!/bin/sh\nexit 0\n");
      chmodSync(commandPath, 0o755);
    }
    chmodSync(codexDir, 0o555);

    try {
      execFileSync(
        process.execPath,
        [
          "scripts/two-job-smoke.mjs",
          "--mode",
          "readiness",
          "--target",
          "docker",
          "--evidence",
          evidencePath,
        ],
        {
          env: {
            ...process.env,
            CODEX_HOME: codexDir,
            HOME: homeDir,
            PANDO_CONFIG_DIR: configDir,
            PANDO_DB: join(dataDir, "pando.sqlite"),
            PANDO_GLOBAL_CONCURRENCY: "2",
            PANDO_REPOS_ROOT: reposDir,
            PANDO_SKILLS_ROOT: skillsDir,
            PANDO_WORKTREE_ROOT: worktreesDir,
            PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
          },
        },
      );
    } finally {
      chmodSync(codexDir, 0o755);
    }

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      blockers: string[];
      checks: {
        auth: {
          pass: boolean;
          signals: {
            claude: {
              apiKeyPresent: boolean;
              configDirPresent: boolean;
              configFilePresent: boolean;
              configFileNonEmpty: boolean;
            };
            codex: {
              apiKeyPresent: boolean;
              configDirPresent: boolean;
              configDirWritable: boolean;
            };
          };
        };
      };
      target: string;
    };

    expect(evidence.target).toBe("docker");
    expect(evidence.checks.auth.pass).toBe(false);
    expect(evidence.checks.auth.signals.claude).toEqual({
      apiKeyPresent: false,
      configDirPresent: false,
      configFilePresent: false,
      configFileNonEmpty: false,
    });
    expect(evidence.checks.auth.signals.codex).toEqual({
      apiKeyPresent: false,
      configDirPresent: true,
      configDirWritable: false,
    });
    expect(evidence.blockers).toEqual(
      expect.arrayContaining(["Codex authentication is not configured"]),
    );
    expect(evidence.blockers).not.toContain("Claude authentication is not configured");
  });

  it("records an empty Claude config file without making it a Codex readiness blocker", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-docker-empty-claude-config-"));
    const evidencePath = join(dir, "readiness.json");
    const fakeBin = join(dir, "bin");
    const claudeDir = join(dir, "claude");
    const codexDir = join(dir, "codex");
    const configDir = join(dir, "config");
    const dataDir = join(dir, "data");
    const homeDir = join(dir, "home");
    const reposDir = join(dir, "repos");
    const skillsDir = join(dir, "skills");
    const worktreesDir = join(dir, "worktrees");

    for (const made of [
      fakeBin,
      claudeDir,
      codexDir,
      configDir,
      dataDir,
      homeDir,
      reposDir,
      skillsDir,
      worktreesDir,
    ]) {
      mkdirSync(made);
    }
    for (const command of ["claude", "codex"]) {
      const commandPath = join(fakeBin, command);
      writeFileSync(commandPath, "#!/bin/sh\nexit 0\n");
      chmodSync(commandPath, 0o755);
    }
    writeFileSync(join(claudeDir, ".claude.json"), "");

    execFileSync(
      process.execPath,
      [
        "scripts/two-job-smoke.mjs",
        "--mode",
        "readiness",
        "--target",
        "docker",
        "--evidence",
        evidencePath,
      ],
      {
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: claudeDir,
          CODEX_HOME: codexDir,
          HOME: homeDir,
          PANDO_CONFIG_DIR: configDir,
          PANDO_DB: join(dataDir, "pando.sqlite"),
          PANDO_GLOBAL_CONCURRENCY: "2",
          PANDO_REPOS_ROOT: reposDir,
          PANDO_SKILLS_ROOT: skillsDir,
          PANDO_WORKTREE_ROOT: worktreesDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      blockers: string[];
      checks: {
        auth: {
          pass: boolean;
          signals: {
            claude: {
              apiKeyPresent: boolean;
              configDirPresent: boolean;
              configFileNonEmpty: boolean;
              configFilePresent: boolean;
            };
          };
        };
      };
    };

    expect(evidence.checks.auth.pass).toBe(true);
    expect(evidence.checks.auth.signals.claude).toEqual({
      apiKeyPresent: false,
      configDirPresent: true,
      configFileNonEmpty: false,
      configFilePresent: true,
    });
    expect(evidence.blockers).not.toContain("Claude authentication is not configured");
  });

  it("records a git-credentials readiness signal without making it a hard live blocker", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-gitcreds-"));
    const evidencePath = join(dir, "readiness.json");
    const fakeBin = join(dir, "bin");
    const configDir = join(dir, "config");
    const dataDir = join(dir, "data");
    const homeDir = join(dir, "home");
    const reposDir = join(dir, "repos");
    const skillsDir = join(dir, "skills");
    const worktreesDir = join(dir, "worktrees");

    for (const made of [fakeBin, configDir, dataDir, homeDir, reposDir, skillsDir, worktreesDir]) {
      mkdirSync(made);
    }
    for (const command of ["claude", "codex"]) {
      const commandPath = join(fakeBin, command);
      writeFileSync(commandPath, "#!/bin/sh\nexit 0\n");
      chmodSync(commandPath, 0o755);
    }

    execFileSync(
      process.execPath,
      [
        "scripts/two-job-smoke.mjs",
        "--mode",
        "readiness",
        "--target",
        "docker",
        "--evidence",
        evidencePath,
      ],
      {
        env: {
          ANTHROPIC_API_KEY: "redacted",
          HOME: homeDir,
          OPENAI_API_KEY: "redacted",
          PANDO_CONFIG_DIR: configDir,
          PANDO_DB: join(dataDir, "pando.sqlite"),
          PANDO_GLOBAL_CONCURRENCY: "2",
          PANDO_REPOS_ROOT: reposDir,
          PANDO_SKILLS_ROOT: skillsDir,
          PANDO_WORKTREE_ROOT: worktreesDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      blockers: string[];
      checks: { gitCreds: { pass: boolean } };
      target: string;
    };

    expect(evidence.target).toBe("docker");
    expect(evidence.checks.gitCreds.pass).toBe(false);
    expect(evidence.blockers).toEqual([]);
  });

  it("records readiness blockers when live smoke falls back", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-live-fallback-"));
    const evidencePath = join(dir, "live-fallback.json");
    const homeDir = join(dir, "home");
    mkdirSync(homeDir);

    execFileSync(
      process.execPath,
      [
        "scripts/two-job-smoke.mjs",
        "--mode",
        "live",
        "--target",
        "host",
        "--evidence",
        evidencePath,
      ],
      {
        env: {
          HOME: homeDir,
          PATH: process.env.PATH,
          PANDO_GLOBAL_CONCURRENCY: "6",
        },
      },
    );

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      fallback: { reason: string };
      mode: string;
      readiness: { blockers: string[] };
    };

    expect(evidence.mode).toBe("fake");
    expect(evidence.fallback.reason).toBe("live smoke prerequisites missing");
    expect(evidence.readiness.blockers).toContain("PANDO_GLOBAL_CONCURRENCY must be 2 or 3");
    expect(evidence.readiness.blockers).toEqual(
      expect.arrayContaining(["Codex authentication is not configured"]),
    );
    expect(evidence.readiness.blockers).not.toContain("Claude authentication is not configured");
  });

  it("runs two live worker probes when readiness passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-live-probe-"));
    const evidencePath = join(dir, "live.json");
    const fakeBin = join(dir, "bin");
    const configDir = join(dir, "config");
    const dataDir = join(dir, "data");
    const homeDir = join(dir, "home");
    const reposDir = join(dir, "repos");
    const skillsDir = join(dir, "skills");
    const worktreesDir = join(dir, "worktrees");

    mkdirSync(fakeBin);
    mkdirSync(configDir);
    mkdirSync(dataDir);
    mkdirSync(homeDir);
    mkdirSync(reposDir);
    mkdirSync(skillsDir);
    mkdirSync(worktreesDir);
    for (const command of ["codex"]) {
      const commandPath = join(fakeBin, command);
      writeFileSync(
        commandPath,
        [
          "#!/bin/sh",
          'args=" $* "',
          'case "$args" in *" --ephemeral "*) ;; *) echo "missing --ephemeral" >&2; exit 20;; esac',
          'case "$args" in *" --cd "*) ;; *) echo "missing --cd" >&2; exit 21;; esac',
          'case "$args" in *" approval_policy=\\"never\\" "*) ;; *) echo "missing approval_policy never" >&2; exit 22;; esac',
          'case "$args" in *" --json "*) ;; *) echo "missing --json" >&2; exit 23;; esac',
          'case "$args" in *" --sandbox workspace-write "*) ;; *) echo "missing workspace sandbox" >&2; exit 24;; esac',
          "printf '%s ok\\n' \"$0\"",
        ].join("\n"),
      );
      chmodSync(commandPath, 0o755);
    }

    execFileSync(
      process.execPath,
      [
        "scripts/two-job-smoke.mjs",
        "--mode",
        "live",
        "--target",
        "host",
        "--evidence",
        evidencePath,
      ],
      {
        env: {
          ...process.env,
          HOME: homeDir,
          OPENAI_API_KEY: "redacted",
          PANDO_CONFIG_DIR: configDir,
          PANDO_DB: join(dataDir, "pando.sqlite"),
          PANDO_GLOBAL_CONCURRENCY: "2",
          PANDO_REPOS_ROOT: reposDir,
          PANDO_SKILLS_ROOT: skillsDir,
          PANDO_SMOKE_RUN_ID: "unit",
          PANDO_WORKTREE_ROOT: worktreesDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      checks: {
        gateEvidence: { pass: boolean };
        globalConcurrency: { value: number; withinLiveCap: boolean };
        providerCap: { pass: boolean };
        worktreeCollision: { pass: boolean };
      };
      jobs: Array<{
        gateEvidence: Array<{
          evidence: string;
          gateName: string;
          stage: string;
        }>;
        id: string;
        worker: { engine: string; exitCode: number };
        worktreePath: string;
      }>;
      mode: string;
      readiness: { blockers: string[] };
    };

    expect(evidence.mode).toBe("live");
    expect(evidence.readiness.blockers).toEqual([]);
    expect(evidence.jobs.map((job) => job.id)).toEqual([
      "SMOKE-LIVE-CODEX-1",
      "SMOKE-LIVE-CODEX-2",
    ]);
    expect(new Set(evidence.jobs.map((job) => job.worktreePath)).size).toBe(2);
    expect(evidence.jobs.map((job) => job.worker.exitCode)).toEqual([0, 0]);
    expect(evidence.jobs.map((job) => job.worker.engine)).toEqual(["codex", "codex"]);
    expect(evidence.jobs.map((job) => job.gateEvidence[0]?.evidence)).toEqual([
      '{"exitCode":0,"timedOut":false}',
      '{"exitCode":0,"timedOut":false}',
    ]);
    expect(evidence.checks).toEqual({
      gateEvidence: { pass: true },
      globalConcurrency: { value: 2, withinLiveCap: true },
      providerCap: { pass: true },
      worktreeCollision: { pass: true },
    });
    expect(JSON.stringify(evidence)).not.toContain("redacted");
  });

  it("classifies a Docker Codex live failure without recording worker output", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-docker-codex-live-blocker-"));
    const evidencePath = join(dir, "live.json");
    const fakeBin = join(dir, "bin");
    const claudeDir = join(dir, "claude");
    const codexDir = join(dir, "codex");
    const configDir = join(dir, "config");
    const dataDir = join(dir, "data");
    const homeDir = join(dir, "home");
    const reposDir = join(dir, "repos");
    const skillsDir = join(dir, "skills");
    const worktreesDir = join(dir, "worktrees");

    for (const made of [
      fakeBin,
      claudeDir,
      codexDir,
      configDir,
      dataDir,
      homeDir,
      reposDir,
      skillsDir,
      worktreesDir,
    ]) {
      mkdirSync(made);
    }
    writeFileSync(
      join(fakeBin, "codex"),
      "#!/bin/sh\ncase \"$PWD\" in *codex-1) printf 'Codex auth secret-like text\\n'; exit 1;; *) printf 'codex ok\\n'; exit 0;; esac\n",
    );
    chmodSync(join(fakeBin, "codex"), 0o755);
    mkdirSync(join(homeDir, ".claude"));
    writeFileSync(join(homeDir, ".claude.json"), "{}");

    execFileSync(
      process.execPath,
      [
        "scripts/two-job-smoke.mjs",
        "--mode",
        "live",
        "--target",
        "docker",
        "--evidence",
        evidencePath,
      ],
      {
        env: {
          ...process.env,
          CODEX_HOME: codexDir,
          HOME: homeDir,
          PANDO_CONFIG_DIR: configDir,
          PANDO_DB: join(dataDir, "pando.sqlite"),
          PANDO_GLOBAL_CONCURRENCY: "2",
          PANDO_REPOS_ROOT: reposDir,
          PANDO_SKILLS_ROOT: skillsDir,
          PANDO_SMOKE_RUN_ID: "unit-docker",
          PANDO_WORKTREE_ROOT: worktreesDir,
          PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        },
      },
    );

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      blockers: Array<{
        evidence: { exitCode: number; timedOut: boolean };
        jobId: string;
        kind: string;
        nextCommands: string[];
        reason: string;
      }>;
      checks: { gateEvidence: { pass: boolean } };
      jobs: Array<{ id: string; worker: { exitCode: number; stdoutBytes: number } }>;
      mode: string;
    };

    expect(evidence.mode).toBe("live");
    expect(evidence.jobs.map((job) => [job.id, job.worker.exitCode])).toEqual([
      ["SMOKE-LIVE-CODEX-1", 1],
      ["SMOKE-LIVE-CODEX-2", 0],
    ]);
    expect(evidence.checks.gateEvidence.pass).toBe(false);
    expect(evidence.blockers).toEqual([
      expect.objectContaining({
        evidence: { exitCode: 1, timedOut: false },
        jobId: "SMOKE-LIVE-CODEX-1",
        kind: "codex-live-worker",
        nextCommands: expect.arrayContaining([
          expect.stringContaining("OPENAI_API_KEY"),
          expect.stringContaining("Codex auth"),
        ]),
      }),
    ]);
    expect(JSON.stringify(evidence)).not.toContain("Codex auth secret-like text");
  });
});
