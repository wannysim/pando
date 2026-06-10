import { describe, expect, it } from "bun:test";
import { resolveBaseBranch } from "../../src/core/base-branch";
import type { RepoProfile, WorkItem } from "../../src/core/types";

describe("resolveBaseBranch", () => {
  it("prefers the WorkItem.baseBranch override above all else", () => {
    const item = jiraItem({ baseBranch: "release/9.9", fixVersion: "1.0" });
    const profile = profileWith({
      baseBranch: "develop",
      releaseBranchTemplate: "release/{fixVersion}",
    });

    expect(resolveBaseBranch({ item, profile })).toBe("release/9.9");
  });

  it("maps Jira fixVersion onto the release branch template when no override", () => {
    const item = jiraItem({ fixVersion: "1.0" });
    const profile = profileWith({
      baseBranch: "develop",
      releaseBranchTemplate: "release/{fixVersion}",
    });

    expect(resolveBaseBranch({ item, profile })).toBe("release/1.0");
  });

  it("falls back to the profile default when fixVersion has no template", () => {
    const item = jiraItem({ fixVersion: "1.0" });
    const profile = profileWith({ baseBranch: "develop" });

    expect(resolveBaseBranch({ item, profile })).toBe("develop");
  });

  it("falls back to the profile default when the Jira item has no fixVersion", () => {
    const item = jiraItem({});
    const profile = profileWith({
      baseBranch: "develop",
      releaseBranchTemplate: "release/{fixVersion}",
    });

    expect(resolveBaseBranch({ item, profile })).toBe("develop");
  });

  it("falls back to the profile default when fixVersion is blank (malformed)", () => {
    const item = jiraItem({ fixVersion: "   " });
    const profile = profileWith({
      baseBranch: "develop",
      releaseBranchTemplate: "release/{fixVersion}",
    });

    expect(resolveBaseBranch({ item, profile })).toBe("develop");
  });

  it("ignores fixVersion mapping for non-Jira items even with a template", () => {
    const item = briefItem();
    const profile = profileWith({
      baseBranch: "main",
      releaseBranchTemplate: "release/{fixVersion}",
    });

    expect(resolveBaseBranch({ item, profile })).toBe("main");
  });

  it("ignores a blank override and falls through to the next rule", () => {
    const item = jiraItem({ baseBranch: "   ", fixVersion: "2.1" });
    const profile = profileWith({
      baseBranch: "develop",
      releaseBranchTemplate: "release/{fixVersion}",
    });

    expect(resolveBaseBranch({ item, profile })).toBe("release/2.1");
  });

  it("trims surrounding whitespace from a valid fixVersion before mapping", () => {
    const item = jiraItem({ fixVersion: "  3.4  " });
    const profile = profileWith({
      baseBranch: "develop",
      releaseBranchTemplate: "release/{fixVersion}",
    });

    expect(resolveBaseBranch({ item, profile })).toBe("release/3.4");
  });
});

function jiraItem(opts: { baseBranch?: string; fixVersion?: string }): WorkItem {
  return {
    baseBranch: opts.baseBranch,
    id: "DEMO-1234",
    payload: { fixVersion: opts.fixVersion, kind: "jira", ticketKey: "DEMO-1234" },
    repo: "web",
    source: "jira",
    title: "Example",
  };
}

function briefItem(): WorkItem {
  return {
    id: "personal-site-1",
    payload: { briefPath: "briefs/x/brief.md", kind: "brief" },
    repo: "personal-site",
    source: "brief",
    title: "Example",
  };
}

function profileWith(overrides: Partial<RepoProfile>): RepoProfile {
  return {
    baseBranch: "develop",
    concurrency: 1,
    context: { policyRefs: [], providers: [] },
    contextProviders: [],
    conventions: "repo-local",
    gates: { test: "test" },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
    intake: { sources: ["jira"] },
    packageManager: "pnpm",
    path: "/repo",
    portRange: [3000, 3099],
    scope: "external",
    setup: "install",
    workItemSource: "jira",
    ...overrides,
  };
}
