import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");

async function readDoc(relPath: string): Promise<string> {
  return readFile(resolve(root, relPath), "utf8");
}

function prohibitionPattern(phrase: string): RegExp {
  return new RegExp(
    `(?:${phrase}[\\s\\S]*(?:not|never|avoid|do not)|(?:not|never|avoid|do not)[\\s\\S]*${phrase})`,
    "i",
  );
}

describe("docs/runbooks/pando-self-benchmark.md", () => {
  it("documents the local self-benchmark artifact locations under /tmp", async () => {
    const runbook = await readDoc("docs/runbooks/pando-self-benchmark.md");

    expect(runbook).toContain("/tmp");
    expect(runbook).toMatch(/local daemon run roots/i);
    expect(runbook).toMatch(/structured evidence JSON/i);
    expect(runbook).toMatch(/temporary databases/i);
    expect(runbook).toMatch(/worktree evidence/i);
  });

  it("uses daemon stage event payloads as the duration source of truth", async () => {
    const runbook = await readDoc("docs/runbooks/pando-self-benchmark.md");

    expect(runbook).toContain("stage-completed");
    expect(runbook).toContain("stage-failed");
    expect(runbook).toMatch(/duration/i);
    expect(runbook).toMatch(/event payloads/i);
  });

  it("rejects worker prose and LLM output text as duration evidence", async () => {
    const runbook = await readDoc("docs/runbooks/pando-self-benchmark.md");

    expect(runbook).toMatch(prohibitionPattern("worker log prose"));
    expect(runbook).toMatch(prohibitionPattern("LLM output text"));
  });

  it("includes the exact Draft PR lookup command", async () => {
    const runbook = await readDoc("docs/runbooks/pando-self-benchmark.md");

    expect(runbook).toContain("gh pr list --head <branch>");
  });
});
