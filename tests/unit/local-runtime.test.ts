import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WorkerEngine, WorkerRunOptions, WorkerResult } from "../../src/core/types";
import {
  buildLocalPipelinePrompt,
  createLocalDaemonRuntime,
  optionalReadText,
  shellGateRunner,
} from "../../src/daemon/local-runtime";
import { createSqliteJobStore } from "../../src/db/index";
import type { EnsureWorktreeOptions, EnsureWorktreeResult } from "../../src/worktree/manager";

const SPEC = `# Local runner task

## Requirements Overview

- Run the submitted pando brief through the local daemon runtime.
`;

const PLAN = `# [LOCAL-1] Local runner task

## Requirements Overview

- Run the submitted pando brief through the local daemon runtime.

## Implementation Roadmap

> Default shape: one PR with task-sized commits. The roadmap below is split by commit.

### Commit 1: Update local runner wiring

- Add the smallest runtime behavior needed for the submitted brief.

## Acceptance Criteria

- [ ] The queued brief reaches DONE.
- [ ] The PR stage runs as a worker stage.

## Open Questions

- None
`;

describe("createLocalDaemonRuntime", () => {
  it("processes a queued pando brief through PR with injected workers and deterministic gates", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-local-runtime-test-"));
    const configDir = join(root, "config");
    const worktreeRoot = join(root, "worktrees");
    const repoRoot = join(root, "repo");
    const dbPath = join(root, "pando.sqlite");
    const briefPath = join(root, "brief.md");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(repoRoot, { recursive: true });
    writeRuntimeConfig(configDir, repoRoot);
    writeFileSync(briefPath, briefMarkdown());

    const setupCalls: EnsureWorktreeOptions[] = [];
    const workerPrompts: string[] = [];
    const gateCommands: string[] = [];
    const seed = createSqliteJobStore({ path: dbPath });
    seed.enqueueJob({
      item: {
        branch: "chore/local-runner-task",
        id: "LOCAL-RUNNER-1",
        payload: { briefPath, kind: "brief" },
        repo: "pando",
        source: "brief",
        title: "Local runner task",
      },
      retryBudget: 3,
    });
    seed.close();

    const runtime = await createLocalDaemonRuntime({
      configDir,
      dbPath,
      engines: {
        "claude-code": writingEngine(workerPrompts),
        codex: writingEngine(workerPrompts),
      },
      ensureWorktree: async (opts): Promise<EnsureWorktreeResult> => {
        setupCalls.push(opts);
        const path = join(worktreeRoot, "pando", opts.branch.replaceAll("/", "-"));
        mkdirSync(path, { recursive: true });
        return { branch: opts.branch, path, reused: false };
      },
      gateRunner: async (command) => {
        gateCommands.push(command);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      globalConcurrency: 1,
      repoRoot,
      tickMs: 10,
      worktreeRoot,
    });

    await runtime.tick();
    runtime.stop();

    const store = createSqliteJobStore({ path: dbPath });
    const job = store.getJob("LOCAL-RUNNER-1");
    const events = store.listEvents("LOCAL-RUNNER-1");
    store.close();

    expect(job?.status).toBe("DONE");
    expect(setupCalls).toHaveLength(1);
    expect(setupCalls[0]).toMatchObject({
      baseBranch: "develop",
      branch: "chore/local-runner-task",
      repoPath: repoRoot,
    });
    expect(workerPrompts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Stage: SPEC"),
        expect.stringContaining(`Brief path: ${briefPath}`),
        expect.stringContaining("Stage: PR"),
        expect.stringContaining("Create a Draft PR against the repo base branch"),
      ]),
    );
    expect(gateCommands).toEqual(
      expect.arrayContaining(["pnpm test", "pnpm lint", "pnpm exec tsc --noEmit"]),
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "PR", type: "engine-pass" }),
        expect.objectContaining({ stage: "PR", type: "gate-pass" }),
      ]),
    );
  });
});

describe("local runtime helpers", () => {
  it("spells out required artifact sections in SPEC and PLAN prompts", () => {
    const context = {
      item: {
        id: "DEMO-1",
        payload: { briefPath: "/brief.md", kind: "brief" as const },
        repo: "pando",
        source: "brief" as const,
        title: "Demo",
      },
      profile: repoProfile("/repo"),
      worktree: "/worktree",
    };

    expect(buildLocalPipelinePrompt("SPEC", context)).toContain("## Requirements Overview");
    expect(buildLocalPipelinePrompt("PLAN", context)).toContain("## Requirements Overview");
    expect(buildLocalPipelinePrompt("PLAN", context)).toContain("## Implementation Roadmap");
    expect(buildLocalPipelinePrompt("PLAN", context)).toContain("## Open Questions");
  });

  it("builds PR prompts with base branch context and omits brief paths for non-brief work", () => {
    const prompt = buildLocalPipelinePrompt("PR", {
      item: {
        id: "DEMO-1",
        payload: { kind: "jira", ticketKey: "DEMO-1" },
        repo: "pando",
        source: "jira",
        title: "Demo",
      },
      profile: repoProfile("/repo"),
      worktree: "/worktree",
    });

    expect(prompt).toContain("Base branch: develop");
    expect(prompt).toContain("Create a Draft PR against the repo base branch");
    expect(prompt).not.toContain("Brief path:");
  });

  it("returns deterministic shell gate results for successful and failed commands", async () => {
    await expect(
      shellGateRunner('node -e "process.exit(0)"', { cwd: process.cwd() }),
    ).resolves.toEqual({ exitCode: 0, stderr: "", stdout: "" });

    const failed = await shellGateRunner(
      'node -e "process.stdout.write(\\"out\\"); process.stderr.write(\\"err\\"); process.exit(7)"',
      { cwd: process.cwd() },
    );

    expect(failed).toEqual({ exitCode: 7, stderr: "err", stdout: "out" });
  });

  it("returns undefined for missing text files and rethrows non-ENOENT read errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-optional-read-"));

    await expect(optionalReadText(join(root, "missing.md"))).resolves.toBeUndefined();
    await expect(optionalReadText(root)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

function writingEngine(prompts: string[]): WorkerEngine {
  return {
    name: "claude-code",
    async run(opts: WorkerRunOptions): Promise<WorkerResult> {
      prompts.push(opts.prompt);
      if (opts.prompt.includes("Stage: SPEC")) {
        writeFileSync(join(opts.cwd, "_spec.md"), SPEC);
      }
      if (opts.prompt.includes("Stage: PLAN")) {
        writeFileSync(join(opts.cwd, "PLAN.md"), PLAN);
      }
      return { ok: true, output: "ok" };
    },
  };
}

function briefMarkdown(): string {
  return `# Local runner task

## Goal

Make pando process a real local queued brief.

## User Story

As an operator, I want a local pando process to turn a brief into a reviewable PR.

## Acceptance Criteria

- [ ] The queued brief reaches DONE.
- [ ] The PR stage runs as a worker stage.

## Screens or Behavior

The daemon processes the job from SQLite without manual script-specific smoke IDs.

## Non-Goals

- Do not add public auth.

## Assets

- None

## Open Questions

- None
`;
}

function writeRuntimeConfig(configDir: string, repoRoot: string): void {
  writeFileSync(
    join(configDir, "repos.yaml"),
    `
repos:
  pando:
    path: ${repoRoot}
    scope: external
    base_branch: develop
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
      lint: lint
      types: typecheck
    concurrency: 1
    port_range: [3300, 3399]
    guards:
      protected_branches: [main, develop]
      forbid_test_edit_in_impl: true
`,
  );
  writeFileSync(join(configDir, "stages.yaml"), readFileSync("config/stages.yaml", "utf8"));
  writeFileSync(
    join(configDir, "orchestrator.yaml"),
    `
global_concurrency: 1
worktree_root: ${join(configDir, "worktrees")}
skills_root: ~/.ai-skills
providers: {}
db: ./pando.sqlite
`,
  );
}

function repoProfile(path: string) {
  return {
    baseBranch: "develop",
    concurrency: 1,
    context: { policyRefs: [], providers: [] },
    contextProviders: [],
    conventions: "repo-local",
    gates: { test: "test" as const, lint: "lint" as const, types: "typecheck" as const },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["main", "develop"] },
    packageManager: "pnpm" as const,
    path,
    portRange: [3300, 3399] as [number, number],
    scope: "external" as const,
    setup: "install" as const,
    intake: { sources: ["brief" as const] },
    workItemSource: "brief" as const,
  };
}
