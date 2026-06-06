import { packageCommand } from "../../core/config";
import type {
  Gate,
  GateContext,
  GateResult,
  PackageAction,
  PackageManager,
  RepoProfile,
} from "../../core/types";

export type PackageGateName = keyof RepoProfile["gates"];

export interface GateCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type GateCommandRunner = (
  command: string,
  opts: { cwd: string },
) => Promise<GateCommandResult>;

export interface PackageActionGateOptions {
  commandFor?: (ctx: {
    action: PackageAction;
    gateName: PackageGateName;
    manager: PackageManager;
    pipeline: GateContext;
  }) => string;
}

export function createPackageActionGate(
  gateName: PackageGateName,
  runner: GateCommandRunner,
  opts: PackageActionGateOptions = {},
): Gate {
  return {
    name: `${gateName}-exit-code`,
    async check(ctx) {
      const action = ctx.profile.gates[gateName];
      if (action === undefined) {
        return {
          evidence: `${gateName} gate is not configured`,
          pass: true,
        };
      }

      if (ctx.profile.packageManager === undefined) {
        return fail("package manager is not resolved", "profile.packageManager");
      }

      const command =
        opts.commandFor?.({
          action,
          gateName,
          manager: ctx.profile.packageManager,
          pipeline: ctx,
        }) ?? packageCommand(ctx.profile.packageManager, action);
      const result = await runner(command, { cwd: ctx.worktree });

      if (result.exitCode === 0) return { pass: true };

      return fail(
        `${gateName} gate failed with exit code ${result.exitCode}`,
        `${result.stdout}${result.stderr}`,
      );
    },
  };
}

function fail(reason: string, evidence: string): GateResult {
  return { evidence, pass: false, reason };
}
