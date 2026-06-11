# 설계안 v2 — 기존 `.ai-skills` 자산 위에 n×n 멀티레포 오케스트레이터 얹기

> Archive note: 현재 작업 큐와 문서 라우팅은 `docs/README.md`를 따른다. 이
> 문서는 설계 발전 기록이다. 지속되는 결정은 `docs/adr/`에만 남기고, 현재
> 코드/ADR과 충돌하면 현재 코드/ADR을 우선한다.

> 작성일: 2026-06-06 · 전제: [리서치 리포트 v1](./research-v1.md)
> 분석 대상: `~/.ai-skills` (implement-jira, repo-scope, dispatch/dispatch-batch, worktree-dispatch, verifier, test-writer 등 33개 스킬 + 7개 에이전트)

---

## 0. 결론 먼저

**너는 이미 시스템의 하층 절반을 만들어놨다.** v1 리포트의 일반론 설계를 버리고, 기존 자산을 그대로 흡수하는 방향으로 수정한다:

| v1 설계 컴포넌트 | 네 기존 자산 | 상태 |
|---|---|---|
| 레포별 룰 분기 | `repo-scope` (acme/external/unknown) | ✅ RepoProfile로 일반화 완료 |
| SPEC 단계 (컨텍스트 수집) | `jira-context-gatherer` + `figma-spec-extractor` | ✅ 회사 레포 전용 경로 + 개인 레포용 brief 경로 완료 |
| PLAN 단계 | `implement-jira` (+ `stacked-pr-planning`) → PLAN.md | ✅ 있음 — **batch mode까지 이미 구현됨** |
| worktree 격리 규약 | `worktree-dispatch` (경로/락/접두사/cleanup) | ✅ 데몬용 origin ref 직접 분기 + job별 port/cache/env 격리 완료 |
| 병렬 부트스트랩 | `dispatch-batch` (Phase 1~5 구현 완료) | ✅ 있음 — 단일 레포 한정 |
| TEST/REVIEW 게이트 | `test-writer`, `verifier`, `review-heuristics`, `ci-preflight` | ✅ 씨앗 있음 — 프롬프트는 그대로, 판정만 기계화 |
| 컨벤션 | `acme-conventions`, `commit-push`, `create-pr` | ✅ 있음 |
| **오케스트레이터 데몬** (큐/상태머신/스케줄러) | 없음 — Claude Code 세션이 수동 오케스트레이터 역할 | ✅ SQLite queue/state + pipeline runner + 병렬 scheduler tick 완료. W5에서 운영 CLI/API 강화 |
| **IMPL 단계 자동화** | dispatch-batch 설계노트 §7-1에서 "(ii) 미정"으로 보류한 그것 | ✅ Codex engine adapter + pipeline stage runner 완료. 실제 live smoke는 W5 초반 |
| **멀티레포 n×n 스케줄링** | 없음 (`.dispatch.lock`이 레포 단위 직렬화 힌트) | ✅ global/per-repo/per-provider in-process scheduler 완료 |

즉 이 프로젝트의 정확한 정의: **`dispatch-batch`의 다음 진화형 — planning fan-out에서 멈췄던 자동화를 IMPL~PR까지 연장하고, 단일 레포에서 멀티 레포로 확장하고, Claude Code 세션 대신 상주 데몬이 오케스트레이션하는 것.**

---

## 1. 핵심 추상화 ①: RepoProfile — `repo-scope`의 일반화

지금 `repo-scope`는 `acme | external | unknown` 3값 분기다. n개 레포를 돌리려면 이걸 **레포별 선언적 프로파일**로 승격한다. W3부터는 ADR-008에 따라 "할 일의 출처"인 intake source와 "해석 보조 맥락"인 context source/provider를 분리한다:

```yaml
# config/repos.yaml은 public 예시만 둔다.
# 실제 회사 Jira/Confluence/Figma 설정은 ~/.config/pando/*.yaml 같은 private config에 둔다.
repos:
  web:
    path: ~/Github/web
    scope: acme
    base_branch: develop            # release/* 동적 지정 가능
    intake:
      sources: [jira]               # 티켓이 WorkItem 원천
    context:
      providers: [confluence, figma] # SPEC 단계에서 쓸 정책/디자인 맥락
      policy_refs: []               # 실제 회사 page/file id는 private config에만
    conventions: acme-conventions
    setup: install                  # PM-agnostic action. lockfile 감지로 실제 명령 치환
    gates:
      test: test
      lint: lint
      types: typecheck
    concurrency: 3                  # 이 레포의 동시 in-flight 상한
    port_range: [3100, 3199]
    guards:
      protected_branches: [main, develop, "release/*"]
      forbid_test_edit_in_impl: true

  personal-site:
    path: ~/Github/personal-site
    scope: external
    base_branch: main
    intake:
      sources: [brief]              # 채팅/파일로 받은 기획이 WorkItem 원천
    context:
      providers: []
    conventions: repo-local         # 최근 커밋/CONTRIBUTING 기준
    setup: install
    gates:
      test: test
      types: typecheck
    concurrency: 2
    port_range: [3200, 3299]
```

포인트:

- `repo-scope`의 판정 로직(owner 감지)은 프로파일 등록 시 1회 검증용으로 강등. 런타임 분기는 전부 프로파일이 담당
- intake source(Jira/brief/GitHub Issue)는 WorkItem을 만든다. context source(Confluence/Figma/assets)는 SPEC 단계가 WorkItem을 해석하는 데만 쓴다
- public repo에는 실제 회사 Jira project key, Confluence page id, Figma file/team 정보, 내부 URL을 커밋하지 않는다
- 스킬들이 `[[repo-scope]]`를 로드하던 자리에 **오케스트레이터가 프로파일을 주입** — 워커 프롬프트에 "이 작업의 scope는 X, 컨벤션은 Y" 식으로 명시. 스킬 수정 최소화
- `implement-jira`의 가드("`scope != acme`이면 일반 계획으로 전환")가 이미 이 구조를 예비해놨음

---

## 2. 핵심 추상화 ②: WorkItem — Jira 티켓과 채팅 기획의 통합

personal-site에는 Jira도 Confluence도 Figma도 없다. 그래서 **입력을 WorkItem으로 추상화**하고, 소스별 어댑터가 동일한 `_spec.md` 아티팩트로 정규화한다:

```typescript
type WorkItem = {
  id: string;                  // "AP-1234" | "personal-site-2026-0606-a"
  repo: string;                // RepoProfile 키
  source: "jira" | "brief" | "github_issue";
  title: string;
  branch?: string;             // 미지정 시 컨벤션으로 생성
  payload:
    | { ticketKey: string }                          // jira
    | { briefPath: string; assets?: string[] }        // brief: md 파일 + 첨부(스크린샷 등)
    | { owner: string; repo: string; issueNumber: number }; // github_issue
};
```

### 2.1 Jira 경로 (web)

기존 그대로: `jira-context-gatherer` → (UI 티켓이면) `figma-spec-extractor` → `_spec.md`. Confluence 축약, fileKey/nodeId 파싱 등 네 스킬의 규칙을 SPEC 단계 워커 프롬프트로 그대로 사용.

### 2.2 Brief 경로 (personal-site 등 개인 프로젝트) — 신규

"개발 시작 단계에서 기획문서 대충 채팅으로 전달하고 디자인도 말로 전달"하는 흐름을 **intake 단계**로 공식화한다:

```
[대화형 intake — 유일하게 사람이 개입하는 구간]
1. 너 ↔ Claude(또는 아무 채팅)로 기획/디자인 구술
2. intake가 brief 템플릿으로 정리해서 되물음 (1회 왕복):
   - 목표 / 사용자 스토리 / 화면·동작 묘사 / 비범위 / 모호한 점
3. 확정되면 briefs/{id}.md 저장 + WorkItem 큐 투입
   → 이후 파이프라인은 Jira 경로와 100% 동일
```

핵심 설계 판단: **모호함 해소를 파이프라인 진입 전에 끝낸다.** `implement-jira` batch mode의 원칙("batch에서는 사용자 인터럽트가 없다 — 모르는 건 Open Questions로")을 그대로 계승하되, brief는 Jira 티켓보다 훨씬 엉성하므로 intake에서 1회 왕복 비용을 지불하는 게 IMPL 단계 retry budget 낭비보다 싸다.

brief 템플릿은 `jira-context-gatherer`의 출력 포맷(요구사항 요약 / 수용 기준 / 모호한 지점)을 재사용 — SPEC 단계 입장에선 두 소스가 구분 불가능해진다. W3의 최소 템플릿은 ADR-008의 `Goal / User Story / Acceptance Criteria / Screens or Behavior / Non-Goals / Assets / Open Questions` 섹션을 따른다.

### 2.3 디자인 전달 (개인 프로젝트)

- 말로 전달한 디자인 → brief의 "화면·동작 묘사" 섹션
- 스크린샷/레퍼런스 이미지 → `briefs/{id}/assets/`에 저장, SPEC 워커가 멀티모달로 읽음
- 나중에 개인 Figma가 생기면 `context.providers: [figma]`만 추가하면 회사 경로와 합류

### 2.4 GitHub Issue 경로 — 후순위

개인 repo에서 GitHub Issue를 todo source로 쓰는 경우는 WorkItem `source: "github_issue"`로 들어오게 한다. 단, W3 구현은 brief only로 제한했다. GitHub Issue polling/상태 write-back은 W5 이후 adapter로 추가한다.

---

## 3. n×n 스케줄링 설계

### 3.1 동시성 3계층

n개 레포 × m개 작업에서 충돌 지점은 세 종류다. 각각 따로 제어한다:

```
┌─ Global cap (예: 6) ── LLM 비용/머신 리소스 상한. 친구의 "in-flight (6)"
│
├─ Per-repo cap (web:3, personal-site:2) ── install/test 폭주, 포트, 빌드 캐시 압력
│   └─ per-repo mutex ── git 객체 조작(worktree add/branch/push) 직렬화
│        = 기존 .git/.dispatch.lock 규약 그대로 (worktree-dispatch §5)
│
└─ Per-provider rate cap ── Atlassian MCP 동시 3~4 (dispatch-batch 설계노트 §6에서
     이미 식별한 리스크), Figma MCP, LLM API 레이트리밋
```

구현 기준: ADR-001에 따라 Redis/BullMQ는 도입하지 않고, SQLite runnable claim + 인프로세스 세마포어로 global/per-repo/per-provider cap을 적용한다. 잡 키는 `{repo}:{itemId}` 의미를 갖는 `jobs.id`로 유니크하게 유지해 같은 티켓 중복 투입을 막는다.

W4 acceptance scope(완료, PR #13):

- 스케줄러/세마포어/병렬 daemon loop는 fake engine + deterministic gate 성격 테스트로 고정했다.
- 실제 Claude/Codex CLI 실행은 W4 본 구현의 필수 acceptance가 아니라, W5 초반 별도 smoke로 2개 job만 돌린다.
- 기본 cap은 `config/orchestrator.yaml`의 `global_concurrency: 6`, repo cap, provider cap을 그대로 사용한다. 첫 live smoke는 실행 옵션에서 global 2~3으로 낮춰 검증한다.
- W4에서는 `RepoProfile.baseBranch`만 사용한다. Jira `fixVersion` → `release/*` 매핑과 `WorkItem.baseBranch` override는 별도 ADR/후속 작업으로 미룬다.
- 게이트는 현재 PM-agnostic command hook까지 사용한다. monorepo 변경 workspace/file 감지는 W5의 diff/checksum gate 강화와 함께 다룬다.
- GitHub Issue intake/write-back, 웹 대시보드/API, Stacked PR 자동화, provider별 정교한 backoff는 W4 범위에서 제외했다.

구현 메모:

- `src/scheduler/semaphore.ts`, `src/scheduler/scheduler.ts`가 global/per-repo/per-provider 슬롯을 원자적으로 획득/해제한다.
- provider cap은 `RepoProfile.context.providers`와 `config/orchestrator.yaml` provider key를 매핑한다. context provider가 없는 brief-only profile은 MCP provider cap을 소비하지 않는다.
- `src/db/index.ts`의 `claimNextRunnable({ excludeJobIds })`는 같은 daemon tick에서 이미 in-flight인 active job 중복 claim을 막기 위한 필터다. SQLite queue 자체를 scheduler가 대체하지 않는다.
- `src/daemon/loop.ts`는 scheduler cap 안에서 여러 job을 시작하지만, runnable 판단과 상태 persistence는 계속 SQLite에 위임한다.
- `src/daemon/worktree-isolation.ts`와 worktree provisioner는 job별 `PORT`, `PANDO_ASSIGNED_PORT`, `PANDO_CACHE_DIR`, `PANDO_JOB_ID`, `XDG_CACHE_HOME`를 setup/runner env로 전달한다.

### 3.2 worktree 규약 변경 — 데몬 모드

`worktree-dispatch` §3의 "원본 repo를 detached로 전환" 절차는 **사람이 원본 repo에서 브랜치를 checkout한 상태에서 출발**하는 대화형 전제다. 데몬은 원본 repo의 체크아웃 상태를 아예 건드리지 않는 게 맞다:

```bash
# 데몬용: 원본 repo의 working tree를 전혀 건드리지 않음
git -C ~/Github/web fetch origin develop          # per-repo mutex 안에서
git -C ~/Github/web worktree add \
  ~/.worktrees/web/feat-AP-1234-xxx \
  -b feat/AP-1234-xxx origin/develop              # origin ref에서 직접 분기
```

- 원본 repo는 fetch만 당함 → 네가 회사에서 그 repo로 일하고 있어도 간섭 없음 (dirty 체크도 불필요해짐 — 데몬은 원본 working tree를 안 씀)
- 경로 규약(`~/.worktrees/{repo}/{branch-slug}`), 허용 접두사, cleanup(§8)은 기존 규약 그대로 유지 — `dispatch --list`/`--cleanup`과 호환됨
- worktree 셋업 훅: `setup` 명령 실행 + `.env` 복사(프로파일에 `env_files` 목록) + `port_range`에서 포트 할당

### 3.3 의존성

dispatch-batch 설계노트 §6의 "티켓 독립성 전제"를 유지하되, WorkItem에 `depends_on: [id]`만 추가. 스케줄러는 DAG leaf부터 투입 (친구 시스템의 roster/upcoming). 1차 구현에선 독립 작업만 받아도 충분하다.

---

## 4. 파이프라인 — 기존 스킬을 단계 워커 프롬프트로 재사용

| 단계 | 워커가 로드할 자산 | 게이트 (오케스트레이터가 기계 판정) |
|---|---|---|
| **SPEC** | jira: `jira-context-gatherer`(+`figma-spec-extractor`) / brief: intake 산출물 | `_spec.md` 존재 + 필수 섹션(수용 기준 등) 스키마 검사 |
| **PLAN** | `implement-jira` batch mode (`stacked-pr-planning`은 net 1000줄 초과 시에만 — ADR-007, scope=acme면 `acme-conventions`) | `PLAN.md` 존재 + **커밋 분해 단위** 검사. Open Questions에 blocking 항목 있으면 → 사람 에스컬레이션 |
| **TEST** | `test-writer`, `scenario-test-design` | 새 테스트가 **실패**하는지 실행 확인 + 테스트 파일 체크섬 기록 |
| **IMPL** | PLAN.md + `react-best-practices` 류 repo 스킬 | configured package gates exit 0 + **체크섬 불변** + diff 규칙 |
| **REVIEW** | `verifier` + `review-heuristics` (구현과 **다른 모델**) | 구조화 판정 JSON. CHANGES_REQUESTED → IMPL 회귀 (budget 차감) |
| **PR** | `create-pr` + `ci-preflight`, scope별 컨벤션 | draft PR 생성 + (jira면) remotelink + 상태 전이 |

워커 호출 형태 — 네 스킬들이 Claude Code 스킬이므로 **1차 버전은 Claude Code 헤드리스가 가장 마찰이 적다**:

```bash
cd $WT_PATH && claude -p "/implement-jira AP-1234 --batch" \
  --output-format json --allowedTools "Read,Glob,Grep,Write,mcp__atlassian__*,mcp__figma__*"
```

`IMPLEMENT_JIRA_BATCH=1` 환경변수 시그널도 이미 정의돼 있으니 그대로 쓴다. v1에서 추천한 `WorkerEngine` 어댑터는 유지 — IMPL 단계만 `codex exec`(OpenAI)로 바꾸는 식의 단계별 엔진/모델 매핑이 프로파일에 들어간다:

```yaml
# 단계별 엔진·모델 (전역 기본값, 레포별 오버라이드 가능)
stages:
  spec:   { engine: claude-code, model: sonnet }      # MCP 의존 → Claude Code
  plan:   { engine: claude-code, model: opus }
  test:   { engine: codex,       model: gpt-5-codex }
  impl:   { engine: codex,       model: gpt-5-codex }
  review: { engine: claude-code, model: opus }        # 구현과 다른 모델 (기만 방지)
```

주의: ADR-004/W1 실측으로 `--mcp-config` 주입 전제는 폐기됐다. SPEC/PLAN의 Atlassian·Figma MCP는 claude.ai managed connector를 헤드리스 Claude Code가 **상속**하는 방식으로 사용한다. 데몬이 도는 머신에서 claude 대화형 로그인과 connector 연결이 선행돼야 하며, 토큰 갱신이 깨지는 패턴이면 SPEC 수집을 Jira REST 직접 호출(API 토큰)로 대체하는 fallback을 설계한다.

---

## 5. 전체 구조 (v1 다이어그램의 멀티레포 수정판)

```
┌────────────────────────────────────────────────────────────────┐
│ Orchestrator daemon (TS, 로컬 맥)                                │
│                                                                 │
│  Intake                          Scheduler                      │
│  ├─ Jira poller (web: JQL 60s)   ├─ global cap 6                │
│  ├─ brief CLI/채팅 intake         ├─ per-repo cap (profiles)     │
│  └─ (후일: github issues)        ├─ per-repo mutex (git ops)    │
│           │                      └─ DAG (depends_on)            │
│           ▼                                │                    │
│  WorkItem queue ──────────────────────────┤                    │
│                                            ▼                    │
│  Pipeline runner (티켓당 상태머신, SQLite 영속)                    │
│   SPEC → PLAN → TEST → IMPL ⇄ REVIEW → PR                       │
│   │  게이트: 아티팩트 스키마 / exit code / 체크섬 / diff 규칙        │
│   ▼                                                             │
│  WorkerEngine adapter (claude -p | codex exec, 단계별 매핑)       │
│   └─ cwd = ~/.worktrees/{repo}/{branch-slug}                    │
│                                                                 │
│  Reporter                                                       │
│   ├─ jira: 코멘트/전이/remotelink (web)                           │
│   └─ brief: 로컬 대시보드 + (옵션) 텔레그램/슬랙 알림                │
└────────────────────────────────────────────────────────────────┘
        ▲ Tailscale: 폰/회사에서 대시보드 + brief 투입
```

DB는 v1 스키마에 `repo TEXT`, `source TEXT`, `depends_on TEXT` 컬럼 추가.

---

## 6. 수정된 로드맵 — 기존 자산 덕에 W1~W2가 크게 짧아짐

| 단계 | 상태 | 내용 | 비고 |
|---|---|---|---|
| **W1: 헤드리스 검증** | ✅ 완료 | 데몬 없이 셸 스크립트로: worktree 생성(§3.2 데몬 방식) → `claude -p "/implement-jira AP-X --batch"` → PLAN.md 확인 → `codex exec`로 IMPL 1회 → 게이트 수동 확인 | MCP 헤드리스/connector 상속, Codex 샌드박스, JSON 스트림 리스크 해소 |
| **W2-A: 계약/어댑터 기반** | ✅ 완료 | `RepoProfile` config loader, PLAN/SPEC artifact schema, daemon-mode worktree manager, Claude/Codex engine adapter | `pnpm verify` 통과 |
| **W2-B: 파이프라인 결합** | ✅ 완료 | stage config loader, artifact/exit-code gates, fake engine 기반 runner skeleton | W2-C persistence hook으로 확장됨 |
| **W2-C: 데몬 최소 루프** | ✅ 완료(기본형) | SQLite jobs/events/repos, retry budget persistence, 단일 in-flight daemon loop, 최소 `agentctl submit/show/retry` handler | W4에서 병렬 tick으로 확장됨 |
| **W3: brief 경로** | ✅ 완료 | brief template/loader/schema gate + personal-site 프로파일 SPEC E2E + `agentctl submit brief` 연결 | brief-only profile은 Jira/MCP tool 없이 SPEC gate를 통과 |
| **W4: n×n 병렬** | ✅ 완료 | 인프로세스 3계층 동시성 + 포트/캐시/env 격리 + 병렬 daemon tick | ADR-001에 따라 BullMQ는 도입하지 않음. SQLite + semaphore 유지. 실제 CLI smoke는 W5 초반 2개 job으로 수행 |
| **W5: 통제·운영** | ✅ 완료 | 체크섬/diff 게이트 강화, cancel/cleanup/resume, 리뷰어 모델 분리, 비용/시간 telemetry, Hono API, `agentctl list/cancel/cleanup/daemon`, 최소 웹 대시보드, single-container Docker runtime, Docker HTTP/API/static smoke, host live worker/full-daemon smoke, Docker worker readiness hardening | PR #25 이후 #28~#55로 develop 반영. Docker live worker probe도 실행했으며 Codex CA blocker는 제거, Claude Docker auth는 API key 또는 container-local login 필요로 정리 |
| **W6: 운영 확장** | ⬜ 예정 | published `pandoctl` 이후 3~5 job soak/nightly run, dashboard analytics, notification, GitHub Issue/Jira write-back, provider backoff, public auth, Docker live worker credential hardening, split containers/TUI 검토 | PR 10 이후 실제 사용 피드백으로 범위를 확정 |

---

## 7. 기존 스킬에 가할 최소 변경 목록

1. **`repo-scope`**: 변경 없음. 프로파일 등록 검증용으로만 사용
2. **`implement-jira`**: 변경 없음 (batch mode 이미 완비). 단, Persistence 절의 "dispatch 래퍼가 commit·push" 전제를 데몬이 대신 수행
3. **`worktree-dispatch`**: §3에 "데몬 모드: 원본 detached 전환 대신 origin ref 직접 분기" 변형 추가 (§1 경로, §5 락, §8 cleanup은 공유)
4. **`jira-context-gatherer`**: "MCP 실패 시 즉시 중단" 유지하되, 데몬에선 중단 사유를 job 실패 사유로 기록 → Jira 코멘트로 에스컬레이션
5. **신규 스킬 2개**: `brief-intake`(대화형 brief 정리), `impl-from-plan`(PLAN.md의 **커밋 N개**를 순서대로 구현하는 IMPL 단계 프롬프트 — ADR-007에 따라 커밋 단위 서브 루프)
6. **`verifier`**: 출력을 자유 서식에서 구조화 JSON(`{verdict, blocking[], suggestions[]}`)으로 — 게이트가 기계 판정하려면 필수

한 가지 설계 긴장 짚고 가면: PLAN.md는 원래 **Stacked PR** 전제였다. 자동 파이프라인에서 stacked를 유지하면 "PR 1 머지 전에 PR 2 진행?" 같은 의존 문제가 생긴다. **→ ADR-007로 확정**: 기본은 **티켓당 PR 1개 + 작업단위 커밋 분할**, Stacked PR은 예상 net 변경 1000줄 초과 시에만 *제안*. `implement-jira` 양쪽(ai-skills 스킬 + 본 문서)에 반영 완료. stacked 자동화는 리뷰 사이클까지 자동화된 뒤(W5+)의 과제다.

---

## 8. acme vs 개인 — 룰 차이 요약표

| 항목 | web (acme) | personal-site (개인) |
|---|---|---|
| 스펙 소스 | Jira 티켓 (+Confluence/Figma MCP) | 채팅 intake → brief.md (+이미지 assets) |
| 모호함 처리 | Open Questions 기록 후 진행 (티켓이 그럭저럭 명세됨) | intake에서 1회 왕복으로 사전 해소 |
| 브랜치/커밋/PR 컨벤션 | `acme-conventions` | repo-local (최근 커밋 관례) |
| 상태 보고 | Jira 전이 + 코멘트 + remotelink | 대시보드 + 알림 |
| 보안 | ZDR/회사 정책 확인, 봇 계정, draft PR + 사람 리뷰 필수 | 자유 — auto-merge까지 실험 가능 (**통제 실험장으로 활용**) |
| 동시성 | MCP rate cap 영향 받음 (3~4) | LLM cap만 |

마지막 줄이 은근 중요하다: **개인 레포를 통제 장치(체크섬 게이트, 리뷰 회귀, budget 튜닝)의 실험장으로 쓰고, 검증된 설정만 회사 레포에 적용**하는 운영 전략이 가능해진다.
