import { describe, expect, it } from "vitest";
import type { GateContext } from "../../src/core/types";
import {
  createChecksumGate,
  createChecksumManifest,
  evaluateChecksumManifest,
} from "../../src/pipeline/gates/checksum";

describe("checksum safety gate", () => {
  it("records a stable TEST-stage manifest for test and critical files", () => {
    const manifest = createChecksumManifest(
      [
        { checksum: "src-hash", path: "src/button.ts" },
        { checksum: "test-hash", path: "tests/unit/button.test.ts" },
        { checksum: "pkg-hash", path: "package.json" },
        { checksum: "docs-hash", path: "docs/handoff.md" },
      ],
      { criticalPaths: ["package.json"] },
    );

    expect(manifest).toEqual({
      entries: [
        { checksum: "pkg-hash", path: "package.json" },
        { checksum: "test-hash", path: "tests/unit/button.test.ts" },
      ],
    });
  });

  it("passes IMPL when the recorded manifest is unchanged", () => {
    const manifest = createChecksumManifest([
      { checksum: "test-hash", path: "tests/unit/button.test.ts" },
    ]);

    expect(evaluateChecksumManifest(manifest, manifest)).toEqual({ pass: true });
  });

  it("fails IMPL with deterministic evidence when a test checksum changes", () => {
    const expected = createChecksumManifest([
      { checksum: "test-before", path: "tests/unit/button.test.ts" },
    ]);
    const actual = createChecksumManifest([
      { checksum: "test-after", path: "tests/unit/button.test.ts" },
    ]);

    const result = evaluateChecksumManifest(expected, actual);

    expect(result.pass).toBe(false);
    expect(result.reason).toBe("checksum manifest changed");
    expect(JSON.parse(result.evidence ?? "{}")).toEqual({
      changed: [
        {
          actualChecksum: "test-after",
          expectedChecksum: "test-before",
          path: "tests/unit/button.test.ts",
        },
      ],
      missing: [],
    });
  });

  it("fails IMPL with deterministic evidence when a recorded file is missing", async () => {
    const expected = createChecksumManifest([
      { checksum: "test-hash", path: "tests/unit/button.test.ts" },
    ]);
    const actual = createChecksumManifest([]);
    const gate = createChecksumGate(expected, actual);

    await expect(gate.check(context())).resolves.toEqual({
      evidence: JSON.stringify(
        {
          changed: [],
          missing: [{ expectedChecksum: "test-hash", path: "tests/unit/button.test.ts" }],
        },
        null,
        2,
      ),
      pass: false,
      reason: "checksum manifest changed",
    });
  });
});

function context(): GateContext {
  return {
    item: {
      id: "DEMO-1234",
      payload: { kind: "jira", ticketKey: "DEMO-1234" },
      repo: "web",
      source: "jira",
      title: "Example",
    },
    profile: {
      baseBranch: "develop",
      concurrency: 1,
      context: { policyRefs: [], providers: [] },
      contextProviders: [],
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
    },
    worktree: "/worktree",
  };
}
