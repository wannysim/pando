import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import process from "node:process";
import { createPandoApiApp } from "./api/app";
import { createSqliteJobStore } from "./db/index";

const DEFAULT_PORT = 3210;

export interface PandoServerOptions {
  dbPath: string;
  dashboardRoot?: string;
  host: string;
  port: number;
}

export function createPandoServer(opts: PandoServerOptions) {
  const store = createSqliteJobStore({ path: opts.dbPath });
  const app = createPandoApiApp({
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
    }
  });

  server.on("close", () => store.close());
  return server;
}

export function serverOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): PandoServerOptions {
  return {
    dashboardRoot: emptyToUndefined(env.PANDO_STATIC_DASHBOARD_ROOT),
    dbPath: env.PANDO_DB ?? "./pando.sqlite",
    host: env.PANDO_HOST ?? "127.0.0.1",
    port: parsePositiveInteger(env.PANDO_PORT, DEFAULT_PORT, "PANDO_PORT"),
  };
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

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

/* v8 ignore next 13 -- process bootstrap is covered by Docker smoke, not unit tests. */
if (isDirectRun()) {
  const opts = serverOptionsFromEnv();
  const server = createPandoServer(opts);

  server.listen(opts.port, opts.host, () => {
    console.log(`pando listening on http://${opts.host}:${opts.port}`);
  });

  process.once("SIGINT", () => server.close());
  process.once("SIGTERM", () => server.close());
}

function isDirectRun(): boolean {
  return (
    process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href
  );
}
