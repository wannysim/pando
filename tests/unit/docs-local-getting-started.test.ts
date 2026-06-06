import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");

async function readDoc(relPath: string): Promise<string> {
  return readFile(resolve(root, relPath), "utf8");
}

describe("README.md — local run getting-started section", () => {
  it("has a Local run section heading", async () => {
    const readme = await readDoc("README.md");
    expect(readme).toMatch(/##\s+Local run/i);
  });

  it("lists prerequisites: pnpm install, claude, gh, git", async () => {
    const readme = await readDoc("README.md");
    expect(readme).toContain("pnpm install");
    expect(readme).toMatch(/`claude`|claude CLI/);
    expect(readme).toMatch(/`gh`/);
    expect(readme).toMatch(/`git`/);
  });

  it("links to docs/runbooks/local-pando-runner.md", async () => {
    const readme = await readDoc("README.md");
    expect(readme).toContain("docs/runbooks/local-pando-runner.md");
  });

  it("states Claude Code is required for all pipeline stages (post-PR #33)", async () => {
    const readme = await readDoc("README.md");
    // AC #3: Claude Code required for all pipeline stages post-PR #33
    expect(readme).toMatch(/Claude Code.*all.*stage|all.*stage.*Claude Code/is);
  });

  it("states gh is required for the PR creation stage", async () => {
    const readme = await readDoc("README.md");
    // AC #3: gh required for PR creation stage
    expect(readme).toMatch(/`gh`.*PR|PR.*`gh`/is);
  });

  it("states evidence and temp DB files are written under /tmp", async () => {
    const readme = await readDoc("README.md");
    // AC #3: evidence and temp DB under /tmp
    expect(readme).toContain("/tmp");
  });
});

describe("docs/runbooks/local-pando-runner.md — all-Claude profile accuracy", () => {
  it("lists claude as a required CLI", async () => {
    const runbook = await readDoc("docs/runbooks/local-pando-runner.md");
    expect(runbook).toMatch(/`claude`/);
  });

  it("does not present codex as required for the default pipeline", async () => {
    const runbook = await readDoc("docs/runbooks/local-pando-runner.md");
    // codex may appear but must not be a hard requirement in Preconditions;
    // accept: absent entirely, or present only with an "optional"/"alternative" qualifier
    const preconditionsBlock =
      runbook.match(/##\s+Preconditions([\s\S]*?)(?=\n##\s|\s*$)/i)?.[1] ?? "";
    const codePresent = preconditionsBlock.includes("`codex`");
    const markedOptional = /codex.*optional|optional.*codex/i.test(preconditionsBlock);
    expect(codePresent && !markedOptional).toBe(false);
  });

  it("mentions that auth is via Claude (not Codex-only)", async () => {
    const runbook = await readDoc("docs/runbooks/local-pando-runner.md");
    // auth line should reference Claude auth
    expect(runbook).toMatch(/Claude.*auth|auth.*Claude/i);
  });
});
