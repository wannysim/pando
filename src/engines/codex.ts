import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkerEngine, WorkerResult, WorkerRunOptions } from "../core/types";

const execFileAsync = promisify(execFile);

export interface CommandRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CodexStreamSummary {
  output: string;
  sessionId?: string;
  costUsd?: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
  opts: CommandRunnerOptions,
) => Promise<CommandResult>;

export interface CodexEngineOptions {
  command?: string;
  runner?: CommandRunner;
}

export function buildCodexArgs(opts: WorkerRunOptions): string[] {
  if (opts.mcpConfig !== undefined) {
    throw new Error("Codex CLI does not accept mcpConfig");
  }
  if (opts.allowedTools !== undefined) {
    throw new Error("Codex CLI does not accept allowedTools");
  }

  return ["exec", "--json", "--sandbox", "workspace-write", "--model", opts.model, opts.prompt];
}

export function parseCodexJsonStream(stream: string): CodexStreamSummary {
  const output: string[] = [];
  let sessionId: string | undefined;
  let costUsd: number | undefined;

  for (const rawLine of stream.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const parsed = parseJsonObject(line);
    if (parsed === undefined) {
      output.push(line);
      continue;
    }

    sessionId = pickString(parsed, ["session_id", "sessionId", "conversation_id"]) ?? sessionId;
    costUsd = pickNumber(parsed, ["cost_usd", "costUsd", "total_cost_usd"]) ?? costUsd;

    const text = pickString(parsed, ["message", "content", "text", "output"]);
    if (text !== undefined) output.push(text);
  }

  return optionalSummary({
    costUsd,
    output: output.join("\n"),
    sessionId,
  });
}

export class CodexEngine implements WorkerEngine {
  readonly name = "codex";

  private readonly command: string;
  private readonly runner: CommandRunner;

  constructor(opts: CodexEngineOptions = {}) {
    this.command = opts.command ?? "codex";
    this.runner = opts.runner ?? execFileRunner;
  }

  async run(opts: WorkerRunOptions): Promise<WorkerResult> {
    const result = await this.runner(this.command, buildCodexArgs(opts), {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      timeoutMs: opts.timeoutMs,
    });
    const parsed = parseCodexJsonStream(result.stdout);

    return {
      ok: result.exitCode === 0,
      output: combineOutput(parsed.output, result.stderr),
      sessionId: parsed.sessionId,
      costUsd: parsed.costUsd,
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
      stdout: string | Buffer;
      stderr: string | Buffer;
    }>;
    return {
      exitCode: typeof failure.code === "number" ? failure.code : 1,
      stdout: asText(failure.stdout),
      stderr: asText(failure.stderr),
    };
  }
}

function parseJsonObject(line: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function pickString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function pickNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return undefined;
}

function optionalSummary(summary: {
  output: string;
  sessionId?: string;
  costUsd?: number;
}): CodexStreamSummary {
  return {
    output: summary.output,
    ...(summary.sessionId === undefined ? {} : { sessionId: summary.sessionId }),
    ...(summary.costUsd === undefined ? {} : { costUsd: summary.costUsd }),
  };
}

function combineOutput(primary: string, stderr: string): string {
  if (stderr.length === 0) return primary;
  if (primary.length === 0) return stderr;
  return primary.endsWith("\n") ? `${primary}${stderr}` : `${primary}\n${stderr}`;
}

function asText(value: string | Buffer | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : value.toString("utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
