import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { composeBriefMarkdown, validateBriefMarkdown, type BriefComposeInput } from "./brief";

export interface BriefWriter {
  writeBrief(path: string, content: string): Promise<void>;
}

export interface MaterializeInlineBriefInput {
  id: string;
  inboxRoot: string;
  brief: BriefComposeInput;
  writer: BriefWriter;
}

export interface MaterializedBrief {
  briefPath: string;
  assets?: string[];
}

export async function materializeInlineBrief(
  input: MaterializeInlineBriefInput,
): Promise<MaterializedBrief> {
  const markdown = composeBriefMarkdown(input.brief);
  const validation = validateBriefMarkdown(markdown);
  if (!validation.valid) {
    throw new Error(`inline brief schema validation failed:\n${validation.errors.join("\n")}`);
  }

  const briefPath = join(input.inboxRoot, input.id, "brief.md");
  await input.writer.writeBrief(briefPath, markdown);

  const assets = cleanAssets(input.brief.assets);
  return assets.length > 0 ? { assets, briefPath } : { briefPath };
}

export function createFsBriefWriter(): BriefWriter {
  return {
    async writeBrief(path, content) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    },
  };
}

function cleanAssets(assets: readonly string[] | undefined): string[] {
  return (assets ?? []).map((asset) => asset.trim()).filter((asset) => asset.length > 0);
}
