import { describe, expect, it } from "bun:test";
import { loadOrchestratorConfigFromYaml } from "../../src/core/config";

describe("loadOrchestratorConfigFromYaml", () => {
  it("loads scheduler caps from orchestrator yaml", () => {
    const config = loadOrchestratorConfigFromYaml(`
global_concurrency: 6
worktree_root: ~/.worktrees
skills_root: ~/.ai-skills
providers:
  confluence: { max_concurrent: 3 }
  figma: { max_concurrent: 2 }
db: ./pando.sqlite
`);

    expect(config).toEqual({
      db: "./pando.sqlite",
      globalConcurrency: 6,
      providerConcurrency: { confluence: 3, figma: 2 },
      skillsRoot: "~/.ai-skills",
      worktreeRoot: "~/.worktrees",
    });
  });

  it("rejects invalid concurrency values", () => {
    expect(() =>
      loadOrchestratorConfigFromYaml(`
global_concurrency: 0
worktree_root: ~/.worktrees
skills_root: ~/.ai-skills
providers:
  confluence: { max_concurrent: 3 }
db: ./pando.sqlite
`),
    ).toThrow(/global_concurrency/i);

    expect(() =>
      loadOrchestratorConfigFromYaml(`
global_concurrency: 6
worktree_root: ~/.worktrees
skills_root: ~/.ai-skills
providers:
  confluence: { max_concurrent: 0 }
db: ./pando.sqlite
`),
    ).toThrow(/providers\.confluence\.max_concurrent/i);
  });
});
