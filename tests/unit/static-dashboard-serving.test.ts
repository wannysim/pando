import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPandoApiApp } from "../../src/api/app";

describe("production dashboard static serving", () => {
  it("serves the SPA under /dashboard without shadowing Hono API routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-dashboard-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), '<div id="root">pando dashboard</div>');
    writeFileSync(join(root, "assets", "app.js"), 'console.log("dashboard");');
    writeFileSync(join(root, "assets", "app.css"), "body { color: black; }");
    writeFileSync(join(root, "assets", "icon.svg"), "<svg />");
    writeFileSync(join(root, "assets", "meta.json"), '{"ok":true}');
    writeFileSync(join(root, "assets", "logo.png"), "png");
    writeFileSync(join(root, "assets", "favicon.ico"), "ico");
    writeFileSync(join(root, "assets", "font.woff2"), "font");
    const app = createPandoApiApp({
      staticDashboard: { basePath: "/dashboard", root },
      store: {
        cancelJob: () => {
          throw new Error("unused");
        },
        enqueueJob: () => {
          throw new Error("unused");
        },
        getJob: () => undefined,
        listEvents: () => [],
        listJobs: () => [],
        requestJobCleanup: () => {
          throw new Error("unused");
        },
        retryJob: () => {
          throw new Error("unused");
        },
      },
    });

    const health = await app.request("/health");
    const apiMiss = await app.request("/jobs/missing");
    const shell = await app.request("/dashboard");
    const deepLink = await app.request("/dashboard/jobs/DEMO-1");
    const asset = await app.request("/dashboard/assets/app.js");
    const stylesheet = await app.request("/dashboard/assets/app.css");
    const svg = await app.request("/dashboard/assets/icon.svg");
    const json = await app.request("/dashboard/assets/meta.json");
    const png = await app.request("/dashboard/assets/logo.png");
    const ico = await app.request("/dashboard/assets/favicon.ico");
    const binary = await app.request("/dashboard/assets/font.woff2");

    expect(health.headers.get("content-type")).toContain("application/json");
    expect(apiMiss.status).toBe(404);
    expect(await apiMiss.json()).toEqual({
      error: { code: "job_not_found", message: "job not found: missing" },
      ok: false,
    });
    expect(shell.headers.get("content-type")).toContain("text/html");
    expect(await shell.text()).toContain("pando dashboard");
    expect(deepLink.headers.get("content-type")).toContain("text/html");
    expect(await deepLink.text()).toContain("pando dashboard");
    expect(asset.headers.get("content-type")).toContain("javascript");
    expect(await asset.text()).toContain("dashboard");
    expect(stylesheet.headers.get("content-type")).toContain("text/css");
    expect(svg.headers.get("content-type")).toContain("image/svg+xml");
    expect(json.headers.get("content-type")).toContain("application/json");
    expect(png.headers.get("content-type")).toContain("image/png");
    expect(ico.headers.get("content-type")).toContain("image/x-icon");
    expect(binary.headers.get("content-type")).toContain("application/octet-stream");
  });

  it("keeps static misses and traversal attempts as structured errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "pando-dashboard-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<div>shell</div>");
    const app = createPandoApiApp({
      staticDashboard: { basePath: "/dashboard", root },
      store: {
        cancelJob: () => {
          throw new Error("unused");
        },
        enqueueJob: () => {
          throw new Error("unused");
        },
        getJob: () => undefined,
        listEvents: () => [],
        listJobs: () => [],
        requestJobCleanup: () => {
          throw new Error("unused");
        },
        retryJob: () => {
          throw new Error("unused");
        },
      },
    });

    const missing = await app.request("/dashboard/assets/missing.js");
    const traversal = await app.request("/dashboard/assets/%2e%2e%2f%2e%2e%2fpackage.json");

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "static_asset_not_found", message: "static asset not found" },
      ok: false,
    });
    expect(traversal.status).toBe(400);
    expect(await traversal.json()).toEqual({
      error: { code: "invalid_static_path", message: "invalid static asset path" },
      ok: false,
    });
  });
});
