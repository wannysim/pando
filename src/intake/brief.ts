import type { Gate, GateContext, GateResult, WorkItem } from "../core/types";

export const BRIEF_TEMPLATE = `# Brief Title

> repo: personal-site
> created: 2026-06-06T00:00:00.000Z

## Goal

Describe why this work should exist.

## User Story

As a user, I want an outcome so that I receive value.

## Acceptance Criteria

- [ ] The expected behavior is verifiable.

## Screens or Behavior

Describe the visible UI, workflow, or system behavior.

## Non-Goals

- List work that is explicitly out of scope.

## Assets

- None

## Open Questions

- None
`;

export interface BriefFileReader {
  readText(path: string): Promise<string | undefined>;
}

export interface BriefComposeInput {
  title: string;
  goal?: string;
  userStory?: string;
  acceptanceCriteria?: readonly string[];
  screensOrBehavior?: string;
  nonGoals?: readonly string[];
  assets?: readonly string[];
  openQuestions?: readonly string[];
  body?: string;
}

export function composeBriefMarkdown(input: BriefComposeInput): string {
  const body = input.body?.trim();
  const acceptance = cleanList(input.acceptanceCriteria);
  const blocks = [
    `# ${input.title.trim()}`,
    section("Goal", input.goal?.trim() || body || input.title.trim()),
    section(
      "User Story",
      input.userStory?.trim() || "As a user, I want this outcome so that I receive value.",
    ),
    section("Acceptance Criteria", bullets(acceptance.map((item) => `[ ] ${item}`))),
    section(
      "Screens or Behavior",
      input.screensOrBehavior?.trim() || body || "Describe the visible behavior.",
    ),
    section("Non-Goals", listOrNone(input.nonGoals)),
    section("Assets", listOrNone(input.assets)),
    section("Open Questions", listOrNone(input.openQuestions)),
  ];
  return `${blocks.join("\n\n")}\n`;
}

function section(label: string, content: string): string {
  return `## ${label}\n\n${content}`;
}

function bullets(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function listOrNone(items: readonly string[] | undefined): string {
  const cleaned = cleanList(items);
  return cleaned.length > 0 ? bullets(cleaned) : "- None";
}

function cleanList(items: readonly string[] | undefined): string[] {
  return (items ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
}

export interface BriefLoadInput {
  id: string;
  repo: string;
  briefPath: string;
  reader: BriefFileReader;
  branch?: string;
  dependsOn?: string[];
  title?: string;
}

export interface BriefOpenQuestion {
  text: string;
  blocking: boolean;
}

export interface BriefArtifact {
  title: string;
  sections: Partial<Record<BriefSectionKey, string>>;
  acceptanceCriteria: string[];
  assets: string[];
  openQuestions: BriefOpenQuestion[];
}

export interface BriefValidation {
  valid: boolean;
  errors: string[];
  blockingQuestions: BriefOpenQuestion[];
}

type BriefSectionKey =
  | "goal"
  | "userStory"
  | "acceptanceCriteria"
  | "screensOrBehavior"
  | "nonGoals"
  | "assets"
  | "openQuestions";

const REQUIRED_SECTIONS: readonly { key: BriefSectionKey; label: string }[] = [
  { key: "goal", label: "Goal" },
  { key: "userStory", label: "User Story" },
  { key: "acceptanceCriteria", label: "Acceptance Criteria" },
  { key: "screensOrBehavior", label: "Screens or Behavior" },
  { key: "nonGoals", label: "Non-Goals" },
  { key: "assets", label: "Assets" },
  { key: "openQuestions", label: "Open Questions" },
];

export async function loadBriefWorkItem(input: BriefLoadInput): Promise<WorkItem> {
  const markdown = await input.reader.readText(input.briefPath);
  if (markdown === undefined) throw new Error(`brief not found: ${input.briefPath}`);

  const validation = validateBriefMarkdown(markdown);
  if (!validation.valid) {
    throw new Error(`brief.md schema validation failed:\n${validation.errors.join("\n")}`);
  }

  const brief = parseBriefMarkdown(markdown);
  const assets = brief.assets.length > 0 ? brief.assets : undefined;

  return removeUndefined({
    branch: input.branch,
    dependsOn: input.dependsOn,
    id: input.id,
    payload: removeUndefined({
      assets,
      briefPath: input.briefPath,
      kind: "brief" as const,
    }),
    repo: input.repo,
    source: "brief" as const,
    title: input.title ?? brief.title,
  });
}

export function createBriefIntakeGate(reader: BriefFileReader): Gate {
  return {
    name: "brief-intake-schema",
    async check(ctx: GateContext): Promise<GateResult> {
      if (ctx.item.payload.kind !== "brief") return { pass: true };

      const markdown = await reader.readText(ctx.item.payload.briefPath);
      if (markdown === undefined) {
        return fail("brief.md not found", ctx.item.payload.briefPath);
      }

      const validation = validateBriefMarkdown(markdown);
      if (!validation.valid) {
        return fail("brief.md schema validation failed", validation.errors.join("\n"));
      }

      if (validation.blockingQuestions.length > 0) {
        return {
          evidence: validation.blockingQuestions.map((question) => question.text).join("\n"),
          failureKind: "blocking-questions",
          pass: false,
          reason: "brief has blocking open questions",
        };
      }

      return { pass: true };
    },
  };
}

export function parseBriefMarkdown(markdown: string): BriefArtifact {
  const lines = splitLines(markdown);
  const sections = collectSections(lines);

  return {
    acceptanceCriteria: parseListItems(sections.acceptanceCriteria ?? "").map((item) =>
      item.replace(/^\[[ xX]\]\s+/, ""),
    ),
    assets: parseAssets(sections.assets ?? ""),
    openQuestions: parseOpenQuestions(sections.openQuestions ?? ""),
    sections,
    title: parseTitle(lines),
  };
}

export function validateBriefMarkdown(markdown: string): BriefValidation {
  const brief = parseBriefMarkdown(markdown);
  const errors: string[] = [];

  if (brief.title.length === 0) {
    errors.push("brief.md must start with an H1 title");
  }

  for (const section of REQUIRED_SECTIONS) {
    const content = brief.sections[section.key];
    if (content === undefined) {
      errors.push(`brief.md must contain a ${section.label} section`);
      continue;
    }
    if (content.trim().length === 0) {
      errors.push(`brief.md ${section.label} section must not be empty`);
    }
  }

  if (brief.acceptanceCriteria.length === 0) {
    errors.push("brief.md must contain at least one Acceptance Criteria item");
  }

  return {
    blockingQuestions: brief.openQuestions.filter((question) => question.blocking),
    errors,
    valid: errors.length === 0,
  };
}

function parseTitle(lines: readonly string[]): string {
  const titleLine = lines.find((line) => line.startsWith("# "));
  return titleLine?.replace(/^#\s+/, "").trim() ?? "";
}

function collectSections(lines: readonly string[]): Partial<Record<BriefSectionKey, string>> {
  const sections: Partial<Record<BriefSectionKey, string>> = {};
  let current: BriefSectionKey | undefined;
  let buffer: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current !== undefined) sections[current] = trimSection(buffer);
      current = sectionKey(line);
      buffer = [];
      continue;
    }

    if (current !== undefined) buffer.push(line);
  }

  if (current !== undefined) sections[current] = trimSection(buffer);

  return sections;
}

function sectionKey(heading: string): BriefSectionKey | undefined {
  const label = heading
    .replace(/^##\s+/, "")
    .trim()
    .toLowerCase();
  if (label === "goal") return "goal";
  if (label === "user story") return "userStory";
  if (label === "acceptance criteria") return "acceptanceCriteria";
  if (label === "screens or behavior") return "screensOrBehavior";
  if (label === "non-goals") return "nonGoals";
  if (label === "assets") return "assets";
  if (label === "open questions") return "openQuestions";
  return undefined;
}

function trimSection(lines: readonly string[]): string {
  const start = lines.findIndex((line) => line.trim().length > 0);
  if (start < 0) return "";

  let end = lines.length - 1;
  while (end >= start && lines[end]?.trim().length === 0) end -= 1;

  return lines.slice(start, end + 1).join("\n");
}

function parseAssets(section: string): string[] {
  return parseListItems(section).filter((item) => item.toLowerCase() !== "none");
}

function parseOpenQuestions(section: string): BriefOpenQuestion[] {
  return parseListItems(section).map((text) => ({
    blocking: /\[blocker\]/i.test(text),
    text,
  }));
}

function parseListItems(section: string): string[] {
  return splitLines(section)
    .map((line) => /^(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line.trim())?.[1]?.trim())
    .filter((item): item is string => item !== undefined && item.length > 0);
}

function splitLines(markdown: string): string[] {
  return markdown.replace(/\r\n/g, "\n").split("\n");
}

function fail(reason: string, evidence: string): GateResult {
  return { evidence, pass: false, reason };
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
