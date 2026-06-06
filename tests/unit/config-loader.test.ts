import { describe, expect, it } from "vitest";
import {
  loadRepoProfilesFromYaml,
  packageCommand,
  type FileProbe,
} from "../../src/core/config.js";

const YAML = `
repos:
  web:
    path: ~/Github/web
    scope: acme
    base_branch: develop
    work_item_source: jira
    context_providers: [atlassian-mcp, figma-mcp]
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
    work_item_source: brief
    context_providers: []
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
      contextProviders: ["atlassian-mcp", "figma-mcp"],
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
