import { describe, expect, it } from "vitest";
import {
  loadStageConfigFromYaml,
  resolveStageAllowedTools,
  resolveStageSkill,
} from "../../src/core/stage-config";

const YAML = `
stages:
  spec:
    engine: claude-code
    model: sonnet
    skills:
      jira: jira-context-gatherer
      brief: brief-intake
    allowed_tools_by_source:
      jira: [Read, Glob, Grep, Task, mcp__claude_ai_Atlassian]
      brief: [Read, Glob, Grep]
  plan:
    engine: claude-code
    model: opus
    skill: implement-jira
    allowed_tools: [Read, Glob, Grep, Write, "Bash(git *)", Task, mcp__claude_ai_Atlassian]
    env:
      IMPLEMENT_JIRA_BATCH: "1"
  test:
    engine: codex
    model: gpt-5-codex
    skill: test-writer
  impl:
    engine: codex
    model: gpt-5-codex
  review:
    engine: claude-code
    model: opus
    skill: verifier
    allowed_tools: [Read, Glob, Grep, "Bash(git *)"]

defaults:
  retry_budget: 10
  timeout_minutes: 30
`;

describe("loadStageConfigFromYaml", () => {
  it("normalizes stage config and extracts skill, allowedTools, env, and defaults", () => {
    const config = loadStageConfigFromYaml(YAML);

    expect(config.defaults).toEqual({ retryBudget: 10, timeoutMinutes: 30 });
    expect(config.stages.spec).toEqual({
      allowedToolsBySource: {
        brief: ["Read", "Glob", "Grep"],
        jira: ["Read", "Glob", "Grep", "Task", "mcp__claude_ai_Atlassian"],
      },
      engine: "claude-code",
      model: "sonnet",
      skills: {
        brief: "brief-intake",
        jira: "jira-context-gatherer",
      },
    });
    expect(config.stages.plan).toEqual({
      allowedTools: [
        "Read",
        "Glob",
        "Grep",
        "Write",
        "Bash(git *)",
        "Task",
        "mcp__claude_ai_Atlassian",
      ],
      engine: "claude-code",
      env: { IMPLEMENT_JIRA_BATCH: "1" },
      model: "opus",
      skill: "implement-jira",
    });
  });

  it("resolves source-specific skills before falling back to a stage skill", () => {
    const config = loadStageConfigFromYaml(YAML);

    expect(resolveStageSkill(config, "spec", "jira")).toBe("jira-context-gatherer");
    expect(resolveStageSkill(config, "spec", "brief")).toBe("brief-intake");
    expect(resolveStageSkill(config, "plan", "jira")).toBe("implement-jira");
    expect(resolveStageSkill(config, "impl", "jira")).toBeUndefined();
  });

  it("resolves source-specific allowed tools before falling back to stage tools", () => {
    const config = loadStageConfigFromYaml(YAML);

    expect(resolveStageAllowedTools(config, "spec", "brief")).toEqual([
      "Read",
      "Glob",
      "Grep",
    ]);
    expect(resolveStageAllowedTools(config, "spec", "jira")).toContain(
      "mcp__claude_ai_Atlassian",
    );
    expect(resolveStageAllowedTools(config, "plan", "brief")).toContain("Bash(git *)");
  });

  it("fails fast when a required worker stage is missing", () => {
    const invalid = YAML.replace(/  review:[\s\S]*?defaults:/, "defaults:");

    expect(() => loadStageConfigFromYaml(invalid)).toThrow(/stages\.review/i);
  });

  it("rejects invalid engines and malformed allowed_tools with field paths", () => {
    expect(() =>
      loadStageConfigFromYaml(YAML.replace("engine: codex", "engine: aider")),
    ).toThrow(/stages\.test\.engine/i);
    expect(() =>
      loadStageConfigFromYaml(YAML.replace(
        "brief: [Read, Glob, Grep]",
        "brief: Read",
      )),
    ).toThrow(/stages\.spec\.allowed_tools_by_source\.brief/i);
  });

  it("rejects ambiguous skill declarations", () => {
    expect(() =>
      loadStageConfigFromYaml(
        YAML.replace("skill: implement-jira", "skill: implement-jira\n    skills:\n      jira: other"),
      ),
    ).toThrow(/stages\.plan.*skill/i);
  });
});
