import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

// When everything is bundled into one file, every module shares the same
// import.meta.url, so the per-module isDirectRun() guards would all fire at
// once. This flag lets the embedded pando/agentctl modules know that pandoctl
// owns the process entry, so they skip their own auto-run.
(globalThis as { __PANDOCTL_EMBEDDED__?: boolean }).__PANDOCTL_EMBEDDED__ = true;

export type PandoctlRoute = "start" | "ops" | "help";

const HELP_TOKENS: readonly string[] = ["help", "--help", "-h"];

export interface PandoctlHandlers {
  runStart(argv: readonly string[]): Promise<number>;
  runOps(argv: readonly string[]): Promise<number>;
  out(line: string): void;
  err(line: string): void;
}

export function routePandoctl(argv: readonly string[]): PandoctlRoute {
  const [command] = argv;
  if (command === "start") return "start";
  if (command === undefined || HELP_TOKENS.includes(command)) return "help";
  return "ops";
}

export async function runPandoctl(
  argv: readonly string[],
  handlers: PandoctlHandlers,
): Promise<number> {
  const route = routePandoctl(argv);
  if (route === "start") return handlers.runStart(argv);
  if (route === "ops") return handlers.runOps(argv);

  const emitToStderr = argv.length === 0;
  for (const line of pandoctlUsage()) (emitToStderr ? handlers.err : handlers.out)(line);
  return emitToStderr ? 1 : 0;
}

export function pandoctlUsage(): string[] {
  return [
    "pandoctl — pando local daemon + operations CLI",
    "",
    "Usage:",
    "  pandoctl start [--port <n>] [--config-dir <dir>] [--concurrency <1-3>] [--tick-ms <ms>]",
    "  pandoctl submit jira <ticket> --repo <repo> [--title <title>] [--branch <branch>]",
    "  pandoctl submit brief --repo <repo> --id <id> [--title <title>] [--brief-path <path>]",
    "  pandoctl list [--status <status>] [--watch] [--interval <ms>] [--max-polls <n>]",
    "  pandoctl show <job-id>",
    "  pandoctl retry <job-id> --from <stage> [--attempts <n>]",
    "  pandoctl cancel <job-id> [--reason <reason>]",
    "  pandoctl cleanup <job-id>",
    "  pandoctl watch <job-id> [--interval <ms>] [--max-polls <n>]",
    "  pandoctl daemon status",
    "  pandoctl smoke readiness [--target host|docker] [--evidence <path>]",
    "  pandoctl help",
    "",
    "start boots a local daemon/dashboard/API; the other commands operate the same job store.",
  ];
}

/* v8 ignore start -- process bootstrap is covered by bin-wrapper and runbook tests, not unit tests. */
async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const { runPandoStartCli } = await import("./pando");
  const { main: runAgentctl } = await import("./agentctl");
  return runPandoctl(argv, {
    runStart: (start) => runPandoStartCli(start),
    runOps: (ops) => runAgentctl([...ops]),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
}

if (isDirectRun()) {
  void main().then((code) => {
    process.exitCode = code;
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  // Global installs expose the bin as a symlink, so argv[1] is the symlink path
  // while import.meta.url is the real bundle path. Resolve to compare reliably.
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}
/* v8 ignore stop */
