import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("two-job smoke contract", () => {
  it("documents the live-smoke limits and deterministic fallback requirements", () => {
    const contract = JSON.parse(readFileSync("smoke/two-job-smoke.contract.json", "utf8")) as {
      checks: Array<{ id: string }>;
      fallback: { allowed: boolean; recordReason: boolean };
      jobs: { requiredCount: number };
      limits: { globalConcurrency: { max: number; min: number } };
      live: { requiredEnv: string[] };
    };

    expect(contract.jobs.requiredCount).toBe(2);
    expect(contract.limits.globalConcurrency).toEqual({ max: 3, min: 2 });
    expect(contract.live.requiredEnv).toEqual(
      expect.arrayContaining([
        "PANDO_LIVE_SMOKE=1",
        "PANDO_GLOBAL_CONCURRENCY=2 or 3",
        "Claude/Codex authentication or API key mode",
      ]),
    );
    expect(contract.checks.map((check) => check.id)).toEqual(
      expect.arrayContaining([
        "two-jobs-recorded",
        "worktree-collision",
        "provider-cap",
        "gate-evidence",
      ]),
    );
    expect(contract.fallback).toEqual({ allowed: true, recordReason: true });
  });

  it("runs the deterministic fake smoke and records two non-colliding jobs", () => {
    const dir = mkdtempSync(join(tmpdir(), "pando-smoke-"));
    const evidencePath = join(dir, "fake-smoke.json");

    execFileSync("node", [
      "scripts/two-job-smoke.mjs",
      "--mode",
      "fake",
      "--evidence",
      evidencePath,
    ]);

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      checks: {
        gateEvidence: { pass: boolean };
        globalConcurrency: { value: number; withinLiveCap: boolean };
        providerCap: { pass: boolean };
        worktreeCollision: { pass: boolean };
      };
      jobs: Array<{ id: string; worktreePath: string }>;
      mode: string;
    };

    expect(evidence.mode).toBe("fake");
    expect(evidence.jobs.map((job) => job.id)).toEqual(["SMOKE-FAKE-1", "SMOKE-FAKE-2"]);
    expect(new Set(evidence.jobs.map((job) => job.worktreePath)).size).toBe(2);
    expect(evidence.checks).toEqual({
      gateEvidence: { pass: true },
      globalConcurrency: { value: 2, withinLiveCap: true },
      providerCap: { pass: true },
      worktreeCollision: { pass: true },
    });
  });
});
