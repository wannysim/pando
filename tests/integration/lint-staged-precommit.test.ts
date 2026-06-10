import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "bun:test";

// The pre-commit hook runs `lint-staged`, which feeds the list of staged files
// matching its glob to `oxfmt`. The project's `.oxfmtrc.json` excludes some of
// those files via `ignorePatterns` (README*.md, docs/**, tests/fixtures/**).
//
// Regression for #47: when a commit stages ONLY files that lint-staged's glob
// matches but `.oxfmtrc` ignore rules exclude, oxfmt previously received zero
// target files and treated that as an error — failing the commit and forcing
// `--no-verify`. This affects docs-only commits (README.md) AND supported
// extensions that happen to live under an ignored path (tests/fixtures/*.ts),
// so simply narrowing the glob would NOT cover the latter.
//
// This suite models lint-staged's behaviour against the project's real
// `lint-staged` config + `.oxfmtrc.json` and asserts the formatter command
// does not fail the commit when every staged file is ignore-excluded — while
// still failing on genuine format/parse errors.

const root = resolve(new URL(".", import.meta.url).pathname, "../..");
const oxfmtBin = resolve(root, "node_modules/.bin/oxfmt");

interface LintStagedRule {
  pattern: string;
  command: string;
}

function loadLintStagedRules(): LintStagedRule[] {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    "lint-staged": Record<string, string>;
  };
  return Object.entries(pkg["lint-staged"]).map(([pattern, command]) => ({ pattern, command }));
}

// Minimal model of lint-staged's `*.{ext,...}` glob — matches by file extension.
function extensionsOf(pattern: string): string[] {
  const braced = pattern.match(/^\*\.\{([^}]+)\}$/);
  if (braced?.[1]) return braced[1].split(",").map((e) => e.trim());
  const single = pattern.match(/^\*\.([A-Za-z0-9]+)$/);
  return single?.[1] ? [single[1]] : [];
}

function matches(pattern: string, file: string): boolean {
  const ext = file.split(".").pop() ?? "";
  return extensionsOf(pattern).includes(ext);
}

interface StagedRun {
  exitCode: number;
  output: string;
}

// Replicate what lint-staged does for one commit: in a throwaway repo seeded
// with the project's `.oxfmtrc.json`, create each staged file, then run the
// configured command with the matching files appended. Returns the worst exit
// code seen across rules (0 = commit would succeed).
function runStagedCommit(stagedFiles: Record<string, string>): StagedRun {
  const dir = mkdtempSync(join(tmpdir(), "lint-staged-precommit-"));
  try {
    copyFileSync(resolve(root, ".oxfmtrc.json"), join(dir, ".oxfmtrc.json"));
    for (const [relPath, content] of Object.entries(stagedFiles)) {
      const abs = join(dir, relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }

    const rules = loadLintStagedRules();
    const files = Object.keys(stagedFiles);
    let worst = 0;
    let combined = "";

    for (const rule of rules) {
      const targets = files.filter((f) => matches(rule.pattern, f));
      if (targets.length === 0) continue; // lint-staged skips a rule with no matches
      const [bin = "", ...args] = rule.command.split(/\s+/);
      const executable = bin === "oxfmt" ? oxfmtBin : bin;
      try {
        combined += execFileSync(executable, [...args, ...targets], {
          cwd: dir,
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (err) {
        const e = err as { status?: number; stdout?: string; stderr?: string };
        worst = Math.max(worst, e.status ?? 1);
        combined += (e.stdout ?? "") + (e.stderr ?? "");
      }
    }
    return { exitCode: worst, output: combined };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("pre-commit lint-staged formatter (issue #47)", () => {
  it("succeeds on a docs-only commit (README.md is ignore-excluded)", () => {
    const { exitCode, output } = runStagedCommit({
      "README.md": "# Title\n\nA docs-only change.\n",
    });
    expect(output).not.toMatch(/Expected at least one target file/);
    expect(exitCode).toBe(0);
  });

  it("succeeds when only an ignored fixture is staged, even with a supported extension", () => {
    // tests/fixtures/** is in .oxfmtrc ignorePatterns, but `.ts` is in the glob —
    // narrowing the glob alone would not fix this case.
    const { exitCode, output } = runStagedCommit({
      "tests/fixtures/sample.ts": "export const x = 1;\n",
    });
    expect(output).not.toMatch(/Expected at least one target file/);
    expect(exitCode).toBe(0);
  });

  it("still formats and succeeds on a normal supported file", () => {
    const { exitCode } = runStagedCommit({
      "src/sample.ts": "export const x = 1;\n",
    });
    expect(exitCode).toBe(0);
  });

  it("still fails the commit on a genuine parse error (no over-suppression)", () => {
    const { exitCode } = runStagedCommit({
      "src/broken.ts": "export const = ;\n",
    });
    expect(exitCode).not.toBe(0);
  });
});
