import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import process from "node:process";
import { createPandoApiApp, type ReadinessEvidenceSource, type RepoSource } from "./api/app";
import { loadRepoProfilesFromYaml } from "./core/config";
import { createLocalDaemonRuntime, type DaemonLoopController } from "./daemon/local-runtime";
import { createSqliteJobStore } from "./db/index";
import { createFsBriefWriter } from "./intake/brief-materializer";

const DEFAULT_PORT = 3210;
const DEFAULT_DB_PATH = "/tmp/pando.sqlite";

export interface PandoServerOptions {
  briefInboxRoot: string;
  dbPath: string;
  daemon: PandoDaemonServerOptions;
  dashboardRoot?: string;
  readinessEvidencePath?: string;
  host: string;
  port: number;
}

export interface PandoDaemonServerOptions {
  configDir: string;
  enabled: boolean;
  globalConcurrency: number;
  tickMs: number;
  worktreeRoot?: string;
}

export function createPandoServer(opts: PandoServerOptions) {
  const store = createSqliteJobStore({ path: opts.dbPath });
  const app = createPandoApiApp({
    briefMaterializer: { inboxRoot: opts.briefInboxRoot, writer: createFsBriefWriter() },
    readinessSource: fileReadinessSource(opts.readinessEvidencePath),
    repoSource: configDirRepoSource(opts.daemon.configDir),
    staticDashboard:
      opts.dashboardRoot === undefined
        ? undefined
        : { basePath: "/dashboard", root: opts.dashboardRoot },
    store,
  });

  const server = createServer(async (request, response) => {
    try {
      const honoResponse = await app.fetch(toWebRequest(request, opts.host, opts.port));
      response.statusCode = honoResponse.status;
      honoResponse.headers.forEach((value, key) => response.setHeader(key, value));

      if (honoResponse.body === null) {
        response.end();
        return;
      }

      Readable.fromWeb(honoResponse.body).pipe(response);
    } catch (error) {
      /* v8 ignore start -- defensive Node/Hono bridge failure path. */
      response.statusCode = 500;
      response.setHeader("content-type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          error: {
            code: "internal_server_error",
            message: error instanceof Error ? error.message : String(error),
          },
          ok: false,
        }),
      );
      /* v8 ignore stop */
    }
  });

  server.on("close", () => store.close());
  return server;
}

export function serverOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): PandoServerOptions {
  return {
    briefInboxRoot: emptyToUndefined(env.PANDO_BRIEF_INBOX) ?? join(tmpdir(), "pando-briefs"),
    daemon: {
      configDir: env.PANDO_CONFIG_DIR ?? "config",
      enabled: parseBoolean(env.PANDO_DAEMON_ENABLED),
      globalConcurrency: parsePositiveInteger(
        env.PANDO_GLOBAL_CONCURRENCY,
        2,
        "PANDO_GLOBAL_CONCURRENCY",
      ),
      tickMs: parsePositiveInteger(env.PANDO_DAEMON_TICK_MS, 1_000, "PANDO_DAEMON_TICK_MS"),
      worktreeRoot: emptyToUndefined(env.PANDO_WORKTREE_ROOT),
    },
    dashboardRoot: emptyToUndefined(env.PANDO_STATIC_DASHBOARD_ROOT),
    dbPath: emptyToUndefined(env.PANDO_DB) ?? DEFAULT_DB_PATH,
    host: env.PANDO_HOST ?? "127.0.0.1",
    port: parsePositiveInteger(env.PANDO_PORT, DEFAULT_PORT, "PANDO_PORT"),
    readinessEvidencePath: emptyToUndefined(env.PANDO_READINESS_EVIDENCE),
  };
}

function fileReadinessSource(path: string | undefined): ReadinessEvidenceSource | undefined {
  if (path === undefined) return undefined;
  return async () => JSON.parse(await readFile(path, "utf8")) as unknown;
}

function configDirRepoSource(configDir: string): RepoSource {
  return async () => {
    try {
      const yaml = await readFile(join(configDir, "repos.yaml"), "utf8");
      const profiles = await loadRepoProfilesFromYaml(yaml, {
        files: { exists: pathExists },
        homeDir: homedir(),
      });
      return Object.keys(profiles)
        .sort()
        .map((name) => ({ name }));
    } catch {
      return [];
    }
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function toWebRequest(request: IncomingMessage, host: string, port: number): Request {
  const authority = request.headers.host ?? `${host}:${port}`;
  const url = new URL(request.url ?? "/", `http://${authority}`);
  const init: RequestInit & { duplex?: "half" } = {
    headers: requestHeaders(request),
    method: request.method,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request) as ReadableStream;
    init.duplex = "half";
  }

  return new Request(url, init);
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    /* v8 ignore next 4 -- Node normalizes repeated request headers in this server path. */
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(key, entry);
      continue;
    }
    if (value !== undefined) headers.set(key, value);
  }
  return headers;
}

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/* v8 ignore start -- process bootstrap is covered by Docker smoke, not unit tests. */
if (isDirectRun() && !isEmbedded()) {
  void startFromEnv();
}

function isEmbedded(): boolean {
  return (globalThis as { __PANDOCTL_EMBEDDED__?: boolean }).__PANDOCTL_EMBEDDED__ === true;
}

async function startFromEnv(): Promise<void> {
  const opts = serverOptionsFromEnv();
  const daemon = await maybeCreateDaemon(opts);
  const server = createPandoServer(opts);

  server.listen(opts.port, opts.host, () => {
    console.log(`pando listening on http://${opts.host}:${opts.port}`);
    daemon?.start();
  });

  const shutdown = () => {
    daemon?.stop();
    server.close();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function maybeCreateDaemon(
  opts: PandoServerOptions,
): Promise<DaemonLoopController | undefined> {
  if (!opts.daemon.enabled) return undefined;
  return await createLocalDaemonRuntime({
    configDir: opts.daemon.configDir,
    dbPath: opts.dbPath,
    globalConcurrency: opts.daemon.globalConcurrency,
    tickMs: opts.daemon.tickMs,
    worktreeRoot: opts.daemon.worktreeRoot,
    onError(error) {
      console.error(error instanceof Error ? error.message : String(error));
    },
  });
}

function isDirectRun(): boolean {
  return (
    process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href
  );
}
/* v8 ignore stop */
