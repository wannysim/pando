import { describe, expect, it } from "vitest";
import {
  loadStageConfigFromYaml,
  resolveStageAllowedTools,
  resolveStageSkill,
} from "../../src/core/stage-config";

const YAML = `
stages:
  spec:
    engine: codex
    model: gpt-5.5
    skills:
      jira: jira-context-gatherer
      brief: brief-intake
  plan:
    engine: codex
    model: gpt-5.5
    skill: implement-jira
    env:
      IMPLEMENT_JIRA_BATCH: "1"
  test:
    engine: codex
    model: gpt-5.5
    skill: test-writer
  impl:
    engine: codex
    model: gpt-5.5
  review:
    engine: codex
    model: gpt-5.5
    skill: verifier
  pr:
    engine: codex
    model: gpt-5.5
    skill: create-pr

defaults:
  retry_budget: 10
  timeout_minutes: 30
`;

describe("loadStageConfigFromYaml", () => {
  it("normalizes stage config and extracts skill, allowedTools, env, and defaults", () => {
    const config = loadStageConfigFromYaml(YAML);

    expect(config.defaults).toEqual({ retryBudget: 10, timeoutMinutes: 30 });
    expect(config.stages.spec).toEqual({
      engine: "codex",
      model: "gpt-5.5",
      skills: {
        brief: "brief-intake",
        jira: "jira-context-gatherer",
      },
    });
    expect(config.stages.plan).toEqual({
      engine: "codex",
      env: { IMPLEMENT_JIRA_BATCH: "1" },
      model: "gpt-5.5",
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

    expect(resolveStageAllowedTools(config, "spec", "brief")).toBeUndefined();
    expect(resolveStageAllowedTools(config, "spec", "jira")).toBeUndefined();
    expect(resolveStageAllowedTools(config, "plan", "brief")).toBeUndefined();
    expect(resolveStageAllowedTools(config, "test", "brief")).toBeUndefined();
    expect(resolveStageAllowedTools(config, "impl", "brief")).toBeUndefined();
  });

  it("fails fast when a required worker stage is missing", () => {
    const invalid = YAML.replace(/  review:[\s\S]*?defaults:/, "defaults:");

    expect(() => loadStageConfigFromYaml(invalid)).toThrow(/stages\.review/i);
  });

  it("rejects invalid engines and malformed allowed_tools with field paths", () => {
    expect(() =>
      loadStageConfigFromYaml(
        YAML.replace("  test:\n    engine: codex", "  test:\n    engine: aider"),
      ),
    ).toThrow(/stages\.test\.engine/i);
    const withMalformedAllowedTools = YAML.replace(
      "  impl:\n    engine: codex\n    model: gpt-5.5",
      "  impl:\n    engine: codex\n    model: gpt-5.5\n    allowed_tools: nope",
    );
    expect(() => loadStageConfigFromYaml(withMalformedAllowedTools)).toThrow(
      /stages\.impl\.allowed_tools/i,
    );
  });

  it("rejects ambiguous skill declarations", () => {
    expect(() =>
      loadStageConfigFromYaml(
        YAML.replace(
          "skill: implement-jira",
          "skill: implement-jira\n    skills:\n      jira: other",
        ),
      ),
    ).toThrow(/stages\.plan.*skill/i);
  });
});
