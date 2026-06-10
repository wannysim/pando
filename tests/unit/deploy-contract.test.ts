import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "bun:test";

describe("Docker deployment contract", () => {
  it("pins the single-container image shape and dashboard build", () => {
    const dockerfile = readFileSync("deploy/Dockerfile", "utf8");

    expect(dockerfile).toContain("FROM oven/bun:1.3.5");
    expect(dockerfile).toContain("apt-get update");
    expect(dockerfile).toContain("ca-certificates");
    expect(dockerfile).toContain("git");
    expect(dockerfile).toContain("openssh-client");
    expect(dockerfile).toContain("bun install --frozen-lockfile");
    expect(dockerfile).toContain("bun --filter=@pando/dashboard run build");
    expect(dockerfile).toContain("EXPOSE 3210");
    expect(dockerfile).toContain('CMD ["bun", "run", "start"]');
  });

  it("offers an opt-in, version-pinned worker CLI install layer via build args", () => {
    const dockerfile = readFileSync("deploy/Dockerfile", "utf8");

    // Opt-in flag: default keeps the base image lean and secret-free.
    expect(dockerfile).toContain("ARG INSTALL_WORKER_CLIS=false");
    // Pinned versions (build args), matching the verified host CLI versions.
    expect(dockerfile).toContain("ARG CLAUDE_CLI_VERSION=2.1.167");
    expect(dockerfile).toContain("ARG CODEX_CLI_VERSION=0.137.0");
    // Conditional install that wires the pins into the npm install command.
    expect(dockerfile).toContain('@anthropic-ai/claude-code@"${CLAUDE_CLI_VERSION}"');
    expect(dockerfile).toContain('@openai/codex@"${CODEX_CLI_VERSION}"');
    expect(dockerfile).toMatch(/if\s+\[\s+"\$\{?INSTALL_WORKER_CLIS\}?"\s+=\s+"true"\s+\]/);
  });

  it("exposes the worker CLI install build args to compose without enabling them", () => {
    const compose = parse(readFileSync("deploy/docker-compose.yml", "utf8")) as {
      services: { pando: { build: { args?: Record<string, string> } } };
    };
    const buildArgs = compose.services.pando.build.args ?? {};

    expect(buildArgs.INSTALL_WORKER_CLIS).toBe("${PANDO_INSTALL_WORKER_CLIS:-false}");
    expect(buildArgs.CLAUDE_CLI_VERSION).toBe("${PANDO_CLAUDE_CLI_VERSION:-2.1.167}");
    expect(buildArgs.CODEX_CLI_VERSION).toBe("${PANDO_CODEX_CLI_VERSION:-0.137.0}");
  });

  it("fixes SQLite, repos, worktrees, config, skills, env, and port mounts", () => {
    const compose = parse(readFileSync("deploy/docker-compose.yml", "utf8")) as {
      services: Record<string, unknown>;
      volumes?: Record<string, unknown>;
    };
    const service = asRecord(compose.services.pando, "services.pando");
    const environment = asRecord(service.environment, "services.pando.environment");
    const volumes = asStringArray(service.volumes, "services.pando.volumes");
    const ports = asStringArray(service.ports, "services.pando.ports");

    expect(service.build).toMatchObject({
      context: "..",
      dockerfile: "deploy/Dockerfile",
    });
    expect(ports).toContain("${PANDO_PORT:-3210}:3210");
    expect(environment).toMatchObject({
      PANDO_CONFIG_DIR: "/config",
      PANDO_DB: "/data/pando.sqlite",
      PANDO_GLOBAL_CONCURRENCY: "${PANDO_GLOBAL_CONCURRENCY:-2}",
      PANDO_HOST: "0.0.0.0",
      PANDO_PORT: "3210",
      PANDO_REPOS_ROOT: "/repos",
      PANDO_SKILLS_ROOT: "/skills",
      PANDO_STATIC_DASHBOARD_ROOT: "/app/dashboard/dist",
      PANDO_WORKTREE_ROOT: "/worktrees",
    });
    expect(volumes).toEqual(
      expect.arrayContaining([
        "pando-data:/data",
        "${PANDO_REPOS_ROOT:-~/Github}:/repos",
        "${PANDO_WORKTREE_ROOT:-~/.worktrees}:/worktrees",
        "${PANDO_CONFIG_ROOT:-../config}:/config:ro",
        "${PANDO_SKILLS_ROOT:-~/.ai-skills}:/skills:ro",
      ]),
    );
    expect(compose.volumes).toHaveProperty("pando-data");
    expect(service.healthcheck).toEqual(
      expect.objectContaining({
        test: expect.arrayContaining(["CMD-SHELL"]),
      }),
    );
  });
});

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field}: expected object`);
  }
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field}: expected string array`);
  }
  return value;
}
