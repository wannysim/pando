import { describe, expect, it } from "vitest";
import { pandoctlUsage, routePandoctl, runPandoctl } from "../../src/cli/pandoctl";

describe("routePandoctl", () => {
  it("routes start to the daemon bootstrap surface", () => {
    expect(routePandoctl(["start"])).toBe("start");
    expect(routePandoctl(["start", "--port", "4000"])).toBe("start");
  });

  it("routes operational commands to the ops surface", () => {
    for (const command of [
      ["list"],
      ["submit", "brief", "--repo", "pando", "--id", "x"],
      ["show", "job-1"],
      ["retry", "job-1", "--from", "IMPL"],
      ["cancel", "job-1"],
      ["cleanup", "job-1"],
      ["watch", "job-1"],
      ["smoke", "readiness"],
      ["daemon", "status"],
    ]) {
      expect(routePandoctl(command)).toBe("ops");
    }
  });

  it("routes empty args and help tokens to help", () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) {
      expect(routePandoctl(argv)).toBe("help");
    }
  });
});

describe("pandoctlUsage", () => {
  it("documents the unified start + operational surface under one binary", () => {
    const text = pandoctlUsage().join("\n");
    expect(text).toContain("pandoctl start");
    expect(text).toContain("pandoctl submit");
    expect(text).toContain("pandoctl list");
    expect(text).toContain("pandoctl show");
    expect(text).toContain("pandoctl retry");
    expect(text).toContain("pandoctl cancel");
    expect(text).toContain("pandoctl cleanup");
    expect(text).toContain("pandoctl watch");
    expect(text).toContain("pandoctl smoke");
  });
});

describe("runPandoctl", () => {
  function handlers(overrides: Partial<Parameters<typeof runPandoctl>[1]> = {}) {
    const calls: { start: string[][]; ops: string[][]; out: string[]; err: string[] } = {
      start: [],
      ops: [],
      out: [],
      err: [],
    };
    const base = {
      async runStart(argv: readonly string[]) {
        calls.start.push([...argv]);
        return 0;
      },
      async runOps(argv: readonly string[]) {
        calls.ops.push([...argv]);
        return 0;
      },
      out: (line: string) => calls.out.push(line),
      err: (line: string) => calls.err.push(line),
    };
    return { calls, handlers: { ...base, ...overrides } };
  }

  it("delegates start, passing the full argv so the start parser sees the command", async () => {
    const { calls, handlers: h } = handlers();
    const code = await runPandoctl(["start", "--port", "4000"], h);
    expect(code).toBe(0);
    expect(calls.start).toEqual([["start", "--port", "4000"]]);
    expect(calls.ops).toEqual([]);
  });

  it("delegates operational commands to the same ops entrypoint", async () => {
    const { calls, handlers: h } = handlers();
    const code = await runPandoctl(["list", "--status", "IMPL"], h);
    expect(code).toBe(0);
    expect(calls.ops).toEqual([["list", "--status", "IMPL"]]);
    expect(calls.start).toEqual([]);
  });

  it("returns the delegated exit code", async () => {
    const { handlers: h } = handlers({
      async runOps() {
        return 7;
      },
    });
    expect(await runPandoctl(["show", "missing"], h)).toBe(7);
  });

  it("prints combined usage to stdout for explicit help and returns 0", async () => {
    const { calls, handlers: h } = handlers();
    const code = await runPandoctl(["help"], h);
    expect(code).toBe(0);
    const text = calls.out.join("\n");
    expect(text).toContain("pandoctl start");
    expect(text).toContain("pandoctl submit");
    expect(calls.err).toEqual([]);
  });

  it("prints usage to stderr and returns 1 for no command", async () => {
    const { calls, handlers: h } = handlers();
    const code = await runPandoctl([], h);
    expect(code).toBe(1);
    const text = calls.err.join("\n");
    expect(text).toContain("pandoctl start");
    expect(text).toContain("pandoctl submit");
    expect(calls.out).toEqual([]);
  });
});
