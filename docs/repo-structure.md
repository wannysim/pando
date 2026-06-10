# 레포 구조 설계 — multi-repo background coding agent orchestrator

> 작성일: 2026-06-06 · 전제: [v1 리서치](./research-v1.md), [v2 설계안](./design-v2-multi-repo.md)
> 결정사항: 로컬 우선 + W5 single-container Docker skeleton · 단일 레포 · SQLite-only(Redis 없음) · W5 운영 준비 완료 상태 반영

---

## 1. 단일 레포 가능 여부 → 가능

오케스트레이터 데몬, CLI, 설정, 프롬프트, 문서, 대시보드, Docker 구성까지 전부 한 레포에 담는 데 문제 없다. 의도적으로 **밖에 두는 것** 두 가지만 명확히 하면 된다:

| 밖에 두는 것 | 이유 | 연결 방식 |
|---|---|---|
| `~/.ai-skills` | 이미 독립 관리 중인 스킬 레포. 복제하면 이중 관리 | 프롬프트 템플릿에서 경로 참조 (`skills_root` 설정값) |
| `~/.worktrees`, 대상 레포들 | 작업 산출물/대상이지 시스템 코드가 아님 | `repos.yaml`의 `path` |
| 시크릿 (.env) | 커밋 금지 | `.env` + `.env.example` 커밋 |

---

## 2. 디렉터리 구조

```
~/Github/{name}/
├── package.json              # pnpm 11, Node 22.13+, TypeScript strict
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
│   ├── server.ts             # Hono API + SQLite store + static dashboard production entrypoint
│   │
│   ├── core/                 # 순수 도메인 — I/O 없음
│   │   ├── types.ts          # WorkItem, RepoProfile, WorkerEngine, GateResult
│   │   ├── state-machine.ts  # SPEC→PLAN→TEST→IMPL⇄REVIEW→PR 전이 규칙, retry budget
│   │   ├── config.ts         # repos.yaml 검증/정규화 + PM lockfile 감지
│   │   ├── stage-config.ts   # stages.yaml 검증 + source별 allowed tools 분기
│   │   └── artifacts.ts      # _spec.md / PLAN.md / 게이트 결과 스키마 정의·검증
│   │
│   ├── daemon/
│   │   ├── loop.ts           # scheduler cap 안에서 다중 in-flight job 실행
│   │   ├── worktree-isolation.ts # job별 port/cache/env 격리값 생성
│   │   └── worktree-provisioner.ts # worktree 생성 + setup env 주입
│   │
│   ├── db/
│   │   ├── schema.sql        # jobs, events, repos (v1 스키마 + repo/source/depends_on)
│   │   └── index.ts          # better-sqlite3 래퍼, runnable claim source of truth
│   │
│   ├── scheduler/
│   │   ├── scheduler.ts      # global cap / per-repo cap / per-provider cap
│   │   ├── semaphore.ts      # 인프로세스 카운팅 세마포어 (MCP rate cap 포함)
│   │   └── repo-mutex.ts     # 필요 시 추가. 현재 git mutex는 worktree manager의 .dispatch.lock
│   │
│   ├── intake/
│   │   └── brief.ts          # briefs/*.md + CLI/API 투입 → WorkItem (source: brief)
│   │
│   ├── pipeline/
│   │   ├── runner.ts         # 잡 1개의 단계 실행 루프 (상태머신 구동, job env 병합)
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
│   │       ├── checksum.ts         # 테스트/중요 파일 불변성
│   │       └── diff-rules.ts       # 금지 경로 수정/변경 scope 검사
│   │
│   ├── engines/
│   │   ├── claude-code.ts    # claude -p, claude.ai connector 상속(--mcp-config 금지)
│   │   └── codex.ts          # codex exec --ephemeral --json
│   │
│   ├── worktree/
│   │   └── manager.ts        # 데몬 모드 생성(origin ref 직접 분기, v2 §3.2),
│   │                         #   setup 훅(.env 복사/install + job isolation env), cleanup
│   │                         #   경로 규약은 worktree-dispatch §1과 호환
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
├── dashboard/                # Vite React SPA 최소 운영 대시보드
├── deploy/                   # single-container Dockerfile/docker-compose.yml
└── smoke/                    # two-job smoke contract
```

---

## 3. 핵심 인터페이스 (현재 계약 요약)

```typescript
// core/types.ts — 전체 시스템이 공유하는 계약

export type StageName = "SPEC" | "PLAN" | "TEST" | "IMPL" | "REVIEW" | "PR";
export type JobStatus = StageName | "QUEUED" | "DONE" | "FAILED" | "ESCALATED" | "CANCELED";
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
  gates: { test?: PackageAction; lint?: PackageAction; types?: PackageAction };
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

W5 PR 3 기준 runner telemetry는 기존 event stream 위에 얹는다. `PipelineRunEvent`는 `stage-started`, `stage-completed`, `stage-failed`, `worker-cost`를 낸다. duration은 runner에 주입된 clock port에서 계산하고, cost는 `WorkerResult.costUsd`를 사용한다. DB는 별도 telemetry 테이블을 만들지 않고 기존 `events.payload_json`에 `{durationMs, costUsd, engine, model, failureKind, reason, evidence, gateName}` 같은 JSON-serializable payload를 저장한다. `agentctl show`는 이 payload를 key=value로 출력하며, Hono API/dashboard는 이 events 계약을 나중에 그대로 읽는다.

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
agentctl cancel AP-1234                           # queued는 CANCELED, active는 cancel request 저장
agentctl cleanup AP-1234                          # terminal job의 worktree cleanup
agentctl list [--status FAILED]                    # API client 기반 job list
agentctl daemon status                             # API client 기반 daemon health
```

`cancel`, `cleanup`은 W5 PR 2에서 직접 store 기반으로 먼저 추가했다. W5 PR 3에서 `show`는 stage event type, cost, duration, failure reason/evidence를 최소한 operator가 디버깅할 수 있게 출력한다. W5 PR 5에서 `list`와 `daemon status`는 Hono API client 기반으로 추가됐다. worktree 경로 규약은 이미 `dispatch --list`/`--cleanup`과 호환되도록 유지한다.

---

## 5. 로컬 실행 모델 (Redis 없음)

- **단일 Node 프로세스** 데몬. 동시성은 인프로세스 세마포어(global/per-repo/per-provider 3계층)
- scheduler는 실행 슬롯만 관리한다. runnable job claim과 상태 persistence의 source of truth는 계속 SQLite다.
- 워커는 `child_process.spawn`으로 `claude -p` / headless-safe `codex exec` 실행 — 동시 N개는 자식 프로세스라 이벤트 루프 부담 없음
- 상태는 전부 SQLite (WAL 모드). 데몬이 죽어도 jobs 테이블에서 재개 — 단계 시작 전 상태만 기록하면 단계 단위 재실행으로 충분 (단계는 멱등: worktree가 이미 있으면 재사용)
- W4 기준 `runDaemonOnce`는 scheduler cap 안에서 여러 job을 시작할 수 있다. `claimNextRunnable({ excludeJobIds })`는 같은 daemon tick에서 이미 in-flight인 job을 다시 잡지 않기 위한 최소 필터다. W5 PR 2부터 running cancel request가 저장된 active job은 runnable claim에서 제외하고, daemon tick은 `RunningJobController` port로 stop request를 보낸 뒤 `CANCELED` terminal 상태로 완료한다.
- worktree setup/runner에는 job별 port/cache env가 들어간다: `PORT`, `PANDO_ASSIGNED_PORT`, `PANDO_CACHE_DIR`, `PANDO_JOB_ID`, `XDG_CACHE_HOME`.
- runner telemetry는 daemon이 persistence hook으로 받아 SQLite events에 저장한다. `src/core`, `src/pipeline`, `src/scheduler`는 DB/파일시스템/child_process/worktree adapter를 직접 import하지 않는다.
- 멀티 머신 스케일아웃이 필요해질 때만 새 ADR로 큐 인터페이스와 BullMQ 같은 외부 큐를 검토한다. 단일 머신이면 SQLite로 끝까지 가도 무방하다 — Docker 전환의 실체는 "맥 → 리눅스 컨테이너 + 영속 볼륨"이지 큐 교체가 아님

### Docker 실행 모델 (deploy/)

```yaml
# deploy/docker-compose.yml 개요
services:
  pando:          # Node daemon + Hono API + static dashboard
  # SQLite: /data/pando.sqlite
  # repos: /repos, worktrees: /worktrees, config: /config, skills: /skills
```
PR #25 이후 로컬 Docker Desktop에서 image build, compose health, `/health`, `/dashboard`, `/briefs`, `/jobs` smoke를 확인했다. 이후 worker CLI install layer, CA bundle, git/ssh runtime, readiness evidence, Docker live worker probe까지 follow-up으로 진행됐다. 현재 남은 Docker/OpenAI live 재검증과 Claude legacy credential blocker는 `docs/README.md`의 Active W6 Queue와 `docs/runbooks/two-job-smoke.md`를 따른다.

---

## 6. W1 검증 스크립트 (보존용)

구현 순서는 v2 로드맵 그대로, 단 `scripts/` 4개를 레포 첫 커밋에 포함:

1. `01-worktree.sh` — web 레포에서 origin/develop 분기 worktree 생성+setup (데몬 방식 검증)
2. `02-plan-headless.sh` — **최대 리스크 검증**: `claude -p "/implement-jira AP-X --batch"`가 claude.ai managed connector를 상속해 비대화형에서 PLAN.md를 만들어내는가. Atlassian MCP 인증이 헤드리스에서 살아있는가
3. `03-impl-codex.sh` — PLAN.md 주고 `codex exec --ephemeral --cd <worktree> --config 'approval_policy="never"' --json --sandbox workspace-write`로 구현 1회
4. `04-gates.sh` — lockfile 감지 기반 test/lint/typecheck + 테스트 체크섬 비교

4개가 전부 통과하면 W2(데몬)는 이 스크립트들의 TS 이식 + 상태머신 결합이라 리스크가 거의 없다.

---

## 7. 남은 구조 포인트

1. **prompts/ vs ~/.ai-skills 경계**: 단계 프롬프트 신규분(impl-from-plan 등)을 이 레포 prompts/에 둘지, .ai-skills에 스킬로 추가할지. 제안: **오케스트레이터 전용(비대화형 전제)은 이 레포, 대화형으로도 쓸 것은 .ai-skills** 기준
2. W5 운영 준비는 완료됐다. git diff/checksum adapter와 exit-code workspace command scoping은 follow-up에서 연결됐다. 다음 구조 포인트는 `docs/README.md`의 Active W6 Queue에 있는 scheduler-enforced provider backoff deferral과 Docker/OpenAI live worker 재검증이다.
