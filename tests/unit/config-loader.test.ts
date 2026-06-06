import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadRepoProfilesFromYaml, packageCommand, type FileProbe } from "../../src/core/config";

const YAML = `
repos:
  web:
    path: ~/Github/web
    scope: acme
    base_branch: develop
    intake:
      sources: [jira]
    context:
      providers: [confluence, figma]
      policy_refs: []
    conventions: acme-conventions
    setup: install
    gates:
      test: test
      lint: lint
      types: typecheck
    concurrency: 3
    port_range: [3100, 3199]
    env_files: [".env.local"]
    guards:
      protected_branches: [main, develop, "release/*"]
      forbid_test_edit_in_impl: true

  personal-site:
    path: ~/Github/personal-site
    scope: external
    base_branch: main
    intake:
      sources: [brief, github_issue]
    context:
      providers: []
    conventions: repo-local
    package_manager: pnpm
    setup: install
    gates:
      test: test
      types: typecheck
    concurrency: 2
    port_range: [3200, 3299]
    guards:
      protected_branches: [main]
      forbid_test_edit_in_impl: true
`;

function probe(existing: readonly string[]): FileProbe {
  const files = new Set(existing);
  return {
    exists(path) {
      return files.has(path);
    },
  };
}

describe("loadRepoProfilesFromYaml", () => {
  it("normalizes snake_case YAML to RepoProfile and detects packageManager from lockfiles", async () => {
    const profiles = await loadRepoProfilesFromYaml(YAML, {
      homeDir: "/Users/me",
      files: probe(["/Users/me/Github/web/yarn.lock"]),
    });

    expect(profiles.web).toEqual({
      path: "/Users/me/Github/web",
      scope: "acme",
      baseBranch: "develop",
      workItemSource: "jira",
      intake: { sources: ["jira"] },
      context: { policyRefs: [], providers: ["confluence", "figma"] },
      contextProviders: ["confluence", "figma"],
      conventions: "acme-conventions",
      packageManager: "yarn",
      setup: "install",
      gates: { test: "test", lint: "lint", types: "typecheck" },
      concurrency: 3,
      portRange: [3100, 3199],
      envFiles: [".env.local"],
      guards: {
        protectedBranches: ["main", "develop", "release/*"],
        forbidTestEditInImpl: true,
      },
    });
  });

  it("uses package_manager fallback when no lockfile exists", async () => {
    const profiles = await loadRepoProfilesFromYaml(YAML, {
      homeDir: "/Users/me",
      files: probe(["/Users/me/Github/web/yarn.lock"]),
    });

    expect(profiles["personal-site"]?.packageManager).toBe("pnpm");
    expect(profiles["personal-site"]?.intake.sources).toEqual(["brief", "github_issue"]);
    expect(profiles["personal-site"]?.workItemSource).toBe("brief");
  });

  it("parses an optional release_branch_template onto releaseBranchTemplate", async () => {
    const withTemplate = YAML.replace(
      "base_branch: develop\n    intake:\n      sources: [jira]",
      "base_branch: develop\n    release_branch_template: release/{fixVersion}\n    intake:\n      sources: [jira]",
    );

    const profiles = await loadRepoProfilesFromYaml(withTemplate, {
      homeDir: "/Users/me",
      files: probe(["/Users/me/Github/web/yarn.lock"]),
    });

    expect(profiles.web?.releaseBranchTemplate).toBe("release/{fixVersion}");
    expect(profiles["personal-site"]?.releaseBranchTemplate).toBeUndefined();
  });

  it("rejects a non-string release_branch_template with the repo name and field", async () => {
    const badTemplate = YAML.replace(
      "base_branch: develop\n    intake:\n      sources: [jira]",
      "base_branch: develop\n    release_branch_template: 42\n    intake:\n      sources: [jira]",
    );

    await expect(
      loadRepoProfilesFromYaml(badTemplate, {
        homeDir: "/Users/me",
        files: probe(["/Users/me/Github/web/yarn.lock"]),
      }),
    ).rejects.toThrow(/web.*release_branch_template/i);
  });

  it("fails fast with the repo name when both lockfile and fallback are missing", async () => {
    await expect(
      loadRepoProfilesFromYaml(YAML, {
        homeDir: "/Users/me",
        files: probe([]),
      }),
    ).rejects.toThrow(/web.*package manager/i);
  });

  it("rejects invalid enum values with the repo name and field name", async () => {
    await expect(
      loadRepoProfilesFromYaml(YAML.replace("scope: acme", "scope: private"), {
        homeDir: "/Users/me",
        files: probe(["/Users/me/Github/web/yarn.lock"]),
      }),
    ).rejects.toThrow(/web.*scope/i);
  });

  it("returns an empty profile map when repos is empty", async () => {
    await expect(
      loadRepoProfilesFromYaml("repos: {}", {
        homeDir: "/Users/me",
        files: probe([]),
      }),
    ).resolves.toEqual({});
  });

  it("rejects empty intake sources and malformed context providers", async () => {
    await expect(
      loadRepoProfilesFromYaml(YAML.replace("sources: [jira]", "sources: []"), {
        homeDir: "/Users/me",
        files: probe(["/Users/me/Github/web/yarn.lock"]),
      }),
    ).rejects.toThrow(/web.*intake\.sources/i);

    await expect(
      loadRepoProfilesFromYaml(YAML.replace("providers: [confluence, figma]", "providers: figma"), {
        homeDir: "/Users/me",
        files: probe(["/Users/me/Github/web/yarn.lock"]),
      }),
    ).rejects.toThrow(/web.*context\.providers/i);

    await expect(
      loadRepoProfilesFromYaml(
        YAML.replace("providers: [confluence, figma]", "providers: [jira]"),
        {
          homeDir: "/Users/me",
          files: probe(["/Users/me/Github/web/yarn.lock"]),
        },
      ),
    ).rejects.toThrow(/web.*context\.providers/i);
  });

  it("keeps legacy work_item_source and context_providers configs loadable", async () => {
    const profiles = await loadRepoProfilesFromYaml(
      `
repos:
  legacy:
    path: ~/Github/legacy
    scope: external
    base_branch: main
    work_item_source: brief
    context_providers: [atlassian-mcp, figma-mcp]
    conventions: repo-local
    package_manager: pnpm
    setup: install
    gates:
      test: test
    concurrency: 1
    port_range: [3300, 3399]
    guards:
      protected_branches: [main]
      forbid_test_edit_in_impl: true
`,
      {
        homeDir: "/Users/me",
        files: probe([]),
      },
    );

    expect(profiles.legacy).toMatchObject({
      context: { policyRefs: [], providers: ["confluence", "figma"] },
      contextProviders: ["confluence", "figma"],
      intake: { sources: ["brief"] },
      workItemSource: "brief",
    });
  });

  it("loads the checked-in pando self-profile as a brief-only target", async () => {
    const profiles = await loadRepoProfilesFromYaml(readFileSync("config/repos.yaml", "utf8"), {
      homeDir: "/Users/me",
      files: probe(["/Users/me/Github/web/yarn.lock", "/Users/me/Github/pando/pnpm-lock.yaml"]),
    });

    expect(profiles.pando).toMatchObject({
      baseBranch: "develop",
      concurrency: 2,
      context: { policyRefs: [], providers: [] },
      contextProviders: [],
      conventions: "repo-local",
      gates: { lint: "lint", test: "test", types: "typecheck" },
      guards: {
        forbidTestEditInImpl: true,
        protectedBranches: ["main", "develop", "release/*"],
      },
      intake: { sources: ["brief"] },
      packageManager: "pnpm",
      path: "/Users/me/Github/pando",
      scope: "external",
      setup: "install",
      workItemSource: "brief",
    });
  });
});

describe("packageCommand", () => {
  it("converts PM-agnostic actions into executable commands", () => {
    expect(packageCommand("yarn", "install")).toBe("yarn install");
    expect(packageCommand("yarn", "typecheck")).toBe("yarn tsc --noEmit");
    expect(packageCommand("pnpm", "test")).toBe("pnpm test");
    expect(packageCommand("npm", "lint")).toBe("npm run lint");
    expect(packageCommand("pnpm", "typecheck")).toBe("pnpm exec tsc --noEmit");
  });
});
