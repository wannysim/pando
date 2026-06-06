import type { WorkItem } from "../core/types";

/**
 * Jira intake adapter — maps a ticket's fields (including fixVersion) onto a
 * WorkItem. The fixVersion is what the base-branch resolver uses to route a
 * ticket onto a release/* branch (ADR-011). Keeping the mapping in the adapter
 * layer keeps src/core pure: the resolver only reads the normalized contract.
 */
export interface JiraIntakeInput {
  ticketKey: string;
  repo: string;
  title?: string;
  fixVersion?: string;
  branch?: string;
  baseBranch?: string;
  dependsOn?: string[];
}

export function buildJiraWorkItem(input: JiraIntakeInput): WorkItem {
  const fixVersion = nonBlank(input.fixVersion);

  return removeUndefined({
    baseBranch: nonBlank(input.baseBranch),
    branch: input.branch,
    dependsOn: input.dependsOn,
    id: input.ticketKey,
    payload: removeUndefined({
      fixVersion,
      kind: "jira" as const,
      ticketKey: input.ticketKey,
    }),
    repo: input.repo,
    source: "jira" as const,
    title: input.title ?? input.ticketKey,
  });
}

function nonBlank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
