import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");
const packageDir = resolve(root, "packages/pandoctl");
const releaseWorkflowPath = resolve(root, ".github/workflows/pandoctl-release.yml");

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(packageDir, relPath), "utf8")) as Record<string, unknown>;
}

describe("pandoctl npm package contract", () => {
  const pkg = readJson("package.json");

  it("ships a real publish candidate, not the reserved placeholder", () => {
    expect(pkg.name).toBe("pandoctl");
    expect(pkg.version).not.toBe("0.0.1");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(String(pkg.description).toLowerCase()).not.toContain("placeholder");
  });

  it("points the bin at a compiled bundle under dist, not a stub", () => {
    const bin = pkg.bin as Record<string, string>;
    expect(bin.pandoctl).toBe("dist/pandoctl.mjs");
    expect(bin.pandoctl).not.toContain("bin/pandoctl.mjs");
  });

  it("packs the compiled output and schema so install needs no source tree", () => {
    const files = pkg.files as string[];
    expect(files).toContain("dist");
    expect(files).toContain("README.md");
  });

  it("declares the native sqlite dependency and a build step", () => {
    const dependencies = (pkg.dependencies ?? {}) as Record<string, string>;
    expect(dependencies["better-sqlite3"]).toBeDefined();

    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    expect(scripts.build).toBeDefined();
  });

  it("keeps a non-placeholder README for the published page", () => {
    const readme = readFileSync(resolve(packageDir, "README.md"), "utf8").toLowerCase();
    expect(readme).not.toContain("placeholder release");
    expect(readme).toContain("pandoctl start");
  });

  it("keeps a manual release workflow for publishing the command package", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("bun run verify");
    expect(workflow).toContain("bun run build:pandoctl");
    expect(workflow).toContain("bun run smoke:pandoctl-pack");
    expect(workflow).toContain("npm publish --provenance --access public");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
  });
});
