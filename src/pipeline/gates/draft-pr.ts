import { join } from "node:path";
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
      const commands = draftPrCommands(ctx);

      for (const command of commands.slice(0, -1)) {
        const result = await opts.runner(command, { cwd: ctx.worktree });
        if (result.exitCode !== 0) return commandFailure(command, result);
      }

      const viewCommand = commands.at(-1);
      if (viewCommand === undefined) return fail("draft-pr-create has no gh view command", "");
      const view = await opts.runner(viewCommand, { cwd: ctx.worktree });
      if (view.exitCode !== 0) return commandFailure(viewCommand, view);

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

function draftPrCommands(ctx: GateContext): string[] {
  return [
    "git add -A",
    `git commit -m ${shellQuote(commitSubject(ctx))}`,
    "git push -u origin HEAD",
    [
      "gh pr create --draft",
      `--base ${shellQuote(ctx.profile.baseBranch)}`,
      `--title ${shellQuote(ctx.item.title)}`,
      `--body ${shellQuote(prBody(ctx))}`,
    ].join(" "),
    "gh pr view --json isDraft,number,url",
  ];
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

function fail(reason: string, evidence: string): GateResult {
  return { evidence, pass: false, reason };
}
