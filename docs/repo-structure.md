# 레포 구조 설계 — multi-repo background coding agent orchestrator

> 작성일: 2026-06-06 · 전제: [v1 리서치](./research-v1.md), [v2 설계안](./design-v2-multi-repo.md)
> 결정사항: 로컬 우선(홈서버 Docker는 후반 로드맵) · 단일 레포 · SQLite-only(Redis 없음) · W3 구현 상태 반영

---

## 1. 단일 레포 가능 여부 → 가능

오케스트레이터 데몬, CLI, 설정, 프롬프트, 문서, (추후) 대시보드, (추후) Docker 구성까지 전부 한 레포에 담는 데 문제 없다. 의도적으로 **밖에 두는 것** 두 가지만 명확히 하면 된다:

| 밖에 두는 것 | 이유 | 연결 방식 |
|---|---|---|
| `~/.ai-skills` | 이미 독립 관리 중인 스킬 레포. 복제하면 이중 관리 | 프롬프트 템플릿에서 경로 참조 (`skills_root` 설정값) |
| `~/.worktrees`, 대상 레포들 | 작업 산출물/대상이지 시스템 코드가 아님 | `repos.yaml`의 `path` |
| 시크릿 (.env) | 커밋 금지 | `.env` + `.env.example` 커밋 |

---

## 2. 디렉터리 구조

```
~/Github/{name}/
├── package.json              # pnpm 11, Node 22.12+, TypeScript strict
├── tsconfig.json
├── .github/workflows/ci.yml  # pnpm verify
├── .oxlintrc.json            # 계층 경계 포함 lint 규칙
├── .oxfmtrc.json             # formatter 설정
├── .husky/pre-commit         # staged 파일 oxfmt
├── .env.example              # JIRA_API_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY ...
│
├── config/
│   ├── repos.yaml            # RepoProfile 목록 (v2 §1)
│   ├── stages.yaml           # 단계별 engine/model 매핑 + 전역 기본값 (v2 §4)
│   └── orchestrator.yaml     # global cap, poll 주기, worktree root, skills_root
│
├── src/
│   ├── index.ts              # (예정) 데몬 엔트리
│   │
│   ├── core/                 # 순수 도메인 — I/O 없음
│   │   ├── types.ts          # WorkItem, RepoProfile, WorkerEngine, GateResult
│   │   ├── state-machine.ts  # SPEC→PLAN→TEST→IMPL⇄REVIEW→PR 전이 규칙, retry budget
│   │   ├── config.ts         # repos.yaml 검증/정규화 + PM lockfile 감지
│   │   ├── stage-config.ts   # stages.yaml 검증 + source별 allowed tools 분기
│   │   └── artifacts.ts      # _spec.md / PLAN.md / 게이트 결과 스키마 정의·검증
│   │
│   ├── daemon/
│   │   ├── loop.ts           # 단일 tick daemon loop (W4에서 병렬화)
│   │   └── worktree-provisioner.ts
│   │
│   ├── db/
│   │   ├── schema.sql        # jobs, events, repos (v1 스키마 + repo/source/depends_on)
│   │   └── index.ts          # better-sqlite3 래퍼 (동기 API — 단순함이 장점)
│   │
│   ├── scheduler/            # (W4 예정)
│   │   ├── scheduler.ts      # global cap / per-repo cap / DAG leaf 선별
│   │   ├── semaphore.ts      # 인프로세스 카운팅 세마포어 (MCP rate cap 포함)
│   │   └── repo-mutex.ts     # .git/.dispatch.lock 호환 파일락 (worktree-dispatch §5)
│   │
│   ├── intake/
│   │   ├── jira-poller.ts    # (W5 예정) JQL 폴링 → WorkItem (source: jira)
│   │   └── brief.ts          # briefs/*.md 감시 + CLI 투입 → WorkItem (source: brief)
│   │
│   ├── pipeline/
│   │   ├── runner.ts         # 잡 1개의 단계 실행 루프 (상태머신 구동)
│   │   ├── stages/           # (예정) 단계별 정의: 프롬프트 조립 + 게이트
│   │   │   ├── spec.ts
│   │   │   ├── plan.ts       # implement-jira --batch 호출 조립
│   │   │   ├── test.ts
│   │   │   ├── impl.ts
│   │   │   ├── review.ts
│   │   │   └── pr.ts
│   │   └── gates/            # 기계 판정만 모음 (LLM 출력 신뢰 금지 원칙)
│   │       ├── exit-code.ts        # gates.test/lint/types 실행
│   │       ├── artifact-schema.ts  # _spec.md/PLAN.md 필수 섹션 검사
│   │       ├── checksum.ts         # (W5 예정) 테스트 파일 불변성
│   │       └── diff-rules.ts       # (W5 예정) 금지 경로 수정 검사
│   │
│   ├── engines/
│   │   ├── claude-code.ts    # claude -p, claude.ai connector 상속(--mcp-config 금지)
│   │   └── codex.ts          # codex exec --json
│   │
│   ├── worktree/
│   │   └── manager.ts        # 데몬 모드 생성(origin ref 직접 분기, v2 §3.2),
│   │                         #   setup 훅(.env 복사/install/포트), cleanup
│   │                         #   경로 규약은 worktree-dispatch §1과 호환
│   │
│   ├── reporters/            # (W5 예정)
│   │   ├── jira.ts           # 코멘트/전이/remotelink (REST v3)
│   │   └── log.ts            # events 테이블 + 콘솔 (brief 레포 기본)
│   │
│   └── cli/
│       └── agentctl.ts       # 아래 §4 명령들
│
├── prompts/                  # 단계 워커에게 줄 프롬프트 템플릿 (.md, 변수 치환)
│   ├── spec-from-brief.md    # 신규 (v2 §7-5의 brief-intake 상당)
│   ├── impl-from-plan.md     # 신규 (PLAN.md → 구현 루프)
│   └── review-rubric.md      # verifier를 구조화 JSON 출력으로 감싼 버전
│
├── briefs/                   # 개인 프로젝트 기획 인박스 (커밋 대상)
│   └── {id}/brief.md, assets/
│
├── scripts/                  # W1 헤드리스 검증용 단발 스크립트 (데몬 이전)
│   ├── 01-worktree.sh
│   ├── 02-plan-headless.sh   # claude -p "/implement-jira X --batch" 검증
│   ├── 03-impl-codex.sh
│   └── 04-gates.sh
│
├── docs/                     # 본 문서들 + ADR
│   ├── research-v1.md
│   ├── design-v2-multi-repo.md
│   ├── repo-structure.md     # 이 문서
│   └── adr/                  # 결정 기록 (001-sqlite-only.md ...)
│
├── dashboard/                # (W5+) 웹 대시보드
└── deploy/                   # (후반) 홈서버용 docker-compose.yml, Dockerfile
```

---

## 3. 핵심 인터페이스 (현재 계약 요약)

```typescript
// core/types.ts — 전체 시스템이 공유하는 계약

export type StageName = "SPEC" | "PLAN" | "TEST" | "IMPL" | "REVIEW" | "PR";
export type JobStatus = StageName | "QUEUED" | "DONE" | "FAILED" | "ESCALATED";
export type WorkItemSource = "jira" | "brief" | "github_issue";
export type ContextProvider = "confluence" | "figma";
export type PackageManager = "yarn" | "pnpm" | "npm";
export type PackageAction = "install" | "test" | "lint" | "typecheck";

export interface WorkItem {
  id: string;                          // "AP-1234" | "personal-site-20260606-a"
  repo: string;                        // repos.yaml 키
  source: WorkItemSource;
  title: string;
  branch?: string;
  dependsOn?: string[];
  payload:
    | { kind: "jira"; ticketKey: string }
    | { kind: "brief"; briefPath: string; assets?: string[] }
    | { kind: "github_issue"; owner: string; repo: string; issueNumber: number };
}

export interface RepoProfile {
  path: string;
  scope: "acme" | "external";
  baseBranch: string;
  intake: { sources: WorkItemSource[] };
  context: { providers: ContextProvider[]; policyRefs: string[] };
  workItemSource: WorkItemSource;       // legacy primary source
  contextProviders: ContextProvider[];  // legacy provider list
  conventions: string;                 // 스킬 이름 or "repo-local"
  packageManager?: PackageManager;      // lockfile 감지 실패 시 fallback
  setup: PackageAction;
  gates: { test: PackageAction; lint?: PackageAction; types?: PackageAction };
  concurrency: number;
  portRange: [number, number];
  envFiles?: string[];
  guards: { protectedBranches: string[]; forbidTestEditInImpl: boolean };
}

export interface WorkerRunOptions {
  cwd: string;                         // worktree 경로
  prompt: string;
  model: string;
  sessionId?: string;                  // 단계 간 세션 연속성
  allowedTools?: string[];             // 단계별 CLI tool whitelist
  mcpConfig?: string;                  // ADR-004에 따라 Claude Code는 거부
  outputSchema?: object;
  timeoutMs: number;
  env?: Record<string, string>;        // IMPLEMENT_JIRA_BATCH=1 등
}

export interface WorkerEngine {
  readonly name: string;
  run(opts: WorkerRunOptions): Promise<WorkerResult>;
}

export interface WorkerResult {
  ok: boolean;
  sessionId?: string;
  costUsd?: number;
  output: string;                      // 최종 메시지 (게이트 판정엔 사용 금지)
}

export interface GateContext {
  worktree: string;
  item: WorkItem;
  profile: RepoProfile;
}

export interface Gate {
  readonly name: string;
  check(ctx: GateContext): Promise<GateResult>;
}

export interface GateResult {
  pass: boolean;
  reason?: string;
  evidence?: string;
  failureKind?: "gate-fail" | "blocking-questions";
}
```

`StageDefinition`/`pipeline/stages/*`는 아직 별도 파일로 쪼개지지 않았다. 현재는 `stage-config.ts` + `pipeline/runner.ts`가 stage 설정 해석과 단계 실행 루프를 담당한다.

상태머신 전이 규칙 (core/state-machine.ts):

```
QUEUED → SPEC → PLAN → TEST → IMPL → REVIEW → PR → DONE
                 │              ▲       │
                 │              └───────┘ CHANGES_REQUESTED (budget 차감)
                 └→ ESCALATED  (PLAN의 Open Questions에 blocking 항목)
任意 단계: budget 소진 or 게이트 연속 실패 → FAILED → 보고
```

---

## 4. CLI 설계 (`agentctl`)

```bash
agentctl submit jira AP-1234 --repo web          # 수동 투입 (poller 외)
agentctl submit brief --repo personal-site --id ID   # briefs/{id}/brief.md 투입
agentctl show AP-1234                            # 단계/게이트/이벤트 로그 상세
agentctl retry AP-1234 [--from IMPL]             # 특정 단계부터 재시작
```

`list`, `cancel`, `cleanup`, `daemon` CLI는 W5 운영 UX에서 추가한다. worktree 경로 규약은 이미 `dispatch --list`/`--cleanup`과 호환되도록 유지한다.

---

## 5. 로컬 실행 모델 (Redis 없음)

- **단일 Node 프로세스** 데몬. 동시성은 인프로세스 세마포어(global/per-repo/per-provider 3계층)
- 워커는 `child_process.spawn`으로 `claude -p` / `codex exec` 실행 — 동시 N개는 자식 프로세스라 이벤트 루프 부담 없음
- 상태는 전부 SQLite (WAL 모드). 데몬이 죽어도 jobs 테이블에서 재개 — 단계 시작 전 상태만 기록하면 단계 단위 재실행으로 충분 (단계는 멱등: worktree가 이미 있으면 재사용)
- 멀티 머신 스케일아웃이 필요해질 때만 새 ADR로 큐 인터페이스와 BullMQ 같은 외부 큐를 검토한다. 단일 머신이면 SQLite로 끝까지 가도 무방하다 — Docker 전환의 실체는 "맥 → 리눅스 컨테이너 + 영속 볼륨"이지 큐 교체가 아님

### 홈서버 전환 시 변경점 (deploy/, 후반 로드맵)

```yaml
# deploy/docker-compose.yml 개요 (미래)
services:
  orchestrator:   # 이 레포 그대로. SQLite 볼륨 마운트
  # repo 클론들을 named volume으로, ~/.worktrees도 볼륨
  # 시크릿은 .env → docker secrets
```
주의점만 미리 기록: 컨테이너 안에서 `claude`/`codex` CLI 설치·인증(API 키 모드), Atlassian OAuth 토큰 갱신, git 자격증명(deploy key 권장), pnpm store 볼륨 공유.

---

## 6. W1 검증 스크립트 (보존용)

구현 순서는 v2 로드맵 그대로, 단 `scripts/` 4개를 레포 첫 커밋에 포함:

1. `01-worktree.sh` — web 레포에서 origin/develop 분기 worktree 생성+setup (데몬 방식 검증)
2. `02-plan-headless.sh` — **최대 리스크 검증**: `claude -p "/implement-jira AP-X --batch"`가 claude.ai managed connector를 상속해 비대화형에서 PLAN.md를 만들어내는가. Atlassian MCP 인증이 헤드리스에서 살아있는가
3. `03-impl-codex.sh` — PLAN.md 주고 `codex exec --json --sandbox workspace-write`로 구현 1회
4. `04-gates.sh` — lockfile 감지 기반 test/lint/typecheck + 테스트 체크섬 비교

4개가 전부 통과하면 W2(데몬)는 이 스크립트들의 TS 이식 + 상태머신 결합이라 리스크가 거의 없다.

---

## 7. 남은 구조 포인트

1. **prompts/ vs ~/.ai-skills 경계**: 단계 프롬프트 신규분(impl-from-plan 등)을 이 레포 prompts/에 둘지, .ai-skills에 스킬로 추가할지. 제안: **오케스트레이터 전용(비대화형 전제)은 이 레포, 대화형으로도 쓸 것은 .ai-skills** 기준
2. W4에서는 scheduler/semaphore 계약과 daemon loop 병렬화를 우선한다. 대시보드는 ADR-003에 따라 웹으로 가되, W5 운영 UX에서 구현한다.
