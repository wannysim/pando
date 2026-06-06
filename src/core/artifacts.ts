export interface PlanMetadata {
  created?: string;
  branch?: string;
  source?: string;
}

export interface PlanWorkUnit {
  type: "commit" | "pr";
  number: number;
  title: string;
}

export interface PlanRoadmap {
  kind: "implementation" | "stacked" | "missing";
  units: PlanWorkUnit[];
}

export interface PlanOpenQuestion {
  text: string;
  blocking: boolean;
}

export interface PlanArtifact {
  title: string;
  ticketKey?: string;
  metadata: PlanMetadata;
  sections: Partial<Record<PlanSectionKey, string>>;
  roadmap: PlanRoadmap;
  openQuestions: PlanOpenQuestion[];
  acceptanceCriteria: string[];
}

export interface SpecArtifact {
  title: string;
  sections: Partial<Record<SpecSectionKey, string>>;
}

export interface ArtifactValidation {
  valid: boolean;
  errors: string[];
}

export interface PlanArtifactValidation extends ArtifactValidation {
  blockingQuestions: PlanOpenQuestion[];
}

type PlanSectionKey =
  | "requirements"
  | "design"
  | "implementationRoadmap"
  | "stackedRoadmap"
  | "stackedSuggestion"
  | "openQuestions"
  | "acceptanceCriteria";

type SpecSectionKey = "requirements";

export function parsePlanArtifact(markdown: string): PlanArtifact {
  const lines = splitLines(markdown);
  const title = parseTitle(lines);
  const sections = collectSections(lines, planSectionKey);
  const roadmap = parseRoadmap(sections);
  const openQuestions = parseOpenQuestions(sections.openQuestions ?? "");

  return {
    title: title.title,
    ticketKey: title.ticketKey,
    metadata: parseMetadata(lines),
    sections,
    roadmap,
    openQuestions,
    acceptanceCriteria: parseAcceptanceCriteria(sections.acceptanceCriteria ?? ""),
  };
}

export function validatePlanArtifact(markdown: string): PlanArtifactValidation {
  const plan = parsePlanArtifact(markdown);
  const errors: string[] = [];

  if (plan.title.length === 0) {
    errors.push("PLAN.md must start with an H1 title");
  }
  if (plan.ticketKey === undefined) {
    errors.push("PLAN.md title must include a ticket key like [AP-1234]");
  }
  if (!hasContent(plan.sections.requirements)) {
    errors.push("PLAN.md must contain a Requirements Overview section");
  }
  if (plan.roadmap.kind !== "implementation" || plan.roadmap.units.length === 0) {
    errors.push("PLAN.md must contain an Implementation Roadmap with Commit units");
  }
  if (plan.sections.openQuestions === undefined) {
    errors.push("PLAN.md must contain an Open Questions section");
  }
  if (plan.acceptanceCriteria.length === 0) {
    errors.push("PLAN.md must contain at least one Acceptance Criteria item");
  }

  return {
    valid: errors.length === 0,
    errors,
    blockingQuestions: plan.openQuestions.filter((question) => question.blocking),
  };
}

export function hasBlockingOpenQuestions(plan: PlanArtifact): boolean {
  return plan.openQuestions.some((question) => question.blocking);
}

export function parseSpecArtifact(markdown: string): SpecArtifact {
  const lines = splitLines(markdown);
  return {
    title: parseTitle(lines).title,
    sections: collectSections(lines, specSectionKey),
  };
}

export function validateSpecArtifact(markdown: string): ArtifactValidation {
  const spec = parseSpecArtifact(markdown);
  const errors: string[] = [];

  if (spec.title.length === 0) {
    errors.push("_spec.md must start with an H1 title");
  }
  if (!hasContent(spec.sections.requirements)) {
    errors.push("_spec.md must contain a Requirements Overview section");
  }

  return { valid: errors.length === 0, errors };
}

function splitLines(markdown: string): string[] {
  return markdown.replace(/\r\n/g, "\n").split("\n");
}

function parseTitle(lines: readonly string[]): { title: string; ticketKey?: string } {
  const titleLine = lines.find((line) => line.startsWith("# "));
  if (titleLine === undefined) return { title: "" };

  const match = /^#\s+(?:\[([A-Z]+-\d+)\]\s+)?(.+?)\s*$/.exec(titleLine);
  const title = match?.[2]?.trim() ?? "";
  const ticketKey = match?.[1];

  return ticketKey === undefined ? { title } : { title, ticketKey };
}

function parseMetadata(lines: readonly string[]): PlanMetadata {
  const metadata: PlanMetadata = {};

  for (const line of lines) {
    if (line.startsWith("## ")) break;
    if (!line.startsWith("> ")) continue;

    const raw = line.slice(2);
    const separator = raw.indexOf(":");
    if (separator < 0) continue;

    const key = raw.slice(0, separator).trim().toLowerCase();
    const value = raw.slice(separator + 1).trim();

    if (key === "생성" || key === "created") metadata.created = value;
    if (key === "브랜치" || key === "branch") metadata.branch = value;
    if (key === "소스" || key === "source") metadata.source = value;
  }

  return metadata;
}

function collectSections<K extends string>(
  lines: readonly string[],
  keyForHeading: (heading: string) => K | undefined,
): Partial<Record<K, string>> {
  const sections: Partial<Record<K, string>> = {};
  let current: K | undefined;
  let buffer: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current !== undefined) sections[current] = trimSection(buffer);
      current = keyForHeading(line);
      buffer = [];
      continue;
    }

    if (current !== undefined) buffer.push(line);
  }

  if (current !== undefined) sections[current] = trimSection(buffer);

  return sections;
}

function trimSection(lines: readonly string[]): string {
  const start = lines.findIndex((line) => line.trim().length > 0);
  if (start < 0) return "";

  let end = lines.length - 1;
  while (end >= start && lines[end]?.trim().length === 0) end -= 1;

  return lines.slice(start, end + 1).join("\n");
}

function planSectionKey(heading: string): PlanSectionKey | undefined {
  const label = heading.toLowerCase();
  if (label.includes("requirements overview")) return "requirements";
  if (label.includes("design & logic notes")) return "design";
  if (label.includes("implementation roadmap")) return "implementationRoadmap";
  if (label.includes("stacked pr roadmap")) return "stackedRoadmap";
  if (label.includes("stacked pr") && label.includes("제안")) return "stackedSuggestion";
  if (label.includes("open questions")) return "openQuestions";
  if (label.includes("acceptance criteria")) return "acceptanceCriteria";
  return undefined;
}

function specSectionKey(heading: string): SpecSectionKey | undefined {
  return heading.toLowerCase().includes("requirements overview") ? "requirements" : undefined;
}

function parseRoadmap(sections: Partial<Record<PlanSectionKey, string>>): PlanRoadmap {
  if (sections.implementationRoadmap !== undefined) {
    return {
      kind: "implementation",
      units: parseWorkUnits(sections.implementationRoadmap, "commit"),
    };
  }

  if (sections.stackedRoadmap !== undefined) {
    return {
      kind: "stacked",
      units: parseWorkUnits(sections.stackedRoadmap, "pr"),
    };
  }

  return { kind: "missing", units: [] };
}

function parseWorkUnits(section: string, type: PlanWorkUnit["type"]): PlanWorkUnit[] {
  const marker = type === "commit" ? "Commit" : "PR";
  const pattern = new RegExp(`^###\\s+${marker}\\s+(\\d+)\\s*:\\s*(.+?)\\s*$`, "i");

  return splitLines(section).flatMap((line) => {
    const match = pattern.exec(line);
    if (match === null) return [];

    const number = Number.parseInt(match[1] ?? "", 10);
    const title = match[2]?.trim() ?? "";
    if (!Number.isInteger(number) || title.length === 0) return [];

    return [{ type, number, title }];
  });
}

function parseOpenQuestions(section: string): PlanOpenQuestion[] {
  return parseListItems(section).map((text) => ({
    text,
    blocking: /\[blocker\]/i.test(text),
  }));
}

function parseAcceptanceCriteria(section: string): string[] {
  return parseListItems(section).map((text) => text.replace(/^\[[ xX]\]\s+/, ""));
}

function parseListItems(section: string): string[] {
  return splitLines(section)
    .map((line) => /^(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line.trim())?.[1]?.trim())
    .filter((item): item is string => item !== undefined && item.length > 0);
}

function hasContent(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}
