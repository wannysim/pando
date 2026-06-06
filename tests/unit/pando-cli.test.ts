import { describe, expect, it } from "vitest";
import {
  formatStartupBanner,
  resolvePandoStartArgs,
  runPandoStart,
  type PandoStartDeps,
  type StartableServer,
} from "../../src/cli/pando";

const FIXED_NOW = new Date("2026-06-07T12:34:56.000Z");

describe("resolvePandoStartArgs", () => {
  it("returns help for empty args, --help, and -h", () => {
    for (const argv of [[], ["--help"], ["-h"], ["help"]]) {
      expect(resolvePandoStartArgs(argv, {}, FIXED_NOW).kind).toBe("help");
    }
  });

  it("returns help for unknown commands", () => {
    expect(resolvePandoStartArgs(["bogus"], {}, FIXED_NOW).kind).toBe("help");
  });

  it("derives local defaults under /tmp with a timestamped run root", () => {
    const resolved = resolvePandoStartArgs(["start"], {}, FIXED_NOW);
    expect(resolved.kind).toBe("start");
    if (resolved.kind !== "start") throw new Error("expected start");

    const root = "/tmp/pando-local-20260607-123456";
    expect(resolved.options).toEqual({
      dashboardRoot: undefined,
      daemon: {
        configDir: "config",
        enabled: true,
        globalConcurrency: 1,
        tickMs: 1_000,
        worktreeRoot: `${root}/worktrees`,
      },
      dbPath: `${root}/pando.sqlite`,
      host: "127.0.0.1",
      port: 3210,
    });
  });

  it("honors flag overrides for port, config-dir, concurrency, and tick", () => {
    const resolved = resolvePandoStartArgs(
      [
        "start",
        "--port",
        "4000",
        "--config-dir",
        "/etc/pando",
        "--concurrency",
        "3",
        "--tick-ms",
        "250",
      ],
      {},
      FIXED_NOW,
    );
    if (resolved.kind !== "start") throw new Error("expected start");
    expect(resolved.options.port).toBe(4000);
    expect(resolved.options.daemon.configDir).toBe("/etc/pando");
    expect(resolved.options.daemon.globalConcurrency).toBe(3);
    expect(resolved.options.daemon.tickMs).toBe(250);
  });

  it("rejects a concurrency outside 1..3", () => {
    expect(() => resolvePandoStartArgs(["start", "--concurrency", "4"], {}, FIXED_NOW)).toThrow(
      /concurrency must be between 1 and 3/,
    );
    expect(() => resolvePandoStartArgs(["start", "--concurrency", "0"], {}, FIXED_NOW)).toThrow(
      /concurrency must be between 1 and 3/,
    );
  });

  it("rejects an invalid port", () => {
    expect(() => resolvePandoStartArgs(["start", "--port", "0"], {}, FIXED_NOW)).toThrow(
      /port must be a positive integer/,
    );
  });
});

describe("formatStartupBanner", () => {
  const banner = formatStartupBanner({
    dbPath: "/tmp/pando-local-x/pando.sqlite",
    port: 3210,
    worktreeRoot: "/tmp/pando-local-x/worktrees",
  });

  it("prints dashboard URL, db path, worktree root, stop, and cleanup hints", () => {
    const text = banner.join("\n");
    expect(text).toContain("http://127.0.0.1:3210/dashboard");
    expect(text).toContain("/tmp/pando-local-x/pando.sqlite");
    expect(text).toContain("/tmp/pando-local-x/worktrees");
    expect(text.toLowerCase()).toContain("ctrl+c");
    expect(text).toContain("rm -rf /tmp/pando-local-x");
  });

  it("never echoes secret-looking env values", () => {
    const text = formatStartupBanner({
      dbPath: "/tmp/x/pando.sqlite",
      port: 3210,
      worktreeRoot: "/tmp/x/worktrees",
    }).join("\n");
    expect(text).not.toMatch(/token|secret|api[_-]?key|password/i);
  });
});

describe("runPandoStart", () => {
  function fakeServer(): StartableServer & { listened: Array<{ host: string; port: number }> } {
    const listened: Array<{ host: string; port: number }> = [];
    return {
      listened,
      address() {
        const last = listened.at(-1);
        return last === undefined ? null : { address: last.host, family: "IPv4", port: last.port };
      },
      listen(port: number, host: string, onListening: () => void) {
        listened.push({ host, port });
        queueMicrotask(onListening);
        return this;
      },
      on() {
        return this;
      },
      close(cb?: (error?: Error) => void) {
        cb?.();
        return this;
      },
    };
  }

  function deps(overrides: Partial<PandoStartDeps> = {}): PandoStartDeps {
    return {
      now: () => FIXED_NOW,
      createServer: () => fakeServer(),
      createDaemon: async () => ({ start() {}, stop() {}, async tick() {} }),
      probePort: async () => true,
      ensureDir: async () => {},
      log: () => {},
      ...overrides,
    };
  }

  it("creates the run root and worktree directories before booting", async () => {
    const made: string[] = [];
    await runPandoStart(["start"], deps({ ensureDir: async (dir) => void made.push(dir) }));
    expect(made).toContain("/tmp/pando-local-20260607-123456");
    expect(made).toContain("/tmp/pando-local-20260607-123456/worktrees");
  });

  it("prints help and returns 0 without booting a server", async () => {
    const lines: string[] = [];
    const code = await runPandoStart(["help"], deps({ log: (line) => lines.push(line) }));
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("pando start");
  });

  it("boots the server and daemon on the default port and logs the banner", async () => {
    const lines: string[] = [];
    let started = false;
    const code = await runPandoStart(
      ["start"],
      deps({
        createDaemon: async () => ({
          start() {
            started = true;
          },
          stop() {},
          async tick() {},
        }),
        log: (line) => lines.push(line),
      }),
    );
    expect(code).toBe(0);
    expect(started).toBe(true);
    expect(lines.join("\n")).toContain("http://127.0.0.1:3210/dashboard");
  });

  it("reports invalid flags with usage and returns 1", async () => {
    const lines: string[] = [];
    const code = await runPandoStart(
      ["start", "--concurrency", "9"],
      deps({ log: (line) => lines.push(line) }),
    );
    expect(code).toBe(1);
    const text = lines.join("\n");
    expect(text).toContain("error: concurrency must be between 1 and 3");
    expect(text).toContain("pando start");
  });

  it("falls back to the next free port when the requested port is in use", async () => {
    const lines: string[] = [];
    const free = new Set([3211]);
    const code = await runPandoStart(
      ["start"],
      deps({
        probePort: async (port) => free.has(port),
        log: (line) => lines.push(line),
      }),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("http://127.0.0.1:3211/dashboard");
  });

  it("fails with a clear error when no port is free in the fallback range", async () => {
    const errors: string[] = [];
    const code = await runPandoStart(
      ["start", "--port", "3210"],
      deps({
        probePort: async () => false,
        log: (line) => errors.push(line),
      }),
    );
    expect(code).toBe(1);
    expect(errors.join("\n").toLowerCase()).toContain("port");
  });
});
