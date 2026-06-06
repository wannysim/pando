import { mkdir } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createPandoServer, type PandoServerOptions } from "../server";
import { createLocalDaemonRuntime, type DaemonLoopController } from "../daemon/local-runtime";

const DEFAULT_PORT = 3210;
const DEFAULT_HOST = "127.0.0.1";
const PORT_FALLBACK_ATTEMPTS = 10;
const MIN_CONCURRENCY = 1;
const MAX_CONCURRENCY = 3;

export interface StartableServer {
  address(): { address: string; family: string; port: number } | string | null;
  close(callback?: (error?: Error) => void): unknown;
  listen(port: number, host: string, onListening: () => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface PandoStartDeps {
  now(): Date;
  createServer(options: PandoServerOptions): StartableServer;
  createDaemon(options: PandoServerOptions): Promise<DaemonLoopController | undefined>;
  probePort(port: number, host: string): Promise<boolean>;
  ensureDir(path: string): Promise<void>;
  log(line: string): void;
}

export type ResolvedStartArgs = { kind: "help" } | { kind: "start"; options: PandoServerOptions };

export function resolvePandoStartArgs(
  argv: readonly string[],
  _env: NodeJS.ProcessEnv,
  now: Date,
): ResolvedStartArgs {
  const [command, ...rest] = argv;
  if (command !== "start") return { kind: "help" };

  const options = parseFlags(rest);
  const runRoot = `/tmp/pando-local-${timestampSlug(now)}`;

  return {
    kind: "start",
    options: {
      briefInboxRoot: `${runRoot}/briefs`,
      dashboardRoot: undefined,
      daemon: {
        configDir: options.configDir ?? "config",
        enabled: true,
        globalConcurrency: options.concurrency ?? MIN_CONCURRENCY,
        tickMs: options.tickMs ?? 1_000,
        worktreeRoot: `${runRoot}/worktrees`,
      },
      dbPath: `${runRoot}/pando.sqlite`,
      host: DEFAULT_HOST,
      port: options.port ?? DEFAULT_PORT,
    },
  };
}

export function formatStartupBanner(input: {
  dbPath: string;
  port: number;
  worktreeRoot: string;
}): string[] {
  const runRoot = runRootOf(input.worktreeRoot);
  return [
    "pando is running.",
    `  Dashboard:     http://${DEFAULT_HOST}:${input.port}/dashboard`,
    `  API health:    http://${DEFAULT_HOST}:${input.port}/health`,
    `  DB path:       ${input.dbPath}`,
    `  Worktree root: ${input.worktreeRoot}`,
    "  Stop:          press Ctrl+C",
    `  Cleanup:       rm -rf ${runRoot}`,
  ];
}

export async function runPandoStart(
  argv: readonly string[],
  deps: PandoStartDeps,
): Promise<number> {
  let resolved: ResolvedStartArgs;
  try {
    resolved = resolvePandoStartArgs(argv, process.env, deps.now());
  } catch (error) {
    deps.log(`error: ${error instanceof Error ? error.message : String(error)}`);
    deps.log("");
    for (const line of usageLines()) deps.log(line);
    return 1;
  }

  if (resolved.kind === "help") {
    for (const line of usageLines()) deps.log(line);
    return 0;
  }

  const port = await resolveAvailablePort(resolved.options.port, resolved.options.host, deps);
  if (port === undefined) {
    deps.log(
      `error: port ${resolved.options.port} is in use and no free port was found in the next ${PORT_FALLBACK_ATTEMPTS} ports.`,
    );
    deps.log("Pass --port <n> to choose another port.");
    return 1;
  }

  const options: PandoServerOptions = { ...resolved.options, port };
  const worktreeRoot = options.daemon.worktreeRoot ?? `${options.dbPath}/worktrees`;
  await deps.ensureDir(runRootOf(worktreeRoot));
  await deps.ensureDir(worktreeRoot);
  const daemon = await deps.createDaemon(options);
  const server = deps.createServer(options);

  await new Promise<void>((resolve) => {
    server.listen(options.port, options.host, () => {
      daemon?.start();
      resolve();
    });
  });

  for (const line of formatStartupBanner({
    dbPath: options.dbPath,
    port: options.port,
    worktreeRoot: options.daemon.worktreeRoot ?? `${options.dbPath}/worktrees`,
  })) {
    deps.log(line);
  }

  return 0;
}

async function resolveAvailablePort(
  requested: number,
  host: string,
  deps: PandoStartDeps,
): Promise<number | undefined> {
  for (let offset = 0; offset < PORT_FALLBACK_ATTEMPTS; offset += 1) {
    const candidate = requested + offset;
    if (await deps.probePort(candidate, host)) return candidate;
  }
  return undefined;
}

interface StartFlags {
  concurrency?: number;
  configDir?: string;
  port?: number;
  tickMs?: number;
}

function parseFlags(args: readonly string[]): StartFlags {
  const flags: StartFlags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    const value = args[index + 1];
    if (value === undefined) throw new Error(`${token}: expected value`);
    index += 1;

    switch (token) {
      case "--port":
        flags.port = positiveInteger(value, "port");
        break;
      case "--config-dir":
        flags.configDir = value;
        break;
      case "--concurrency":
        flags.concurrency = concurrency(value);
        break;
      case "--tick-ms":
        flags.tickMs = positiveInteger(value, "tick-ms");
        break;
      default:
        throw new Error(`unknown flag: ${token}`);
    }
  }
  return flags;
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function concurrency(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < MIN_CONCURRENCY || parsed > MAX_CONCURRENCY) {
    throw new Error(`concurrency must be between ${MIN_CONCURRENCY} and ${MAX_CONCURRENCY}`);
  }
  return parsed;
}

function runRootOf(worktreeRoot: string): string {
  return worktreeRoot.replace(/\/worktrees$/, "");
}

function timestampSlug(now: Date): string {
  const iso = now.toISOString();
  const date = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `${date}-${time}`;
}

function usageLines(): string[] {
  return [
    "pando — one-command local run",
    "",
    "Usage:",
    "  pando start [--port <n>] [--config-dir <dir>] [--concurrency <1-3>] [--tick-ms <ms>]",
    "  pando help",
    "",
    "Defaults:",
    "  DB + worktree: /tmp/pando-local-<timestamp>",
    "  config dir:    config",
    "  dashboard:     http://127.0.0.1:3210/dashboard",
    "  daemon:        enabled, global concurrency 1",
    "",
    "If the port is in use, pando tries the next free port automatically.",
  ];
}

/* v8 ignore start -- process bootstrap and real sockets are covered by the runbook, not unit tests. */
function defaultProbePort(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

if (isDirectRun()) {
  void runPandoStart(process.argv.slice(2), {
    now: () => new Date(),
    createServer: (options) => createPandoServer(options) as unknown as StartableServer,
    createDaemon: (options) =>
      options.daemon.enabled
        ? createLocalDaemonRuntime({
            configDir: options.daemon.configDir,
            dbPath: options.dbPath,
            globalConcurrency: options.daemon.globalConcurrency,
            tickMs: options.daemon.tickMs,
            worktreeRoot: options.daemon.worktreeRoot,
            onError(error) {
              console.error(error instanceof Error ? error.message : String(error));
            },
          })
        : Promise.resolve(undefined),
    probePort: defaultProbePort,
    ensureDir: async (path) => void (await mkdir(path, { recursive: true })),
    log: (line) => console.log(line),
  }).then((code) => {
    if (code !== 0) process.exitCode = code;
  });
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}
/* v8 ignore stop */
