import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRepoProfilesFromYaml, type FileProbe } from "../../src/core/config.js";
import { loadStageConfigFromYaml } from "../../src/core/stage-config.js";
import type { WorkerEngine, WorkerRunOptions, WorkerResult } from "../../src/core/types.js";
import { loadBriefWorkItem } from "../../src/intake/brief.js";
import { createSpecArtifactGate } from "../../src/pipeline/gates/artifact-schema.js";
import { runPipeline } from "../../src/pipeline/runner.js";

const BRIEF = `# Refresh home page

## Goal

Make the personal site clearly explain the current offer.

## User Story

As a visitor, I want to understand the offer and contact the owner quickly.

## Acceptance Criteria

- [ ] The generated spec preserves the offer and contact requirements.

## Screens or Behavior

Use a concise first screen and a visible contact action.

## Non-Goals

- Do not add a CMS.

## Assets

- None

## Open Questions

- None
`;

const SPEC = `# Refresh home page

## Requirements Overview

- Explain the current offer on the first screen.
- Keep a visible contact action.
`;

describe("personal-site brief SPEC path", () => {
  it("validates a brief-sourced SPEC artifact without enabling Jira MCP tools", async () => {
    const profiles = await loadRepoProfilesFromYaml(readFileSync("config/repos.yaml", "utf8"), {
      files: probe(["/Users/me/Github/web/yarn.lock"]),
      homeDir: "/Users/me",
    });
    const profile = profiles["personal-site"];
    if (profile === undefined) throw new Error("personal-site profile missing");
    const stageConfig = loadStageConfigFromYaml(readFileSync("config/stages.yaml", "utf8"));
    const engineCalls: WorkerRunOptions[] = [];

    const item = await loadBriefWorkItem({
      briefPath: "briefs/personal-site-20260606-a/brief.md",
      id: "personal-site-20260606-a",
      reader: {
        async readText() {
          return BRIEF;
        },
      },
      repo: "personal-site",
    });

    const result = await runPipeline({
      engines: {
        "claude-code": recordingEngine("claude-code", engineCalls),
        codex: recordingEngine("codex", engineCalls),
      },
      gates: {
        SPEC: [
          createSpecArtifactGate({
            async readText(path) {
              return path === "/worktrees/personal-site/_spec.md" ? SPEC : undefined;
            },
          }),
        ],
      },
      item,
      profile,
      stageConfig,
      worktree: "/worktrees/personal-site",
    });

    expect(result.final.status).toBe("DONE");
    expect(profile.intake.sources).toContain("brief");
    expect(profile.context.providers).toEqual([]);
    expect(engineCalls[0]?.allowedTools).toEqual(["Read", "Glob", "Grep"]);
  });
});

function recordingEngine(name: WorkerEngine["name"], calls: WorkerRunOptions[]): WorkerEngine {
  return {
    name,
    async run(opts): Promise<WorkerResult> {
      calls.push(opts);
      return { ok: true, output: "ok" };
    },
  };
}

function probe(existing: readonly string[]): FileProbe {
  const files = new Set(existing);
  return {
    exists(path) {
      return files.has(path);
    },
  };
}
