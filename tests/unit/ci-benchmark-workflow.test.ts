import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");

describe("CI benchmark wiring", () => {
  it("exposes the self-benchmark command in package scripts", async () => {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["benchmark:self"]).toBe("bun scripts/self-benchmark.ts");
  });

  it("uploads benchmark artifacts and appends the benchmark Markdown to the job summary", async () => {
    const workflow = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain("bun run benchmark:self");
    expect(workflow).toContain("GITHUB_STEP_SUMMARY");
    expect(workflow).toContain("actions/upload-artifact");
    expect(workflow).toContain("pando-self-benchmark");
  });

  it("comments the benchmark table on pull requests without making the comment mandatory", async () => {
    const workflow = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");

    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("issues: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).toContain("github.event_name == 'pull_request'");
    expect(workflow).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(workflow).toContain("bun run benchmark:comment");
    expect(workflow).toContain('--baseline-branch "${{ github.base_ref }}"');
    expect(workflow).toContain("continue-on-error: true");
  });
});
