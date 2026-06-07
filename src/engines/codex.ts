import { spawn } from "node:child_process";
import type { WorkerEngine, WorkerResult, WorkerRunOptions } from "../core/types";

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
    this.runner = opts.runner ?? spawnRunner;
  }

  async run(opts: WorkerRunOptions): Promise<WorkerResult> {
    const result = await this.runner(this.command, buildCodexArgs(opts), {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      signal: opts.signal,
      timeoutMs: opts.timeoutMs,
    });
    const parsed = parseCodexJsonStream(result.stdout);

    return {
      costUsd: parsed.costUsd,
      exitCode: result.exitCode,
      ok: result.exitCode === 0,
      output: combineOutput(parsed.output, result.stderr),
      sessionId: parsed.sessionId,
      timedOut: result.timedOut ?? false,
    };
  }
}

async function spawnRunner(
  command: string,
  args: string[],
  opts: CommandRunnerOptions,
): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let settled = false;
    let timedOut = false;
    const maxBuffer = 10 * 1024 * 1024;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, opts.timeoutMs);

    const onAbort = () => child.kill("SIGTERM");
    if (opts.signal?.aborted === true) child.kill("SIGTERM");
    else opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < maxBuffer) stdout += asText(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < maxBuffer) stderr += asText(chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: 1, stderr: error.message, stdout });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: typeof code === "number" ? code : 1, stderr, stdout, timedOut });
    });
  });
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
