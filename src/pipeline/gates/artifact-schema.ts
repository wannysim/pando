import { join } from "node:path";
import {
  validatePlanArtifact,
  validateSpecArtifact,
} from "../../core/artifacts.js";
import type { Gate, GateContext, GateResult } from "../../core/types.js";

export interface TextFileReader {
  readText(path: string): Promise<string | undefined>;
}

export function createSpecArtifactGate(files: TextFileReader): Gate {
  return {
    name: "spec-artifact-schema",
    async check(ctx) {
      const path = join(ctx.worktree, "_spec.md");
      const markdown = await files.readText(path);

      if (markdown === undefined) {
        return fail("_spec.md not found", path);
      }

      const validation = validateSpecArtifact(markdown);
      if (validation.valid) return { pass: true };

      return fail("_spec.md schema validation failed", validation.errors.join("\n"));
    },
  };
}

export function createPlanArtifactGate(files: TextFileReader): Gate {
  return {
    name: "plan-artifact-schema",
    async check(ctx: GateContext): Promise<GateResult> {
      const path = join(ctx.worktree, "PLAN.md");
      const markdown = await files.readText(path);

      if (markdown === undefined) {
        return fail("PLAN.md not found", path);
      }

      const validation = validatePlanArtifact(markdown);
      if (!validation.valid) {
        return fail("PLAN.md schema validation failed", validation.errors.join("\n"));
      }

      if (validation.blockingQuestions.length > 0) {
        return {
          evidence: validation.blockingQuestions.map((question) => question.text).join("\n"),
          failureKind: "blocking-questions",
          pass: false,
          reason: "PLAN.md has blocking open questions",
        };
      }

      return { pass: true };
    },
  };
}

function fail(reason: string, evidence: string): GateResult {
  return { evidence, pass: false, reason };
}
