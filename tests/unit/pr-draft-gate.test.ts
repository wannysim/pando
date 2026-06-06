import { describe, expect, it } from "vitest";
import { createPrDraftGate, type TextFileReader } from "../../src/pipeline/gates/pr-draft";
import type { GateContext } from "../../src/core/types";

const DRAFT = JSON.stringify({ isDraft: true, number: 42, url: "https://github.com/o/r/pull/42" });
const NON_DRAFT = JSON.stringify({
  isDraft: false,
  number: 42,
  url: "https://github.com/o/r/pull/42",
});

function reader(files: Record<string, string>): TextFileReader {
  return {
    async readText(path) {
      return files[path];
    },
  };
}

describe("createPrDraftGate", () => {
  it("passes when the PR artifact reports isDraft true", async () => {
    const gate = createPrDraftGate(reader({ "/worktree/pr.json": DRAFT }));

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: DRAFT,
      pass: true,
    });
  });

  it("fails with the structured artifact as evidence when the PR is not a draft", async () => {
    const gate = createPrDraftGate(reader({ "/worktree/pr.json": NON_DRAFT }));

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: NON_DRAFT,
      pass: false,
      reason: "PR was created as a non-draft",
    });
  });

  it("fails when the PR artifact is missing", async () => {
    const gate = createPrDraftGate(reader({}));

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: "/worktree/pr.json",
      pass: false,
      reason: "pr.json not found",
    });
  });

  it("fails when the PR artifact is not valid JSON", async () => {
    const gate = createPrDraftGate(reader({ "/worktree/pr.json": "not json {" }));

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: "not json {",
      pass: false,
      reason: "pr.json is not valid JSON",
    });
  });

  it("fails when the PR artifact is JSON null rather than an object", async () => {
    const gate = createPrDraftGate(reader({ "/worktree/pr.json": "null" }));

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: "null",
      pass: false,
      reason: "pr.json is missing a boolean isDraft field",
    });
  });

  it("fails when the PR artifact lacks a boolean isDraft field", async () => {
    const gate = createPrDraftGate(reader({ "/worktree/pr.json": JSON.stringify({ number: 42 }) }));

    await expect(gate.check(baseContext())).resolves.toEqual({
      evidence: JSON.stringify({ number: 42 }),
      pass: false,
      reason: "pr.json is missing a boolean isDraft field",
    });
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
      intake: { sources: ["jira"] },
      packageManager: "pnpm" as const,
      path: "/repo",
      portRange: [3000, 3099] as [number, number],
      scope: "external" as const,
      setup: "install" as const,
      workItemSource: "jira" as const,
    },
    worktree: "/worktree",
  };
}
