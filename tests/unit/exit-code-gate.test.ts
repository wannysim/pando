import { describe, expect, it } from "vitest";
import {
  createPackageActionGate,
  type GateCommandRunner,
} from "../../src/pipeline/gates/exit-code";
import type { GateContext } from "../../src/core/types";

describe("createPackageActionGate", () => {
  it("runs the configured PM-agnostic action as a package-manager command", async () => {
    const calls: Parameters<GateCommandRunner>[] = [];
    const gate = createPackageActionGate("test", async (...args) => {
      calls.push(args);
      return { exitCode: 0, stderr: "", stdout: "ok\n" };
    });

    await expect(gate.check(context())).resolves.toEqual({
      evidence: '{"command":"pnpm test","exitCode":0}',
      pass: true,
    });
    expect(calls).toEqual([["pnpm test", { cwd: "/worktree" }]]);
  });

  it("fails with deterministic evidence when the command exits non-zero", async () => {
    const gate = createPackageActionGate("types", async () => ({
      exitCode: 2,
      stderr: "type error\n",
      stdout: "checking\n",
    }));

    await expect(gate.check(context())).resolves.toEqual({
      evidence: "checking\ntype error\n",
      pass: false,
      reason: "types gate failed with exit code 2",
    });
  });

  it("passes optional gates that are not configured", async () => {
    const gate = createPackageActionGate("lint", async () => {
      throw new Error("runner should not be called");
    });

    await expect(gate.check(context())).resolves.toEqual({
      evidence: "lint gate is not configured",
      pass: true,
    });
  });

  it("fails fast when packageManager is missing", async () => {
    const gate = createPackageActionGate("test", async () => ({
      exitCode: 0,
      stderr: "",
      stdout: "",
    }));
    const ctx = context();
    delete ctx.profile.packageManager;

    await expect(gate.check(ctx)).resolves.toEqual({
      evidence: "profile.packageManager",
      pass: false,
      reason: "package manager is not resolved",
    });
  });

  it("supports a command builder for future workspace-scoped gates", async () => {
    const calls: Parameters<GateCommandRunner>[] = [];
    const gate = createPackageActionGate(
      "test",
      async (...args) => {
        calls.push(args);
        return { exitCode: 0, stderr: "", stdout: "" };
      },
      {
        commandFor({ action, manager }) {
          return `${manager} ${action} --filter changed`;
        },
      },
    );

    await expect(gate.check(context())).resolves.toEqual({
      evidence: '{"command":"pnpm test --filter changed","exitCode":0}',
      pass: true,
    });
    expect(calls[0]?.[0]).toBe("pnpm test --filter changed");
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
      gates: { test: "test", types: "typecheck" },
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
