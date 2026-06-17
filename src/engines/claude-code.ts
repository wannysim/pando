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
  signal?: AbortSignal;
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
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    });

    const telemetry = parseClaudeJsonResult(result.stdout);
    if (telemetry === undefined) {
      return {
        exitCode: result.exitCode,
        ok: result.exitCode === 0,
        output: `${result.stdout}${result.stderr}`,
        timedOut: result.timedOut ?? false,
      };
    }

    return {
      exitCode: result.exitCode,
      ok: result.exitCode === 0,
      output: combineOutput(telemetry.result, result.stderr),
      timedOut: result.timedOut ?? false,
      ...(telemetry.sessionId === undefined ? {} : { sessionId: telemetry.sessionId }),
      ...(telemetry.costUsd === undefined ? {} : { costUsd: telemetry.costUsd }),
    };
  }
}

interface ClaudeJsonResult {
  result: string;
  sessionId?: string;
  costUsd?: number;
}

/**
 * claude `--output-format json` 봉투에서 결정적 텔레메트리를 추출한다.
 * 봉투(`type: "result"` + 문자열 `result`)가 아니면 undefined를 반환해
 * 호출부가 원본 stdout 폴백을 유지하게 한다. usage/model은 ADR-013 후 별도.
 */
export function parseClaudeJsonResult(stdout: string): ClaudeJsonResult | undefined {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.type !== "result" || typeof record.result !== "string") return undefined;

  const sessionId = typeof record.session_id === "string" ? record.session_id : undefined;
  const costUsd = typeof record.total_cost_usd === "number" ? record.total_cost_usd : undefined;

  return {
    result: record.result,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(costUsd === undefined ? {} : { costUsd }),
  };
}

function combineOutput(primary: string, stderr: string): string {
  if (stderr.length === 0) return primary;
  if (primary.length === 0) return stderr;
  return primary.endsWith("\n") ? `${primary}${stderr}` : `${primary}\n${stderr}`;
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
      signal: opts.signal,
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
