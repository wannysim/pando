import { describe, expect, it } from "bun:test";
import { CountingSemaphore } from "../../src/scheduler/semaphore";
import { createRunScheduler } from "../../src/scheduler/scheduler";
import type { RepoProfile } from "../../src/core/types";

describe("createRunScheduler", () => {
  it("enforces the global in-flight cap across repositories", () => {
    const scheduler = createRunScheduler({
      globalConcurrency: 2,
      providerConcurrency: {},
    });

    const first = scheduler.tryAcquire({
      jobId: "DEMO-5001",
      profile: repoProfile({ concurrency: 5 }),
      repo: "web",
    });
    const second = scheduler.tryAcquire({
      jobId: "DEMO-5002",
      profile: repoProfile({ concurrency: 5 }),
      repo: "api",
    });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(
      scheduler.tryAcquire({
        jobId: "DEMO-5003",
        profile: repoProfile({ concurrency: 5 }),
        repo: "personal-site",
      }),
    ).toBeUndefined();

    first?.release();

    expect(
      scheduler.tryAcquire({
        jobId: "DEMO-5003",
        profile: repoProfile({ concurrency: 5 }),
        repo: "personal-site",
      }),
    ).toBeDefined();
  });

  it("enforces per-repo caps without blocking unrelated repositories", () => {
    const scheduler = createRunScheduler({
      globalConcurrency: 5,
      providerConcurrency: {},
    });

    const webProfile = repoProfile({ concurrency: 1 });
    const apiProfile = repoProfile({ concurrency: 2 });

    expect(
      scheduler.tryAcquire({ jobId: "DEMO-5101", profile: webProfile, repo: "web" }),
    ).toBeDefined();
    expect(
      scheduler.tryAcquire({ jobId: "DEMO-5102", profile: webProfile, repo: "web" }),
    ).toBeUndefined();
    expect(
      scheduler.tryAcquire({ jobId: "DEMO-5103", profile: apiProfile, repo: "api" }),
    ).toBeDefined();
  });

  it("uses RepoProfile context providers for provider caps", () => {
    const scheduler = createRunScheduler({
      globalConcurrency: 5,
      providerConcurrency: { confluence: 1, figma: 1 },
    });

    const confluenceProfile = repoProfile({
      concurrency: 5,
      providers: ["confluence"],
    });
    const figmaProfile = repoProfile({
      concurrency: 5,
      providers: ["figma"],
    });
    const briefOnlyProfile = repoProfile({ concurrency: 5, providers: [] });

    expect(
      scheduler.tryAcquire({
        jobId: "DEMO-5201",
        profile: confluenceProfile,
        repo: "web",
      }),
    ).toBeDefined();
    expect(
      scheduler.tryAcquire({
        jobId: "DEMO-5202",
        profile: confluenceProfile,
        repo: "api",
      }),
    ).toBeUndefined();
    expect(
      scheduler.tryAcquire({
        jobId: "DEMO-5203",
        profile: figmaProfile,
        repo: "design-system",
      }),
    ).toBeDefined();
    expect(
      scheduler.tryAcquire({
        jobId: "brief-5204",
        profile: briefOnlyProfile,
        repo: "personal-site",
      }),
    ).toBeDefined();
  });

  it("releases all acquired counters exactly once", () => {
    const scheduler = createRunScheduler({
      globalConcurrency: 1,
      providerConcurrency: { confluence: 1 },
    });
    const profile = repoProfile({ concurrency: 1, providers: ["confluence"] });
    const lease = scheduler.tryAcquire({ jobId: "DEMO-5301", profile, repo: "web" });

    lease?.release();
    lease?.release();

    expect(scheduler.tryAcquire({ jobId: "DEMO-5302", profile, repo: "web" })).toBeDefined();
  });

  it("tracks active job ids and rejects duplicate acquisition", () => {
    const scheduler = createRunScheduler({
      globalConcurrency: 2,
      providerConcurrency: {},
    });
    const profile = repoProfile({ concurrency: 2, providers: ["confluence"] });

    const lease = scheduler.tryAcquire({ jobId: "DEMO-5401", profile, repo: "web" });

    expect(scheduler.maxConcurrency).toBe(2);
    expect(scheduler.activeJobIds).toEqual(["DEMO-5401"]);
    expect(scheduler.tryAcquire({ jobId: "DEMO-5401", profile, repo: "web" })).toBeUndefined();

    lease?.release();

    expect(scheduler.activeJobIds).toEqual([]);
  });

  it("rejects invalid semaphore capacities", () => {
    expect(() => new CountingSemaphore(0)).toThrow(/positive integer/i);
  });
});

function repoProfile(opts: {
  concurrency: number;
  providers?: RepoProfile["context"]["providers"];
}): RepoProfile {
  return {
    baseBranch: "develop",
    concurrency: opts.concurrency,
    context: { policyRefs: [], providers: opts.providers ?? [] },
    contextProviders: opts.providers ?? [],
    conventions: "repo-local",
    gates: { test: "test" },
    guards: { forbidTestEditInImpl: true, protectedBranches: ["develop"] },
    packageManager: "pnpm",
    path: "/repo",
    portRange: [3000, 3099],
    scope: "external",
    setup: "install",
    intake: { sources: ["jira"] },
    workItemSource: "jira",
  };
}
