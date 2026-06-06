import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildClaudeCodeArgs,
  ClaudeCodeEngine,
  DEFAULT_CLAUDE_ALLOWED_TOOLS,
  type CommandRunner,
} from "../../src/engines/claude-code";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("buildClaudeCodeArgs", () => {
  it("builds headless Claude Code args without --mcp-config so managed connectors are inherited", () => {
    const args = buildClaudeCodeArgs({
      cwd: "/worktree",
      prompt: "/implement-jira DEMO-1234 --batch",
      model: "opus",
      timeoutMs: 30_000,
    });

    expect(args).toEqual([
      "-p",
      "/implement-jira DEMO-1234 --batch",
      "--model",
      "opus",
      "--output-format",
      "json",
      "--allowedTools",
      DEFAULT_CLAUDE_ALLOWED_TOOLS.join(","),
    ]);
    expect(args).not.toContain("--mcp-config");
    expect(DEFAULT_CLAUDE_ALLOWED_TOOLS).toContain("Task");
    expect(DEFAULT_CLAUDE_ALLOWED_TOOLS).toContain("mcp__claude_ai_Atlassian");
  });

  it("allows stage-specific allowedTools overrides", () => {
    expect(
      buildClaudeCodeArgs({
        cwd: "/worktree",
        prompt: "review",
        model: "sonnet",
        timeoutMs: 30_000,
        allowedTools: ["Read", "Grep"],
      }),
    ).toContain("Read,Grep");
  });

  it("fails on mcpConfig because it violates ADR-004", () => {
    expect(() =>
      buildClaudeCodeArgs({
        cwd: "/worktree",
        prompt: "plan",
        model: "opus",
        timeoutMs: 30_000,
        mcpConfig: "/tmp/mcp.json",
      }),
    ).toThrow(/mcp-config/i);
  });
});

describe("ClaudeCodeEngine", () => {
  it("passes args, cwd, env, and timeout to the runner and preserves stdout plus stderr", async () => {
    const calls: Parameters<CommandRunner>[] = [];
    const runner: CommandRunner = async (...args) => {
      calls.push(args);
      return { exitCode: 0, stderr: "warn\n", stdout: "{\"ok\":true}\n" };
    };
    const engine = new ClaudeCodeEngine({ command: "claude-test", runner });

    const result = await engine.run({
      cwd: "/worktree",
      env: { IMPLEMENT_JIRA_BATCH: "1" },
      model: "opus",
      prompt: "/implement-jira DEMO-1234 --batch",
      timeoutMs: 30_000,
    });

    expect(result).toEqual({
      ok: true,
      output: "{\"ok\":true}\nwarn\n",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("claude-test");
    expect(calls[0]?.[2]).toMatchObject({
      cwd: "/worktree",
      env: expect.objectContaining({ IMPLEMENT_JIRA_BATCH: "1" }),
      timeoutMs: 30_000,
    });
  });

  it("returns ok=false instead of throwing on non-zero exit code", async () => {
    const engine = new ClaudeCodeEngine({
      runner: async () => ({ exitCode: 2, stderr: "failed\n", stdout: "" }),
    });

    await expect(
      engine.run({
        cwd: "/worktree",
        model: "opus",
        prompt: "plan",
        timeoutMs: 30_000,
      }),
    ).resolves.toEqual({ ok: false, output: "failed\n" });
  });

  it("collects successful CLI output through the default execFile runner", async () => {
    const command = await fakeExecutable("process.stdout.write('ok\\n'); process.stderr.write('warn\\n');");
    const engine = new ClaudeCodeEngine({ command });

    await expect(
      engine.run({
        cwd: "/tmp",
        model: "opus",
        prompt: "plan",
        timeoutMs: 30_000,
      }),
    ).resolves.toEqual({ ok: true, output: "ok\nwarn\n" });
  });

  it("preserves failed stdout and stderr through the default execFile runner", async () => {
    const command = await fakeExecutable(
      "process.stdout.write('out\\n'); process.stderr.write('err\\n'); process.exit(7);",
    );
    const engine = new ClaudeCodeEngine({ command });

    await expect(
      engine.run({
        cwd: "/tmp",
        model: "opus",
        prompt: "plan",
        timeoutMs: 30_000,
      }),
    ).resolves.toEqual({ ok: false, output: "out\nerr\n" });
  });
});

async function fakeExecutable(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pando-claude-engine-"));
  roots.push(root);

  const command = join(root, "fake-claude");
  await writeFile(command, `#!/usr/bin/env node\n${source}\n`);
  await chmod(command, 0o755);
  return command;
}
