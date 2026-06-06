# W5 운영 준비 계획 — 실제로 맡길 수 있는 최소 제품

> 작성일: 2026-06-06 · 전제: W4 n×n 병렬 완료(PR #13), W4 문서 정리 완료(PR #14), release history 복구 완료(PR #15)

## 목표

W5의 목표는 "대시보드가 예쁜가"가 아니라 **실제로 여러 job을 맡겨도 현재 상태를 보고, 멈추고, 복구하고, 실패 원인을 설명할 수 있는가**다.

W5 완료 조건:

- queue / in-flight / terminal job을 한눈에 볼 수 있다.
- failed / escalated job의 실패 원인과 evidence를 추적할 수 있다.
- cancel / retry / cleanup을 CLI와 API에서 같은 방식으로 실행할 수 있다.
- IMPL 단계가 TEST 단계 산출물과 금지 경로를 훼손하면 deterministic gate가 막는다.
- REVIEW 단계가 IMPL과 다른 엔진/모델로 실행된다는 계약이 테스트로 고정돼 있다.
- 비용과 duration이 stage/event 단위로 기록된다.
- 최소 웹 대시보드에서 list/detail/action/brief submit만 동작한다.
- 실제 Claude/Codex smoke는 global 2~3으로 낮춰 2개 job만 돌려 worktree/provider cap/게이트 기록을 확인한다.

## W5에서 하지 않는 것

- 화려한 dashboard analytics, chart, drag-and-drop queue 조작
- 공개 인터넷 배포용 인증/권한 모델
- GitHub Issue intake/write-back
- Jira/Figma/Confluence provider별 정교한 backoff
- Stacked PR 자동화
- TUI full-screen 앱
- 멀티 컨테이너/멀티 머신 scale-out

이 항목들은 필요가 확인되면 W6 이후로 분리한다.

## W5/W6 경계

| 영역 | W5 | W6 이후 |
|---|---|---|
| Safety | checksum/diff gate, deterministic evidence | sandbox hardening, egress policy |
| Operations | `agentctl list/show/retry/cancel/cleanup/daemon` | notifications, failure analytics |
| API | Hono JSON API v1 | auth provider, public API hardening |
| Dashboard | minimal React SPA list/detail/actions | charts, filters, batch actions |
| Deployment | single daemon container + static dashboard | split web/API containers only if needed |
| Intake/reporting | brief submit, existing jira submit path | GitHub Issue write-back, Jira state transitions |
| Live validation | 2-job smoke with lowered global cap | 3~5 job soak, nightly run |

## 테스트 시나리오 매트릭스

Coverage 숫자는 W4 기준 충분하지만, W5는 "운영 유즈케이스" 기준으로 테스트를 보강해야 한다. 아래 표를 W5 구현 순서의 기준으로 둔다.

### 1. Safety Gates

| 시나리오 | 입력 | 기대 결과 | 테스트 레벨 |
|---|---|---|---|
| TEST 단계가 새 테스트를 만들고 실패를 확인한다 | fake worktree, test command exit 1 | TEST gate pass + checksum 저장 | unit/integration |
| IMPL이 테스트 파일을 수정하지 않는다 | TEST checksum과 IMPL diff 동일 | checksum gate pass | unit |
| IMPL이 테스트 파일을 삭제/수정한다 | checksum mismatch | gate fail `{stage, gateName, reason, evidence}` | unit |
| IMPL이 금지 경로를 수정한다 | diff에 protected path 포함 | diff-rules gate fail | unit |
| monorepo 변경 scope가 감지된다 | package/workspace 파일 diff | 해당 workspace command만 생성 | unit |
| null-agent가 아무것도 하지 않는다 | artifacts 없음 또는 diff 없음 | SPEC/PLAN/TEST gate fail | e2e fake |

### 2. Pipeline Lifecycle

| 시나리오 | 입력 | 기대 결과 | 테스트 레벨 |
|---|---|---|---|
| happy path | fake engines all ok, gates pass | DONE + ordered events | e2e fake |
| blocker question | SPEC/PLAN gate `blocking-questions` | ESCALATED | unit/e2e fake |
| retry budget exhausted | repeated gate fail | FAILED with evidence | unit/e2e fake |
| cancel queued job | QUEUED job cancel | CANCELED terminal state | unit/integration |
| cancel running job | in-flight job cancel | child process stop request + canceled event | integration |
| resume after crash | active persisted job exists | next tick resumes same stage once | integration |
| cleanup terminal job | DONE/FAILED with worktree path | worktree cleanup record/action | integration |

### 3. Scheduler And Concurrency

| 시나리오 | 입력 | 기대 결과 | 테스트 레벨 |
|---|---|---|---|
| global cap | 3 runnable, global 2 | exactly 2 in-flight | unit |
| per-repo cap | same repo over cap | later job remains queued | unit |
| provider cap | confluence cap 1 | second confluence job waits | unit |
| brief-only provider | no context providers | no MCP provider slot consumed | unit |
| live smoke | 2 real jobs, global 2~3 | no worktree collision, events recorded | manual smoke |

### 4. API And CLI

| 시나리오 | API | CLI | 기대 결과 |
|---|---|---|---|
| health | `GET /health` | `agentctl daemon status` | db/worktree/config summary |
| list jobs | `GET /jobs?status=running` | `agentctl list` | same JSON-derived output |
| job detail | `GET /jobs/:id` | `agentctl show` | status, attempts, events, artifacts |
| retry | `POST /jobs/:id/retry` | `agentctl retry` | same transition and event |
| cancel | `POST /jobs/:id/cancel` | `agentctl cancel` | terminal/canceling state |
| cleanup | `POST /jobs/:id/cleanup` | `agentctl cleanup` | worktree cleanup attempted |
| brief submit | `POST /briefs` | `agentctl submit brief` | WorkItem enqueued |

### 5. Dashboard

| 시나리오 | 화면 | 기대 결과 |
|---|---|---|
| overview | job list | queued/running/failed/escalated/done counts |
| inspect | job detail | stage timeline, latest evidence, worktree path |
| act | retry/cancel/cleanup buttons | API mutation + refreshed state |
| submit | brief form | minimal fields + enqueue result |
| capacity | scheduler panel | global/repo/provider usage read-only |
| health | daemon health strip | db path, worktree root, engine config presence |

Dashboard 테스트는 W5에서는 component/unit + API contract 위주로 둔다. Browser E2E는 list/detail/action smoke 1개만 둔다.

## Dashboard MVP

화면은 네 개면 충분하다.

1. **Jobs**
   - status tabs: all / queued / running / failed / escalated / done
   - repo, source, stage/status, updated time, attempts left, cost summary
2. **Job Detail**
   - WorkItem summary
   - stage timeline
   - events table with reason/evidence
   - artifact links: `_spec.md`, `PLAN.md` if present
   - actions: retry, cancel, cleanup
3. **Submit Brief**
   - repo select
   - id/title/brief path or inline brief
   - dry validation result before enqueue
4. **Health**
   - daemon status
   - configured caps
   - DB path, worktree root
   - engine availability hints

하지 않는다:

- rich charts
- queue drag/drop
- multi-user auth
- PR review UI
- Jira/GitHub write-back controls
- command palette
- sidebar-heavy layout
- complex data-grid abstraction

## API Shape

W5 API는 REST JSON v1로 시작한다. GraphQL은 필요 없다.

```text
GET    /health
GET    /scheduler
GET    /jobs
GET    /jobs/:jobId
GET    /jobs/:jobId/events
POST   /jobs/:jobId/retry
POST   /jobs/:jobId/cancel
POST   /jobs/:jobId/cleanup
POST   /briefs
POST   /daemon/tick        # dev/test only, one scheduler tick
```

원칙:

- API response schema를 먼저 타입/테스트로 고정한다.
- `agentctl`과 dashboard는 같은 API client를 공유한다.
- DB 직접 접근 CLI는 W5에서 단계적으로 API client로 대체한다.
- API 인증은 W5에서 Tailscale/private network boundary에 의존한다. 공개 인터넷 노출은 별도 ADR 전까지 금지한다.

## Stack

ADR-003은 "웹 대시보드 + Hono API"를 이미 확정했다. W5 구체 스택은 ADR-009에 따른다.

- API: Hono
- Dashboard: Vite + React + TypeScript SPA
- UI: shadcn/ui를 제한적으로 채택. 허용 기본 컴포넌트는 `Button`, `Badge`, `Table`, `Tabs`, `Dialog`/`AlertDialog`, `DropdownMenu`, `Input`, `Textarea`, `Select`, `Tooltip`, `Skeleton`, `Sonner`
- Styling: shadcn/ui 도입에 필요한 Tailwind 기반을 사용하되, job 운영 화면에 직접 필요한 primitive만 추가한다. 별도 chart/data-grid/sidebar framework는 W5에서 도입하지 않는다
- Tests: Vitest for API/client/components, Playwright smoke는 dashboard가 생긴 뒤 1개만
- Runtime: Node 22, existing pnpm workspace

Next.js/Astro는 W5에 쓰지 않는다. SSR/SEO/content routing 가치가 없고 Docker/daemon 통합만 복잡해진다.

TUI는 만들지 않는다. 대신 terminal 사용자는 `agentctl list/show/watch/cancel/retry/cleanup`으로 커버한다.

### Dashboard Test Scope

W5에서 Vitest와 Playwright를 모두 쓰되, 역할을 좁게 나눈다.

- Vitest는 dashboard PR에서 즉시 구성한다.
- Vitest 대상: Hono API response contract, shared API client, React component 단위 테스트.
- Playwright는 dashboard 화면이 생긴 PR에서 browser smoke 1개만 추가한다.
- Playwright smoke 대상: jobs list 로딩, job detail 진입, retry/cancel/cleanup 중 하나의 mock action 호출, health strip 표시.
- full E2E regression suite, cross-browser matrix, chart/analytics 시각 검증은 W6 이후로 미룬다.

## Docker Shape

W5의 기본 배포 단위는 단일 컨테이너다.

```text
pando container
├─ node daemon
├─ Hono API
├─ static dashboard assets
├─ SQLite: /data/pando.sqlite
├─ repos mount: /repos
├─ worktrees mount: /worktrees
├─ config mount: /config
├─ skills mount: /skills
└─ secrets/env: API keys or CLI auth volumes
```

단일 컨테이너 이유:

- API/dashboard same-origin으로 CORS/auth 복잡도 제거
- SQLite file과 daemon lifecycle이 한 프로세스에 묶임
- child process로 실행되는 Claude/Codex CLI와 worktree mount 관리가 단순함

주의:

- Claude managed connector 상속은 Docker에서 가장 위험한 부분이다. API key mode 또는 auth volume smoke가 필요하다.
- 회사 코드가 홈서버/컨테이너 볼륨에 올라가는 정책 리스크는 별도 확인이 필요하다.
- Docker egress 제한, split web/API container, queue 외부화는 W6 이후다.

## Stacked PR Roadmap

W5는 한 PR로 처리하지 않는다.

1. ✅ **PR 1: safety gate contracts** — 완료(PR #17, develop squash merge)
   - checksum/diff gate 순수 함수와 테스트
   - null-agent fake E2E 추가
   - no dashboard/API
   - 남은 연결점: 실제 git diff/checksum 수집 adapter와 exit-code command scoping 연결은 후속 PR에서 필요한 시점에 붙인다
2. ⬅️ **PR 2: lifecycle and cancellation**
   - cancel status/event 계약
   - retry/cancel/cleanup store interfaces
   - daemon tick cancellation hook
3. **PR 3: telemetry**
   - stage duration/cost event schema
   - `agentctl show` event rendering 보강
4. **PR 4: Hono API foundation**
   - `/health`, `/jobs`, `/jobs/:id`, retry/cancel endpoints
   - CLI API client 전환의 시작
5. **PR 5: operational CLI**
   - `list`, `cancel`, `cleanup`, `daemon` commands
   - `watch`는 가능하면 여기서, 아니면 dashboard PR로 미룸
6. **PR 6: minimal dashboard**
   - Vite React SPA
   - shadcn/ui primitive 기반 운영 UI
   - jobs list/detail/actions/brief submit/health
   - Vitest component/client tests + Playwright smoke 1개
7. **PR 7: Docker and smoke**
   - single-container Dockerfile/compose skeleton
   - 2-job live smoke runbook

W5가 길어지면 PR 6~7은 W6로 넘긴다. 그 경우 W5 완료 기준은 safety gates + API/CLI 운영성까지로 둔다.

## W5 착수 순서

1. ✅ Safety gate scenario tests를 먼저 추가한다.
2. ✅ checksum/diff gate를 순수 계층으로 구현한다.
3. ⬅️ cancel/cleanup 상태와 DB 계약을 고정한다.
4. API response schema를 만든다.
5. CLI를 API client로 점진 이행한다.
6. dashboard는 API가 안정된 뒤 최소 화면만 만든다.
