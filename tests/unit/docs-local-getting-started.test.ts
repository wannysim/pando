import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const root = resolve(new URL(".", import.meta.url).pathname, "../..");

async function readDoc(relPath: string): Promise<string> {
  return readFile(resolve(root, relPath), "utf8");
}

describe("README.md — local run getting-started section", () => {
  it("has a Local run section heading", async () => {
    const readme = await readDoc("README.md");
    expect(readme).toMatch(/##\s+Local run/i);
  });

  it("lists prerequisites: bun install, codex, gh, git", async () => {
    const readme = await readDoc("README.md");
    expect(readme).toContain("bun install");
    expect(readme).toMatch(/`codex`|Codex CLI/);
    expect(readme).toMatch(/OPENAI_API_KEY|OpenAI auth|OpenAI API/i);
    expect(readme).toMatch(/`gh`/);
    expect(readme).toMatch(/`git`/);
  });

  it("links to docs/runbooks/local-pando-runner.md", async () => {
    const readme = await readDoc("README.md");
    expect(readme).toContain("docs/runbooks/local-pando-runner.md");
  });

  it("states Codex is required for the default OpenAI pipeline", async () => {
    const readme = await readDoc("README.md");
    expect(readme).toMatch(/default pipeline.*Codex|Codex.*default pipeline/is);
    expect(readme).toMatch(/gpt-5\.5/);
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

describe("docs/runbooks/local-pando-runner.md — OpenAI default profile accuracy", () => {
  it("lists codex as a required CLI", async () => {
    const runbook = await readDoc("docs/runbooks/local-pando-runner.md");
    expect(runbook).toMatch(/`codex`/);
    expect(runbook).toMatch(/OPENAI_API_KEY|OpenAI auth|OpenAI API/i);
  });

  it("does not present claude as required for the default pipeline", async () => {
    const runbook = await readDoc("docs/runbooks/local-pando-runner.md");
    // claude may appear but must not be a hard requirement in Preconditions;
    // accept: absent entirely, or present only with an "optional"/"alternative" qualifier
    const preconditionsBlock =
      runbook.match(/##\s+Preconditions([\s\S]*?)(?=\n##\s|\s*$)/i)?.[1] ?? "";
    const claudePresent = preconditionsBlock.includes("`claude`");
    const markedOptional = /claude.*optional|optional.*claude/i.test(preconditionsBlock);
    expect(claudePresent && !markedOptional).toBe(false);
  });

  it("mentions that auth is via OpenAI or Codex", async () => {
    const runbook = await readDoc("docs/runbooks/local-pando-runner.md");
    expect(runbook).toMatch(/OpenAI.*auth|auth.*OpenAI|Codex.*auth|auth.*Codex/i);
  });
});
