import { join } from "node:path";
import { resolveBaseBranch } from "../../core/base-branch";
import type { Gate, GateContext, GateResult } from "../../core/types";
import type { GateCommandRunner } from "./exit-code";

export interface TextFileWriter {
  writeText(path: string, text: string): Promise<void>;
}

export interface DraftPrAutomationGateOptions {
  files: TextFileWriter;
  runner: GateCommandRunner;
}

export function createDraftPrAutomationGate(opts: DraftPrAutomationGateOptions): Gate {
  return {
    name: "draft-pr-create",
    async check(ctx) {
      const commands: string[] = [];
      const run = async (command: string) => {
        commands.push(command);
        return await opts.runner(command, { cwd: ctx.worktree });
      };

      const baseBranch = resolveBaseBranch({ item: ctx.item, profile: ctx.profile });
      const fetchBase = await run(`git fetch origin ${shellQuote(baseBranch)}`);
      if (fetchBase.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", fetchBase);

      const currentBase = await run(
        `git rev-parse --verify ${shellQuote(`origin/${baseBranch}^{commit}`)}`,
      );
      if (currentBase.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", currentBase);

      const forkBase = await run(`git merge-base HEAD ${shellQuote(`origin/${baseBranch}`)}`);
      if (forkBase.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", forkBase);

      const currentBaseSha = currentBase.stdout.trim();
      const forkBaseSha = forkBase.stdout.trim();
      const expectedBaseSha = nonBlank(ctx.item.baseSha) ?? forkBaseSha;
      if (currentBaseSha !== expectedBaseSha || forkBaseSha !== expectedBaseSha) {
        return baseDriftFailure({
          baseBranch,
          currentBaseSha,
          expectedBaseSha: ctx.item.baseSha,
          forkBaseSha,
        });
      }

      const add = await run("git add -A");
      if (add.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", add);

      const diff = await run("git diff --cached --quiet");
      if (diff.exitCode > 1) return commandFailure(commands.at(-1) ?? "", diff);
      if (diff.exitCode === 1) {
        const commit = await run(`git commit -m ${shellQuote(commitSubject(ctx))}`);
        if (commit.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", commit);
      }

      const push = await run("git push -u origin HEAD");
      if (push.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", push);

      let view = await run("gh pr view --json isDraft,number,url");
      if (view.exitCode !== 0) {
        const branch = await run("git rev-parse --abbrev-ref HEAD");
        if (branch.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", branch);
        const create = await run(
          [
            "gh pr create --draft",
            `--base ${shellQuote(baseBranch)}`,
            `--head ${shellQuote(branch.stdout.trim())}`,
            `--title ${shellQuote(ctx.item.title)}`,
            `--body ${shellQuote(prBody(ctx))}`,
          ].join(" "),
        );
        if (create.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", create);

        view = await run("gh pr view --json isDraft,number,url");
        if (view.exitCode !== 0) return commandFailure(commands.at(-1) ?? "", view);
      }

      const prJson = view.stdout.trim();
      await opts.files.writeText(join(ctx.worktree, "pr.json"), `${prJson}\n`);

      return {
        evidence: JSON.stringify({
          commands: commands.map(redactCommandEvidence),
          prJson,
        }),
        pass: true,
      };
    },
  };
}

function commitSubject(ctx: GateContext): string {
  return `chore: ${ctx.item.title}`.slice(0, 120);
}

function prBody(ctx: GateContext): string {
  return `Automated pando result for ${ctx.item.id}.`;
}

function commandFailure(
  command: string,
  result: { exitCode: number; stdout: string; stderr: string },
): GateResult {
  return fail(
    `draft-pr-create command failed: ${commandLabel(command)}`,
    `${result.stdout}${result.stderr}`,
  );
}

function baseDriftFailure(input: {
  baseBranch: string;
  currentBaseSha: string;
  expectedBaseSha?: string;
  forkBaseSha: string;
}): GateResult {
  return {
    evidence: JSON.stringify(removeUndefined(input), null, 2),
    failureKind: "non-retryable",
    pass: false,
    reason: "base branch drifted before PR creation",
  };
}

function commandLabel(command: string): string {
  return command.split(" ").slice(0, 2).join(" ");
}

function redactCommandEvidence(command: string): string {
  if (!command.startsWith("gh pr create")) return command;
  return command.replace(/--body '.*'$/, "--body '<body>'");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function removeUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function fail(reason: string, evidence: string): GateResult {
  return { evidence, pass: false, reason };
}
