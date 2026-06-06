import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCodexArgs,
  CodexEngine,
  parseCodexJsonStream,
  type CommandRunner,
} from "../../src/engines/codex";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("buildCodexArgs", () => {
  it("forces codex exec JSON stream mode and the workspace-write sandbox", () => {
    expect(
      buildCodexArgs({
        cwd: "/worktree",
        model: "gpt-5-codex",
        prompt: "Implement PLAN.md",
        timeoutMs: 30_000,
      }),
    ).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5-codex",
      "Implement PLAN.md",
    ]);
  });

  it("rejects mcpConfig and allowedTools because they are outside the Codex CLI contract", () => {
    expect(() =>
      buildCodexArgs({
        cwd: "/worktree",
        mcpConfig: "/tmp/mcp.json",
        model: "gpt-5-codex",
        prompt: "Implement",
        timeoutMs: 30_000,
      }),
    ).toThrow(/mcpConfig/i);
    expect(() =>
      buildCodexArgs({
        allowedTools: ["Read"],
        cwd: "/worktree",
        model: "gpt-5-codex",
        prompt: "Implement",
        timeoutMs: 30_000,
      }),
    ).toThrow(/allowedTools/i);
  });
});

describe("parseCodexJsonStream", () => {
  it("extracts sessionId, cost, and final output from JSON lines", () => {
    expect(
      parseCodexJsonStream(
        [
          JSON.stringify({ session_id: "sess-1", type: "started" }),
          JSON.stringify({ type: "message", message: "first" }),
          JSON.stringify({ type: "message", content: "second" }),
          JSON.stringify({ cost_usd: 0.42, type: "completed" }),
        ].join("\n"),
      ),
    ).toEqual({
      costUsd: 0.42,
      output: "first\nsecond",
      sessionId: "sess-1",
    });
  });

  it("preserves non-JSON lines as output evidence", () => {
    expect(parseCodexJsonStream("plain line\n")).toEqual({ output: "plain line" });
  });
});

describe("CodexEngine", () => {
  it("passes args, cwd, env, and timeout to the runner and returns parsed output", async () => {
    const calls: Parameters<CommandRunner>[] = [];
    const runner: CommandRunner = async (...args) => {
      calls.push(args);
      return {
        exitCode: 0,
        stderr: "warn\n",
        stdout: `${JSON.stringify({ sessionId: "sess-1", text: "done", total_cost_usd: 1.5 })}\n`,
      };
    };
    const engine = new CodexEngine({ command: "codex-test", runner });

    const result = await engine.run({
      cwd: "/worktree",
      env: { PANDO_STAGE: "IMPL" },
      model: "gpt-5-codex",
      prompt: "Implement PLAN.md",
      timeoutMs: 30_000,
    });

    expect(result).toEqual({
      costUsd: 1.5,
      ok: true,
      output: "done\nwarn\n",
      sessionId: "sess-1",
    });
    expect(calls[0]?.[0]).toBe("codex-test");
    expect(calls[0]?.[2]).toMatchObject({
      cwd: "/worktree",
      env: expect.objectContaining({ PANDO_STAGE: "IMPL" }),
      timeoutMs: 30_000,
    });
  });

  it("preserves successful and failed output through the default process runner", async () => {
    const success = new CodexEngine({
      command: await fakeExecutable("process.stdout.write(JSON.stringify({text:'ok'}) + '\\n');"),
    });
    const failure = new CodexEngine({
      command: await fakeExecutable(
        "process.stdout.write('out\\n'); process.stderr.write('err\\n'); process.exit(9);",
      ),
    });

    await expect(
      success.run({
        cwd: "/tmp",
        model: "gpt-5-codex",
        prompt: "Implement",
        timeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({ ok: true, output: "ok" });
    await expect(
      failure.run({
        cwd: "/tmp",
        model: "gpt-5-codex",
        prompt: "Implement",
        timeoutMs: 30_000,
      }),
    ).resolves.toEqual({ ok: false, output: "out\nerr\n" });
  });

  it("closes stdin for the default runner so codex exec does not wait for input", async () => {
    const command = await fakeExecutable(`
      const timeout = setTimeout(() => {
        process.stderr.write('stdin still open\\n');
        process.exit(7);
      }, 100);
      process.stdin.resume();
      process.stdin.on('end', () => {
        clearTimeout(timeout);
        process.stdout.write(JSON.stringify({ text: 'stdin closed' }) + '\\n');
      });
    `);
    const engine = new CodexEngine({ command });

    await expect(
      engine.run({
        cwd: "/tmp",
        model: "gpt-5-codex",
        prompt: "Implement",
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ ok: true, output: "stdin closed" });
  });

  it("returns deterministic failure output when the default runner cannot spawn codex", async () => {
    const engine = new CodexEngine({ command: "/tmp/pando-missing-codex-command" });

    await expect(
      engine.run({
        cwd: "/tmp",
        model: "gpt-5-codex",
        prompt: "Implement",
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({
      ok: false,
      output: expect.stringContaining("ENOENT"),
    });
  });

  it("terminates the default runner when the command exceeds the stage timeout", async () => {
    const command = await fakeExecutable(`
      process.stdout.write('started\\n');
      setInterval(() => {}, 1000);
    `);
    const engine = new CodexEngine({ command });

    await expect(
      engine.run({
        cwd: "/tmp",
        model: "gpt-5-codex",
        prompt: "Implement",
        timeoutMs: 50,
      }),
    ).resolves.toMatchObject({ ok: false });
  });
});

async function fakeExecutable(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pando-codex-engine-"));
  roots.push(root);

  const command = join(root, "fake-codex");
  await writeFile(command, `#!/usr/bin/env node\n${source}\n`);
  await chmod(command, 0o755);
  return command;
}
