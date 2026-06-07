import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkerEngine, WorkerResult, WorkerRunOptions } from "../core/types";

const execFileAsync = promisify(execFile);

export const DEFAULT_CLAUDE_ALLOWED_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Write",
  "Bash(git *)",
  "Task",
  "mcp__claude_ai_Atlassian",
] as const;

export interface CommandRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export type CommandRunner = (
  command: string,
  args: string[],
  opts: CommandRunnerOptions,
) => Promise<CommandResult>;

export interface ClaudeCodeEngineOptions {
  command?: string;
  runner?: CommandRunner;
}

export function buildClaudeCodeArgs(opts: WorkerRunOptions): string[] {
  if (opts.mcpConfig !== undefined) {
    throw new Error("Claude Code managed connectors must be inherited; --mcp-config is disabled");
  }

  return [
    "-p",
    opts.prompt,
    "--model",
    opts.model,
    "--output-format",
    "json",
    "--allowedTools",
    (opts.allowedTools ?? DEFAULT_CLAUDE_ALLOWED_TOOLS).join(","),
  ];
}

export class ClaudeCodeEngine implements WorkerEngine {
  readonly name = "claude-code";

  private readonly command: string;
  private readonly runner: CommandRunner;

  constructor(opts: ClaudeCodeEngineOptions = {}) {
    this.command = opts.command ?? "claude";
    this.runner = opts.runner ?? execFileRunner;
  }

  async run(opts: WorkerRunOptions): Promise<WorkerResult> {
    const result = await this.runner(this.command, buildClaudeCodeArgs(opts), {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      timeoutMs: opts.timeoutMs,
    });

    return {
      exitCode: result.exitCode,
      ok: result.exitCode === 0,
      output: `${result.stdout}${result.stderr}`,
      timedOut: result.timedOut ?? false,
    };
  }
}

async function execFileRunner(
  command: string,
  args: string[],
  opts: CommandRunnerOptions,
): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      timeout: opts.timeoutMs,
    });
    return { exitCode: 0, stdout: asText(stdout), stderr: asText(stderr) };
  } catch (error) {
    const failure = error as Partial<{
      code: number | string;
      killed: boolean;
      signal: string;
      stdout: string | Buffer;
      stderr: string | Buffer;
    }>;
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stderr: asText(failure.stderr),
      stdout: asText(failure.stdout),
      timedOut: failure.killed === true || failure.signal === "SIGTERM",
    };
  }
}

function asText(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}
