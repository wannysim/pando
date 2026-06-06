import { parse } from "yaml";
import type {
  PackageAction,
  PackageManager,
  RepoProfile,
} from "./types.js";

export type { PackageAction, PackageManager } from "./types.js";

export interface FileProbe {
  exists(path: string): boolean | Promise<boolean>;
}

export interface LoadRepoProfilesOptions {
  homeDir: string;
  files: FileProbe;
}

const PACKAGE_MANAGERS = ["yarn", "pnpm", "npm"] as const;
const PACKAGE_ACTIONS = ["install", "test", "lint", "typecheck"] as const;
const SCOPES = ["acme", "external"] as const;
const WORK_ITEM_SOURCES = ["jira", "brief"] as const;
const CONTEXT_PROVIDERS = ["atlassian-mcp", "figma-mcp"] as const;

const LOCKFILES: readonly { file: string; manager: PackageManager }[] = [
  { file: "yarn.lock", manager: "yarn" },
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "package-lock.json", manager: "npm" },
];

export async function loadRepoProfilesFromYaml(
  yaml: string,
  opts: LoadRepoProfilesOptions,
): Promise<Record<string, RepoProfile>> {
  const root = asRecord(parse(yaml), "config");
  const repos = asRecord(root.repos, "repos");
  const profiles: Record<string, RepoProfile> = {};

  for (const [name, value] of Object.entries(repos)) {
    const repo = asRecord(value, name);
    const repoPath = expandHome(requiredString(repo.path, name, "path"), opts.homeDir);
    const fallbackPackageManager = optionalEnum(
      repo.package_manager,
      PACKAGE_MANAGERS,
      name,
      "package_manager",
    );
    const packageManager =
      (await detectPackageManager(repoPath, opts.files)) ?? fallbackPackageManager;

    if (packageManager === undefined) {
      throw new Error(`${name}.package manager: lockfile not found and package_manager is missing`);
    }

    profiles[name] = {
      path: repoPath,
      scope: requiredEnum(repo.scope, SCOPES, name, "scope"),
      baseBranch: requiredString(repo.base_branch, name, "base_branch"),
      workItemSource: requiredEnum(
        repo.work_item_source,
        WORK_ITEM_SOURCES,
        name,
        "work_item_source",
      ),
      contextProviders: optionalEnumArray(
        repo.context_providers,
        CONTEXT_PROVIDERS,
        name,
        "context_providers",
      ),
      conventions: requiredString(repo.conventions, name, "conventions"),
      packageManager,
      setup: requiredEnum(repo.setup, PACKAGE_ACTIONS, name, "setup"),
      gates: parseGates(repo.gates, name),
      concurrency: requiredPositiveInteger(repo.concurrency, name, "concurrency"),
      portRange: requiredPortRange(repo.port_range, name, "port_range"),
      envFiles: optionalStringArray(repo.env_files, name, "env_files"),
      guards: parseGuards(repo.guards, name),
    };
  }

  return profiles;
}

export function packageCommand(manager: PackageManager, action: PackageAction): string {
  if (action === "install") return `${manager} install`;
  if (action === "typecheck") {
    if (manager === "npm") return "npx tsc --noEmit";
    if (manager === "yarn") return "yarn tsc --noEmit";
    return `${manager} exec tsc --noEmit`;
  }
  if (manager === "npm") return `npm run ${action}`;
  return `${manager} ${action}`;
}

async function detectPackageManager(
  repoPath: string,
  files: FileProbe,
): Promise<PackageManager | undefined> {
  for (const lockfile of LOCKFILES) {
    if (await files.exists(`${repoPath}/${lockfile.file}`)) {
      return lockfile.manager;
    }
  }
  return undefined;
}

function expandHome(value: string, homeDir: string): string {
  const normalizedHome = homeDir.endsWith("/") ? homeDir.slice(0, -1) : homeDir;
  if (value === "~") return normalizedHome;
  if (value.startsWith("~/")) return `${normalizedHome}/${value.slice(2)}`;
  return value;
}

function parseGates(value: unknown, repo: string): RepoProfile["gates"] {
  const gates = asRecord(value, `${repo}.gates`);
  return {
    test: requiredEnum(gates.test, PACKAGE_ACTIONS, repo, "gates.test"),
    lint: optionalEnum(gates.lint, PACKAGE_ACTIONS, repo, "gates.lint"),
    types: optionalEnum(gates.types, PACKAGE_ACTIONS, repo, "gates.types"),
  };
}

function parseGuards(value: unknown, repo: string): RepoProfile["guards"] {
  const guards = asRecord(value, `${repo}.guards`);
  return {
    protectedBranches: requiredStringArray(
      guards.protected_branches,
      repo,
      "guards.protected_branches",
    ),
    forbidTestEditInImpl: requiredBoolean(
      guards.forbid_test_edit_in_impl,
      repo,
      "guards.forbid_test_edit_in_impl",
    ),
  };
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field}: expected object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, repo: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${repo}.${field}: expected non-empty string`);
  }
  return value;
}

function requiredBoolean(value: unknown, repo: string, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${repo}.${field}: expected boolean`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, repo: string, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${repo}.${field}: expected positive integer`);
  }
  return value;
}

function requiredPortRange(value: unknown, repo: string, field: string): [number, number] {
  const [start, end] = Array.isArray(value) ? value : [];
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start > end
  ) {
    throw new Error(`${repo}.${field}: expected [start, end] integer range`);
  }
  return [start, end];
}

function requiredStringArray(value: unknown, repo: string, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${repo}.${field}: expected string[]`);
  }
  return value;
}

function optionalStringArray(
  value: unknown,
  repo: string,
  field: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  return requiredStringArray(value, repo, field);
}

function requiredEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  repo: string,
  field: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${repo}.${field}: expected one of ${allowed.join(", ")}`);
  }
  return value;
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  repo: string,
  field: string,
): T[number] | undefined {
  if (value === undefined) return undefined;
  return requiredEnum(value, allowed, repo, field);
}

function optionalEnumArray<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  repo: string,
  field: string,
): T[number][] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${repo}.${field}: expected array`);
  }
  return value.map((item) => requiredEnum(item, allowed, repo, field));
}
