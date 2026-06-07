import type { ApiJobEvent } from "../../../src/api/schema";
import type { StageName } from "../../../src/core/types";

export type StageOutcome = "running" | "passed" | "failed";

export interface StageTimelineEntry {
  key: string;
  stage: StageName | null;
  attempt: number;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  outcome: StageOutcome;
  reason: string | null;
  gateName: string | null;
  evidence: string | null;
  costUsd: number | null;
  events: ApiJobEvent[];
}

/**
 * Collapse the raw event stream into one entry per stage attempt so the
 * timeline shows "stage X started at T, ran D, ended E (outcome)" instead of a
 * flat list of every state-change. A new attempt opens on each stage-started.
 */
export function groupEventsByStage(events: readonly ApiJobEvent[]): StageTimelineEntry[] {
  const groups: ApiJobEvent[][] = [];
  for (const event of events) {
    if (event.type === "stage-started" || groups.length === 0) {
      groups.push([]);
    }
    groups[groups.length - 1]?.push(event);
  }

  const attempts = new Map<string, number>();
  return groups.map((group, index) => summarizeGroup(group, index, attempts));
}

function summarizeGroup(
  group: ApiJobEvent[],
  index: number,
  attempts: Map<string, number>,
): StageTimelineEntry {
  const stage = firstStage(group);
  const startedAt = group[0]?.createdAt ?? "";
  const terminal = group.find((e) => e.type === "stage-completed" || e.type === "stage-failed");
  const failure = group.find(
    (e) => e.type === "stage-failed" || e.type === "gate-fail" || e.type === "gate-blocking",
  );
  const outcome: StageOutcome =
    terminal?.type === "stage-completed"
      ? "passed"
      : terminal?.type === "stage-failed"
        ? "failed"
        : "running";

  const stageKey = stage ?? `step-${index}`;
  const attempt = (attempts.get(stageKey) ?? 0) + 1;
  attempts.set(stageKey, attempt);

  return {
    attempt,
    costUsd: numberFrom(group, "costUsd"),
    durationMs: durationOf(group, startedAt, terminal),
    endedAt: terminal?.createdAt ?? null,
    events: group,
    evidence: failure?.evidence ?? null,
    gateName: failure?.gateName ?? terminal?.gateName ?? null,
    key: `${stageKey}-${attempt}`,
    outcome,
    reason: failure?.reason ?? null,
    stage,
    startedAt,
  };
}

function firstStage(group: readonly ApiJobEvent[]): StageName | null {
  return group.find((e) => e.stage !== null)?.stage ?? null;
}

function durationOf(
  group: readonly ApiJobEvent[],
  startedAt: string,
  terminal: ApiJobEvent | undefined,
): number | null {
  const start = Date.parse(startedAt);
  const end = terminal === undefined ? Number.NaN : Date.parse(terminal.createdAt);
  if (Number.isFinite(start) && Number.isFinite(end) && end > start) return end - start;
  return numberFrom(group, "durationMs");
}

function numberFrom(group: readonly ApiJobEvent[], key: string): number | null {
  for (const event of group) {
    const value = event.payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}
