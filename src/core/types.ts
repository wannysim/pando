/**
 * pando 핵심 계약 — docs/repo-structure.md §3
 * 이 파일의 변경은 ADR을 동반한다 (계약 우선 원칙).
 */

export type StageName = "SPEC" | "PLAN" | "TEST" | "IMPL" | "REVIEW" | "PR";

export type JobStatus =
  | StageName
  | "QUEUED"
  | "DONE"
  | "FAILED"
  | "ESCALATED";

export interface WorkItem {
  id: string; // "AP-1234" | "personal-site-20260606-a"
  repo: string; // repos.yaml 키
  source: "jira" | "brief";
  title: string;
  branch?: string;
  dependsOn?: string[];
  payload:
    | { kind: "jira"; ticketKey: string }
    | { kind: "brief"; briefPath: string; assets?: string[] };
}

export interface RepoProfile {
  path: string;
  scope: "acme" | "external";
  baseBranch: string;
  workItemSource: "jira" | "brief";
  contextProviders: ("atlassian-mcp" | "figma-mcp")[];
  conventions: string; // 스킬 이름 또는 "repo-local"
  setup: string;
  gates: { test: string; lint?: string; types?: string };
  concurrency: number;
  portRange: [number, number];
  envFiles?: string[];
  guards: { protectedBranches: string[]; forbidTestEditInImpl: boolean };
}

export interface WorkerRunOptions {
  cwd: string; // worktree 경로
  prompt: string;
  model: string;
  sessionId?: string; // 단계 간 세션 연속성
  mcpConfig?: string; // claude-code 전용
  outputSchema?: object;
  timeoutMs: number;
  env?: Record<string, string>; // IMPLEMENT_JIRA_BATCH=1 등
}

export interface WorkerResult {
  ok: boolean;
  sessionId?: string;
  costUsd?: number;
  /**
   * 워커의 최종 메시지. 로깅/디버깅 전용.
   * Hyrum's Law 방어: Gate 컨텍스트에는 의도적으로 노출하지 않는다 (ADR-002).
   */
  output: string;
}

export interface WorkerEngine {
  readonly name: string;
  run(opts: WorkerRunOptions): Promise<WorkerResult>;
}

/** 게이트가 볼 수 있는 것 — 결정적 신호의 원천만. WorkerResult.output은 없다. */
export interface GateContext {
  worktree: string;
  item: WorkItem;
  profile: RepoProfile;
}

export interface GateResult {
  pass: boolean;
  reason?: string;
  evidence?: string; // 명령 출력, 체크섬 diff 등
}

export interface Gate {
  readonly name: string;
  check(ctx: GateContext): Promise<GateResult>;
}

/** 단계 실패 보고의 표준 형태 — 침묵 실패 금지 (CLAUDE.md 규율 7) */
export interface StageFailure {
  stage: StageName;
  gateName: string;
  reason: string;
  evidence?: string;
}
