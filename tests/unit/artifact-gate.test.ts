import { describe, expect, it } from "bun:test";
import {
  createPlanArtifactGate,
  createSpecArtifactGate,
  type TextFileReader,
} from "../../src/pipeline/gates/artifact-schema";
import type { GateContext } from "../../src/core/types";

const SPEC = "# Example spec\n\n## Requirements Overview\n\n- Build it\n";

const PLAN = `# [DEMO-1234] Example plan

## Requirements Overview

- Build it

## Implementation Roadmap

### Commit 1: Add the feature
- Focus: feature code

## Open Questions

- None

## Acceptance Criteria

- [ ] It works
`;

function reader(files: Record<string, string>): TextFileReader {
  return {
    async readText(path) {
      return files[path];
    },
  };
}

describe("createSpecArtifactGate", () => {
  it("passes when _spec.md exists and matches the artifact contract", async () => {
    const gate = createSpecArtifactGate(reader({ "/worktree/_spec.md": SPEC }));

    await expect(gate.check(baseContext())).resolves.toEqual({ pass: true });
  });

  it("fails with deterministic evidence when _spec.md is missing", async () => {
    const gate = createSpecArtifactGate(reader({}));

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: "/worktree/_spec.md",
      pass: false,
      reason: "_spec.md not found",
    });
  });
});

describe("createPlanArtifactGate", () => {
  it("passes when PLAN.md matches the current artifact contract and has no blockers", async () => {
    const gate = createPlanArtifactGate(reader({ "/worktree/PLAN.md": PLAN }));

    await expect(gate.check(baseContext())).resolves.toEqual({ pass: true });
  });

  it("returns a blocking-questions failure when PLAN.md has blocker open questions", async () => {
    const gate = createPlanArtifactGate(
      reader({
        "/worktree/PLAN.md": PLAN.replace("- None", "- **[Blocker] Need a base branch"),
      }),
    );

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: "**[Blocker] Need a base branch",
      failureKind: "blocking-questions",
      pass: false,
      reason: "PLAN.md has blocking open questions",
    });
  });

  it("fails with schema evidence when PLAN.md violates the current contract", async () => {
    const gate = createPlanArtifactGate(
      reader({ "/worktree/PLAN.md": "# Untitled\n\n## Requirements Overview\n\n- item\n" }),
    );

    const result = await gate.check(baseContext());

    expect(result.pass).toBe(false);
    expect(result.reason).toBe("PLAN.md schema validation failed");
    expect(result.evidence).toContain("PLAN.md title must include a ticket key like [AP-1234]");
  });

  it("does not require a ticket key for brief-source jobs", async () => {
    const gate = createPlanArtifactGate(
      reader({ "/worktree/PLAN.md": PLAN.replace("[DEMO-1234] ", "") }),
    );
    const ctx: GateContext = {
      ...baseContext(),
      item: {
        id: "pando-port-tip",
        payload: { briefPath: "briefs/pando-port-tip/brief.md", kind: "brief" as const },
        repo: "pando",
        source: "brief" as const,
        title: "Example",
      },
    };

    await expect(gate.check(ctx)).resolves.toEqual({ pass: true });
  });
});

function baseContext(): GateContext {
  return {
    item: {
      id: "DEMO-1234",
      payload: { kind: "jira" as const, ticketKey: "DEMO-1234" },
      repo: "web",
      source: "jira" as const,
      title: "Example",
    },
    profile: {
      baseBranch: "develop",
      concurrency: 1,
      context: { policyRefs: [], providers: [] },
      contextProviders: [],
      conventions: "repo-local",
      gates: { test: "test" as const },
      guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
      packageManager: "pnpm" as const,
      path: "/repo",
      portRange: [3000, 3099] as [number, number],
      scope: "external" as const,
      setup: "install" as const,
      intake: { sources: ["jira"] },
      workItemSource: "jira" as const,
    },
    worktree: "/worktree",
  };
}
