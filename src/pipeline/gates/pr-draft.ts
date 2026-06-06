import { join } from "node:path";
import type { Gate, GateContext, GateResult } from "../../core/types";

export interface TextFileReader {
  readText(path: string): Promise<string | undefined>;
}

/**
 * Deterministic PR-stage gate. The PR stage writes `pr.json` from
 * `gh pr view --json isDraft,number,url`. The gate passes only when the created
 * PR is a draft. Evidence is the structured artifact JSON, never worker text
 * (CLAUDE.md discipline 5).
 */
export function createPrDraftGate(files: TextFileReader): Gate {
  return {
    name: "pr-draft",
    async check(ctx: GateContext): Promise<GateResult> {
      const path = join(ctx.worktree, "pr.json");
      const raw = await files.readText(path);

      if (raw === undefined) {
        return fail("pr.json not found", path);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return fail("pr.json is not valid JSON", raw);
      }

      const isDraft = readIsDraft(parsed);
      if (isDraft === undefined) {
        return fail("pr.json is missing a boolean isDraft field", raw);
      }

      if (!isDraft) {
        return fail("PR was created as a non-draft", raw);
      }

      return { evidence: raw, pass: true };
    },
  };
}

function readIsDraft(value: unknown): boolean | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const isDraft = (value as Record<string, unknown>).isDraft;
  return typeof isDraft === "boolean" ? isDraft : undefined;
}

function fail(reason: string, evidence: string): GateResult {
  return { evidence, pass: false, reason };
}
