import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("Docker deployment contract", () => {
  it("pins the single-container image shape and dashboard build", () => {
    const dockerfile = readFileSync("deploy/Dockerfile", "utf8");

    expect(dockerfile).toContain("FROM node:22");
    expect(dockerfile).toContain("corepack enable");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("pnpm --filter @pando/dashboard build");
    expect(dockerfile).toContain("EXPOSE 3210");
    expect(dockerfile).toContain('CMD ["pnpm", "start"]');
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

    expect(service.build).toEqual({
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
