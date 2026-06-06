import { parse } from "yaml";
import type { WorkItemSource } from "./types";

export const WORKER_STAGE_KEYS = ["spec", "plan", "test", "impl", "review", "pr"] as const;

export type WorkerStageKey = (typeof WORKER_STAGE_KEYS)[number];

export type WorkerEngineName = "claude-code" | "codex";

export interface StageWorkerConfig {
  engine: WorkerEngineName;
  model: string;
  skill?: string;
  skills?: Partial<Record<WorkItemSource, string>>;
  allowedTools?: string[];
  allowedToolsBySource?: Partial<Record<WorkItemSource, string[]>>;
  env?: Record<string, string>;
}

export interface StageDefaults {
  retryBudget: number;
  timeoutMinutes: number;
}

export interface StageConfig {
  stages: Record<WorkerStageKey, StageWorkerConfig>;
  defaults: StageDefaults;
}

const ENGINES = ["claude-code", "codex"] as const;
const WORK_ITEM_SOURCES = ["jira", "brief", "github_issue"] as const;

export function loadStageConfigFromYaml(yaml: string): StageConfig {
  const root = asRecord(parse(yaml), "config");
  const stages = asRecord(root.stages, "stages");
  const defaults = asRecord(root.defaults, "defaults");

  return {
    stages: Object.fromEntries(
      WORKER_STAGE_KEYS.map((stage) => [stage, parseStage(stages[stage], stage)]),
    ) as Record<WorkerStageKey, StageWorkerConfig>,
    defaults: {
      retryBudget: requiredPositiveInteger(defaults.retry_budget, "defaults.retry_budget"),
      timeoutMinutes: requiredPositiveInteger(defaults.timeout_minutes, "defaults.timeout_minutes"),
    },
  };
}

export function resolveStageSkill(
  config: StageConfig,
  stage: WorkerStageKey,
  source: WorkItemSource,
): string | undefined {
  return config.stages[stage].skills?.[source] ?? config.stages[stage].skill;
}

export function resolveStageAllowedTools(
  config: StageConfig,
  stage: WorkerStageKey,
  source: WorkItemSource,
): string[] | undefined {
  return config.stages[stage].allowedToolsBySource?.[source] ?? config.stages[stage].allowedTools;
}

function parseStage(value: unknown, stage: WorkerStageKey): StageWorkerConfig {
  const path = `stages.${stage}`;
  const raw = asRecord(value, path);
  const skill = optionalString(raw.skill, `${path}.skill`);
  const skills = optionalSkills(raw.skills, `${path}.skills`);

  if (skill !== undefined && skills !== undefined) {
    throw new Error(`${path}: declare either skill or skills, not both`);
  }

  return removeUndefined({
    allowedTools: optionalStringArray(raw.allowed_tools, `${path}.allowed_tools`),
    allowedToolsBySource: optionalStringArraysBySource(
      raw.allowed_tools_by_source,
      `${path}.allowed_tools_by_source`,
    ),
    engine: requiredEnum(raw.engine, ENGINES, `${path}.engine`),
    env: optionalStringRecord(raw.env, `${path}.env`),
    model: requiredString(raw.model, `${path}.model`),
    skill,
    skills,
  });
}

function optionalSkills(
  value: unknown,
  path: string,
): Partial<Record<WorkItemSource, string>> | undefined {
  if (value === undefined) return undefined;

  const raw = asRecord(value, path);
  const result: Partial<Record<WorkItemSource, string>> = {};

  for (const [source, skill] of Object.entries(raw)) {
    if (!isWorkItemSource(source)) {
      throw new Error(`${path}.${source}: expected one of ${WORK_ITEM_SOURCES.join(", ")}`);
    }
    result[source] = requiredString(skill, `${path}.${source}`);
  }

  return result;
}

function optionalStringArraysBySource(
  value: unknown,
  path: string,
): Partial<Record<WorkItemSource, string[]>> | undefined {
  if (value === undefined) return undefined;

  const raw = asRecord(value, path);
  const result: Partial<Record<WorkItemSource, string[]>> = {};

  for (const [source, tools] of Object.entries(raw)) {
    if (!isWorkItemSource(source)) {
      throw new Error(`${path}.${source}: expected one of ${WORK_ITEM_SOURCES.join(", ")}`);
    }
    result[source] = requiredStringArray(tools, `${path}.${source}`);
  }

  return result;
}

function optionalStringRecord(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;

  const raw = asRecord(value, path);
  const result: Record<string, string> = {};

  for (const [key, item] of Object.entries(raw)) {
    result[key] = requiredString(item, `${path}.${key}`);
  }

  return result;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}: expected non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, path);
}

function requiredPositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path}: expected positive integer`);
  }
  return value;
}

function requiredEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${path}: expected one of ${allowed.join(", ")}`);
  }
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  return requiredStringArray(value, path);
}

function requiredStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${path}: expected string[]`);
  }
  return value;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function isWorkItemSource(value: string): value is WorkItemSource {
  return (WORK_ITEM_SOURCES as readonly string[]).includes(value);
}
