import { describe, expect, it } from "bun:test";
import {
  BRIEF_TEMPLATE,
  composeBriefMarkdown,
  createBriefIntakeGate,
  loadBriefWorkItem,
  validateBriefMarkdown,
  type BriefFileReader,
} from "../../src/intake/brief";
import type { GateContext } from "../../src/core/types";

const VALID_BRIEF = `# Refresh home page

> repo: personal-site
> created: 2026-06-06T00:00:00.000Z

## Goal

Make the home page clearly present the current consulting offer.

## User Story

As a visitor, I want to understand the offer and contact the owner quickly.

## Acceptance Criteria

- [ ] The hero names the offer.
- [ ] The contact CTA is visible above the fold.

## Screens or Behavior

Use a quiet editorial layout with a compact contact section.

## Non-Goals

- Do not add a blog migration.

## Assets

- assets/home-reference.png

## Open Questions

- None
`;

function reader(files: Record<string, string>): BriefFileReader {
  return {
    async readText(path) {
      return files[path];
    },
  };
}

describe("brief intake", () => {
  it("exports the ADR-008 brief template with all required sections", () => {
    expect(BRIEF_TEMPLATE).toContain("## Goal");
    expect(BRIEF_TEMPLATE).toContain("## User Story");
    expect(BRIEF_TEMPLATE).toContain("## Acceptance Criteria");
    expect(BRIEF_TEMPLATE).toContain("## Screens or Behavior");
    expect(BRIEF_TEMPLATE).toContain("## Non-Goals");
    expect(BRIEF_TEMPLATE).toContain("## Assets");
    expect(BRIEF_TEMPLATE).toContain("## Open Questions");
  });

  it("loads a valid brief into a normalized brief WorkItem", async () => {
    const item = await loadBriefWorkItem({
      briefPath: "briefs/personal-site-20260606-a/brief.md",
      id: "personal-site-20260606-a",
      reader: reader({ "briefs/personal-site-20260606-a/brief.md": VALID_BRIEF }),
      repo: "personal-site",
    });

    expect(item).toEqual({
      id: "personal-site-20260606-a",
      payload: {
        assets: ["assets/home-reference.png"],
        briefPath: "briefs/personal-site-20260606-a/brief.md",
        kind: "brief",
      },
      repo: "personal-site",
      source: "brief",
      title: "Refresh home page",
    });
  });

  it("rejects briefs missing required sections with deterministic errors", () => {
    const validation = validateBriefMarkdown(
      VALID_BRIEF.replace("## Non-Goals\n\n- Do not add a blog migration.\n\n", ""),
    );

    expect(validation).toEqual({
      blockingQuestions: [],
      errors: ["brief.md must contain a Non-Goals section"],
      valid: false,
    });
  });

  it("rejects empty sections, missing titles, and missing files deterministically", async () => {
    expect(validateBriefMarkdown(VALID_BRIEF.replace("# Refresh home page", "No title"))).toEqual(
      expect.objectContaining({
        errors: expect.arrayContaining(["brief.md must start with an H1 title"]),
        valid: false,
      }),
    );

    expect(
      validateBriefMarkdown(
        VALID_BRIEF.replace("## Assets\n\n- assets/home-reference.png", "## Assets\n\n"),
      ),
    ).toEqual(
      expect.objectContaining({
        errors: expect.arrayContaining(["brief.md Assets section must not be empty"]),
        valid: false,
      }),
    );

    await expect(
      loadBriefWorkItem({
        briefPath: "briefs/missing/brief.md",
        id: "missing",
        reader: reader({}),
        repo: "personal-site",
      }),
    ).rejects.toThrow(/brief not found/i);
  });

  it("passes the brief intake gate for non-brief items and valid briefs without blockers", async () => {
    const gate = createBriefIntakeGate(reader({ "/worktree/brief.md": VALID_BRIEF }));

    await expect(gate.check({ ...briefContext(), item: jiraItem() })).resolves.toEqual({
      pass: true,
    });
    await expect(gate.check(briefContext())).resolves.toEqual({ pass: true });
  });

  it("fails the brief intake gate for missing and schema-invalid brief files", async () => {
    const missingGate = createBriefIntakeGate(reader({}));
    await expect(missingGate.check(briefContext())).resolves.toEqual({
      evidence: "/worktree/brief.md",
      pass: false,
      reason: "brief.md not found",
    });

    const invalidGate = createBriefIntakeGate(reader({ "/worktree/brief.md": "# Missing\n" }));
    const result = await invalidGate.check(briefContext());
    expect(result.pass).toBe(false);
    expect(result.reason).toBe("brief.md schema validation failed");
    expect(result.evidence).toContain("brief.md must contain a Goal section");
  });

  it("composes a canonical, schema-valid brief.md from structured fields", () => {
    const markdown = composeBriefMarkdown({
      title: "Refresh home page",
      goal: "Make the home page clearly present the current consulting offer.",
      userStory: "As a visitor, I want to understand the offer and contact the owner quickly.",
      acceptanceCriteria: [
        "The hero names the offer.",
        "The contact CTA is visible above the fold.",
      ],
      screensOrBehavior: "Use a quiet editorial layout with a compact contact section.",
      nonGoals: ["Do not add a blog migration."],
      assets: ["assets/home-reference.png", "docs/spec.md"],
      openQuestions: ["None"],
    });

    expect(validateBriefMarkdown(markdown).valid).toBe(true);
    expect(markdown).toContain("# Refresh home page");
    expect(markdown).toContain("- [ ] The hero names the offer.");
    expect(markdown).toContain("- assets/home-reference.png");
    expect(markdown).toContain("- docs/spec.md");

    const item = composeBriefMarkdown({
      title: "Refresh home page",
      goal: "Make the home page clearly present the current consulting offer.",
      userStory: "As a visitor, I want to understand the offer and contact the owner quickly.",
      acceptanceCriteria: ["The hero names the offer."],
      screensOrBehavior: "Use a quiet editorial layout.",
      nonGoals: ["Do not add a blog migration."],
      assets: [],
      openQuestions: [],
    });
    expect(item).toContain("## Assets\n\n- None");
    expect(item).toContain("## Open Questions\n\n- None");
  });

  it("composes a brief from a freeform body while filling required sections", () => {
    const markdown = composeBriefMarkdown({
      title: "Quick fix",
      body: "Just make the footer year dynamic. It should read the current year.",
      acceptanceCriteria: ["The footer shows the current year."],
      assets: ["src/footer.tsx"],
    });

    expect(validateBriefMarkdown(markdown).valid).toBe(true);
    expect(markdown).toContain("Just make the footer year dynamic.");
    expect(markdown).toContain("- src/footer.tsx");
  });

  it("surfaces [Blocker] open questions through a deterministic SPEC gate", async () => {
    const blocked = VALID_BRIEF.replace(
      "- None",
      "- [Blocker] Need final homepage copy before planning",
    );
    const gate = createBriefIntakeGate(reader({ "/worktree/brief.md": blocked }));

    await expect(gate.check(briefContext())).resolves.toEqual({
      evidence: "[Blocker] Need final homepage copy before planning",
      failureKind: "blocking-questions",
      pass: false,
      reason: "brief has blocking open questions",
    });
  });
});

function briefContext(): GateContext {
  return {
    item: {
      id: "personal-site-20260606-a",
      payload: { briefPath: "/worktree/brief.md", kind: "brief" },
      repo: "personal-site",
      source: "brief",
      title: "Refresh home page",
    },
    profile: {
      baseBranch: "main",
      concurrency: 1,
      context: { policyRefs: [], providers: [] },
      contextProviders: [],
      conventions: "repo-local",
      gates: { test: "test" },
      guards: { forbidTestEditInImpl: true, protectedBranches: ["main"] },
      intake: { sources: ["brief"] },
      packageManager: "pnpm",
      path: "/repo",
      portRange: [3000, 3099],
      scope: "external",
      setup: "install",
      workItemSource: "brief",
    },
    worktree: "/worktree",
  };
}

function jiraItem(): GateContext["item"] {
  return {
    id: "DEMO-1234",
    payload: { kind: "jira", ticketKey: "DEMO-1234" },
    repo: "web",
    source: "jira",
    title: "Demo",
  };
}
