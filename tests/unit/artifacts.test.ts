import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasBlockingOpenQuestions,
  parsePlanArtifact,
  parseSpecArtifact,
  validatePlanArtifact,
  validateSpecArtifact,
} from "../../src/core/artifacts.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

describe("parsePlanArtifact", () => {
  it("parses the current PLAN contract with commit roadmap and metadata", () => {
    const plan = parsePlanArtifact(fixture("plan-valid-commit-roadmap.md"));

    expect(plan.ticketKey).toBe("DEMO-1234");
    expect(plan.title).toBe("Jest environment setup and config cleanup");
    expect(plan.metadata).toEqual({
      branch: "feat/DEMO-1234",
      created: "2026-06-06T00:00:00+09:00",
      source: "https://example.invalid/browse/DEMO-1234",
    });
    expect(plan.roadmap).toEqual({
      kind: "implementation",
      units: [
        { number: 1, title: "Standardize existing Jest configs", type: "commit" },
        { number: 2, title: "Add missing Jest environments", type: "commit" },
        { number: 3, title: "Expand CI test matrix", type: "commit" },
      ],
    });
    expect(plan.acceptanceCriteria).toHaveLength(3);
    expect(hasBlockingOpenQuestions(plan)).toBe(false);
  });

  it("parses a legacy stacked roadmap fixture and detects blockers", () => {
    const plan = parsePlanArtifact(fixture("plan-legacy-stacked.sanitized.md"));

    expect(plan.roadmap.kind).toBe("stacked");
    expect(plan.roadmap.units).toEqual([
      { number: 1, title: "Existing Jest config standardization", type: "pr" },
      { number: 2, title: "Add missing Jest environments", type: "pr" },
    ]);
    expect(hasBlockingOpenQuestions(plan)).toBe(true);
    expect(plan.openQuestions[0]).toMatchObject({ blocking: true });
  });
});

describe("validatePlanArtifact", () => {
  it("passes when the PLAN has an Implementation Roadmap split by commit", () => {
    const result = validatePlanArtifact(fixture("plan-valid-commit-roadmap.md"));

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.blockingQuestions).toEqual([]);
  });

  it("returns blocking open questions as escalation signals instead of schema errors", () => {
    const markdown = fixture("plan-valid-commit-roadmap.md").replace(
      "- README scope:",
      "- **[Blocker] README scope:**",
    );
    const result = validatePlanArtifact(markdown);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.blockingQuestions).toHaveLength(1);
  });

  it("reports a legacy Stacked PR Roadmap as a current contract violation", () => {
    const result = validatePlanArtifact(fixture("plan-legacy-stacked.sanitized.md"));

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "PLAN.md must contain an Implementation Roadmap with Commit units",
    );
    expect(result.blockingQuestions).toHaveLength(1);
  });

  it("returns specific errors when required sections are missing", () => {
    const result = validatePlanArtifact("# Untitled\n\n## Requirements Overview\n\n- item\n");

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "PLAN.md title must include a ticket key like [AP-1234]",
      "PLAN.md must contain an Implementation Roadmap with Commit units",
      "PLAN.md must contain an Open Questions section",
      "PLAN.md must contain at least one Acceptance Criteria item",
    ]);
  });
});

describe("spec artifact validation", () => {
  it("requires _spec.md to have a title and Requirements Overview section", () => {
    const spec = parseSpecArtifact("# Example spec\n\n## Requirements Overview\n\n- Build it\n");

    expect(spec.title).toBe("Example spec");
    expect(validateSpecArtifact("# Example spec\n\n## Requirements Overview\n\n- Build it\n")).toEqual({
      errors: [],
      valid: true,
    });
    expect(validateSpecArtifact("## Notes\n\nmissing title")).toEqual({
      errors: [
        "_spec.md must start with an H1 title",
        "_spec.md must contain a Requirements Overview section",
      ],
      valid: false,
    });
  });
});
