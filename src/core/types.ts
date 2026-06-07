/**
 * pando 핵심 계약 — docs/repo-structure.md §3
 * 이 파일의 변경은 ADR을 동반한다 (계약 우선 원칙).
 */

export type StageName = "SPEC" | "PLAN" | "TEST" | "IMPL" | "REVIEW" | "PR";

export type JobStatus = StageName | "QUEUED" | "DONE" | "FAILED" | "ESCALATED" | "CANCELED";

export type WorkItemSource = "jira" | "brief" | "github_issue";

export type IntakeSource = WorkItemSource;

export type ContextProvider = "confluence" | "figma";

export interface WorkItem {
  id: string; // "AP-1234" | "personal-site-20260606-a"
  repo: string; // repos.yaml 키
  source: WorkItemSource;
  title: string;
  branch?: string;
  /** Explicit base-branch override. Highest precedence in resolveBaseBranch (ADR-011). */
  baseBranch?: string;
  dependsOn?: string[];
  payload:
    | { kind: "jira"; ticketKey: string; fixVersion?: string }
    | { kind: "brief"; briefPath: string; assets?: string[] }
    | { kind: "github_issue"; owner: string; repo: string; issueNumber: number };
}

export interface RepoProfile {
  path: string;
  scope: "acme" | "external";
  baseBranch: string;
  intake: { sources: IntakeSource[] };
  context: { providers: ContextProvider[]; policyRefs: string[] };
  /** Backward-compatible primary source for W2 callers. Prefer intake.sources. */
  workItemSource: IntakeSource;
  /** Backward-compatible provider list for W2 callers. Prefer context.providers. */
  contextProviders: ContextProvider[];
  conventions: string; // 스킬 이름 또는 "repo-local"
  /**
   * Optional template that maps a Jira fixVersion onto a base branch (ADR-011).
   * `{fixVersion}` is substituted with the ticket's fixVersion, e.g. "release/{fixVersion}".
   */
  releaseBranchTemplate?: string;
  packageManager?: PackageManager;
  setup: PackageAction;
  gates: { test?: PackageAction; lint?: PackageAction; types?: PackageAction };
  concurrency: number;
  portRange: [number, number];
  envFiles?: string[];
  guards: { protectedBranches: string[]; forbidTestEditInImpl: boolean };
}

export type PackageManager = "yarn" | "pnpm" | "npm";

export type PackageAction = "install" | "test" | "lint" | "typecheck";

export interface WorkerRunOptions {
  cwd: string; // worktree 경로
  prompt: string;
  model: string;
  sessionId?: string; // 단계 간 세션 연속성
  allowedTools?: string[]; // 단계별 CLI tool whitelist
  mcpConfig?: string; // managed connector 상속(ADR-004)과 충돌하는 엔진은 거부할 수 있다
  outputSchema?: object;
  timeoutMs: number;
  env?: Record<string, string>; // IMPLEMENT_JIRA_BATCH=1 등
  signal?: AbortSignal; // 취소 시 워커 프로세스를 중단하기 위한 신호
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
  /**
   * 결정적 실패 신호 — retry/backoff 분류 전용 (LLM 텍스트 아님).
   * exitCode/timedOut/errorCode는 프로세스/구조화 JSON에서만 채운다.
   */
  exitCode?: number;
  timedOut?: boolean;
  errorCode?: string;
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
  failureKind?: "gate-fail" | "blocking-questions";
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
