import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createPandoServer, serverOptionsFromEnv } from "../../src/server";

const servers: Array<ReturnType<typeof createPandoServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error === undefined ? resolve() : reject(error)));
        }),
    ),
  );
});

describe("Pando HTTP server", () => {
  it("loads runtime options from environment with Docker defaults", () => {
    expect(
      serverOptionsFromEnv({
        PANDO_DB: "/data/pando.sqlite",
        PANDO_HOST: "0.0.0.0",
        PANDO_PORT: "3210",
        PANDO_STATIC_DASHBOARD_ROOT: "/app/dashboard/dist",
      }),
    ).toEqual({
      dashboardRoot: "/app/dashboard/dist",
      dbPath: "/data/pando.sqlite",
      host: "0.0.0.0",
      port: 3210,
    });
    expect(serverOptionsFromEnv({})).toEqual({
      dashboardRoot: undefined,
      dbPath: "./pando.sqlite",
      host: "127.0.0.1",
      port: 3210,
    });
    expect(() => serverOptionsFromEnv({ PANDO_PORT: "0" })).toThrow(
      /PANDO_PORT must be a positive integer/,
    );
  });

  it("bridges Node HTTP requests to Hono API and static dashboard responses", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-server-dashboard-"));
    const dbDir = await mkdtemp(join(tmpdir(), "pando-server-db-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<div>pando dashboard</div>");
    writeFileSync(join(root, "assets", "app.css"), "body { color: black; }");
    const server = createPandoServer({
      dashboardRoot: root,
      dbPath: join(dbDir, "pando.sqlite"),
      host: "127.0.0.1",
      port: 3210,
    });
    servers.push(server);
    await listen(server);
    const baseUrl = serverUrl(server);

    const health = await fetch(`${baseUrl}/health`);
    const brief = await fetch(`${baseUrl}/briefs`, {
      body: JSON.stringify({ id: "smoke-brief", repo: "pando", title: "Smoke brief" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const shell = await fetch(`${baseUrl}/dashboard`);
    const asset = await fetch(`${baseUrl}/dashboard/assets/app.css`);

    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      data: { service: "pando", status: "ok" },
      ok: true,
    });
    expect(brief.status).toBe(201);
    expect(await brief.json()).toMatchObject({
      data: { job: { jobId: "smoke-brief", status: "QUEUED" } },
      ok: true,
    });
    expect(shell.headers.get("content-type")).toContain("text/html");
    expect(await shell.text()).toContain("pando dashboard");
    expect(asset.headers.get("content-type")).toContain("text/css");
    expect(await asset.text()).toContain("color");
  });

  it("handles HEAD requests and repeated Node headers", async () => {
    const dbDir = await mkdtemp(join(tmpdir(), "pando-server-db-"));
    const server = createPandoServer({
      dbPath: join(dbDir, "pando.sqlite"),
      host: "127.0.0.1",
      port: 3210,
    });
    servers.push(server);
    await listen(server);

    const response = await rawRequest(server, {
      headers: { cookie: ["a=1", "b=2"] },
      method: "HEAD",
      path: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
  });
});

async function listen(server: ReturnType<typeof createPandoServer>): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function serverUrl(server: ReturnType<typeof createPandoServer>): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function rawRequest(
  server: ReturnType<typeof createPandoServer>,
  input: {
    headers?: Record<string, string | string[]>;
    method: string;
    path: string;
  },
): Promise<{ body: string; statusCode: number | undefined }> {
  const address = server.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        headers: input.headers,
        host: "127.0.0.1",
        method: input.method,
        path: input.path,
        port: address.port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            statusCode: response.statusCode,
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}
