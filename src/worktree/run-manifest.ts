import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RunRecord } from "../core/run-gc";

/**
 * Central run manifest persistence (ADR-012). The manifest lives *outside* any
 * run-root (default `~/.pando/runs.json`) so that a crashed run-root can still
 * be discovered and reaped after its own files are gone.
 */

export function defaultManifestPath(env: NodeJS.ProcessEnv, homeDir: string): string {
  const home =
    env.PANDO_HOME !== undefined && env.PANDO_HOME.length > 0
      ? env.PANDO_HOME
      : join(homeDir, ".pando");
  return join(home, "runs.json");
}

export async function readManifest(path: string): Promise<RunRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  return JSON.parse(raw) as RunRecord[];
}

export async function recordRun(path: string, record: RunRecord): Promise<void> {
  const records = await readManifest(path);
  records.push(record);
  await writeManifest(path, records);
}

export function markRunFinished(path: string, id: string, finishedAt: string): Promise<void> {
  return stamp(path, id, (record) => ({ ...record, finishedAt }));
}

export function markRunCleaned(path: string, id: string, cleanedAt: string): Promise<void> {
  return stamp(path, id, (record) => ({ ...record, cleanedAt }));
}

async function stamp(
  path: string,
  id: string,
  patch: (record: RunRecord) => RunRecord,
): Promise<void> {
  const records = await readManifest(path);
  await writeManifest(
    path,
    records.map((record) => (record.id === id ? patch(record) : record)),
  );
}

async function writeManifest(path: string, records: readonly RunRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(records, undefined, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
