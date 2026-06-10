import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultManifestPath,
  markRunCleaned,
  markRunFinished,
  readManifest,
  recordRun,
} from "../../src/worktree/run-manifest";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tmp(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pando-manifest-"));
  dirs.push(dir);
  return dir;
}

const run = {
  id: "local-20260607-010101",
  runRoot: "/tmp/pando-local-20260607-010101",
  pid: 4242,
  startedAt: "2026-06-07T01:01:01.000Z",
};

describe("defaultManifestPath", () => {
  it("uses PANDO_HOME when set", () => {
    expect(defaultManifestPath({ PANDO_HOME: "/custom/home" }, "/home/me")).toBe(
      "/custom/home/runs.json",
    );
  });

  it("falls back to ~/.pando when PANDO_HOME is unset", () => {
    expect(defaultManifestPath({}, "/home/me")).toBe("/home/me/.pando/runs.json");
  });
});

describe("readManifest", () => {
  it("returns an empty list when the manifest does not exist yet", async () => {
    const dir = await tmp();
    await expect(readManifest(join(dir, "missing", "runs.json"))).resolves.toEqual([]);
  });

  it("reads back records that were written", async () => {
    const dir = await tmp();
    const path = join(dir, "runs.json");
    await writeFile(path, JSON.stringify([run]), "utf8");

    await expect(readManifest(path)).resolves.toEqual([run]);
  });
});

describe("recordRun", () => {
  it("creates the manifest directory and appends without dropping prior records", async () => {
    const dir = await tmp();
    const path = join(dir, "nested", "runs.json");

    await recordRun(path, run);
    await recordRun(path, { ...run, id: "local-2", runRoot: "/tmp/pando-local-2", pid: 99 });

    const records = await readManifest(path);
    expect(records.map((record) => record.id)).toEqual(["local-20260607-010101", "local-2"]);
  });
});

describe("markRunFinished / markRunCleaned", () => {
  it("stamps finishedAt on the matching run only", async () => {
    const dir = await tmp();
    const path = join(dir, "runs.json");
    await recordRun(path, run);
    await recordRun(path, { ...run, id: "other", runRoot: "/tmp/pando-other", pid: 7 });

    await markRunFinished(path, "other", "2026-06-07T02:00:00.000Z");

    const records = await readManifest(path);
    expect(records.find((r) => r.id === "other")?.finishedAt).toBe("2026-06-07T02:00:00.000Z");
    expect(records.find((r) => r.id === run.id)?.finishedAt).toBeUndefined();
  });

  it("stamps cleanedAt on the matching run only", async () => {
    const dir = await tmp();
    const path = join(dir, "runs.json");
    await recordRun(path, run);

    await markRunCleaned(path, run.id, "2026-06-07T03:00:00.000Z");

    const records = await readManifest(path);
    expect(records[0]?.cleanedAt).toBe("2026-06-07T03:00:00.000Z");
  });

  it("is a no-op when the id is not present", async () => {
    const dir = await tmp();
    const path = join(dir, "runs.json");
    await recordRun(path, run);

    await markRunCleaned(path, "ghost", "2026-06-07T03:00:00.000Z");

    const records = await readManifest(path);
    expect(records[0]?.cleanedAt).toBeUndefined();
  });

  it("writes atomically without leaving a temp file behind", async () => {
    const dir = await tmp();
    const path = join(dir, "runs.json");
    await recordRun(path, run);

    await expect(readFile(`${path}.tmp`, "utf8")).rejects.toThrow();
  });
});
