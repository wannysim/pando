# 인수인계 — 현재 상태와 다음 단계 (2026-06-07)

> 이 문서는 세션 간 컨텍스트 이관용. 새 세션은 CLAUDE.md → 이 문서 → 참조 문서 순으로 읽으면 된다.

## 프로젝트 한 줄 정의

**pando** — 하나의 데몬이 여러 레포에 git worktree를 틔우고 claude/codex CLI를 워커로 부려, Jira 티켓/brief를 `SPEC→PLAN→TEST→IMPL⇄REVIEW→PR` 파이프라인으로 자동 처리하는 multi-repo background coding agent orchestrator.

## 지금까지 결정된 것 (변경하려면 ADR 먼저)

| 결정 | 근거 |
|---|---|
| 상태/큐 = SQLite 단독, 인프로세스 세마포어 3계층 (global 6 / per-repo / per-provider) | ADR-001 |
| 워커 = 기존 CLI 헤드리스 (codex exec, claude -p). 현재 기본 self-dogfood profile은 전 단계 Claude Code이며 TEST/IMPL은 sonnet, PLAN/REVIEW는 opus를 쓴다. Codex adapter는 유지 | ADR-002, PR #33 |
| 대시보드 = 웹. 데몬이 Hono HTTP API 서빙, agentctl도 같은 API 클라이언트 | ADR-003 |
| 헤드리스 MCP = claude.ai connector **상속** (`--mcp-config` 주입 금지) | ADR-004 ← W1 실측 |
| 레포 환경 컨텍스트 = 선언적 프로파일 + **PM lockfile 자동감지** + SPEC source 분기 + profile fail-fast | ADR-005 ← 평가 |
| `~/.ai-skills` 결합 = 스킬명 설정화 + **PLAN.md 계약을 pando가 소유**(골든 계약테스트) + 의존 규약 버전핀 | ADR-006 ← 평가 |
| PLAN 산출 = **작업단위 커밋 분할이 기본**, Stacked PR은 net 1000줄 초과 시에만 제안 | ADR-007 (ai-skills 스킬 + pando 문서 양쪽 반영) |
| RepoProfile은 intake source와 context source를 분리. 실제 회사 Jira/Confluence/Figma 설정은 private local config에만 둠 | ADR-008 |
| W5 대시보드는 Vite React SPA + Hono API, 단일 daemon/container 배포로 시작 | ADR-009 |
| 게이트 = 결정적 신호만 (exit code/아티팩트/체크섬). LLM output은 Gate 컨텍스트에서 타입 제외 | CLAUDE.md 규율 5 |
| 개발 = TDD 강제, `pnpm verify`(커버리지 85%+/core 95%+), core·pipeline·scheduler 순수 계층(oxlint 강제) | engineering-standards |
| worktree 규약 = `~/.worktrees/{repo}/{slug}`, origin ref 직접 분기(원본 무간섭), `.dispatch.lock` 공유 | design-v2 §3.2, `~/.ai-skills` 호환 |
| 1차 버전은 티켓당 PR 1개 (Stacked PR 자동화는 후순위) | design-v2 §7 |
| 홈서버 Docker 이전은 후반 로드맵. 지금은 로컬 맥 | 사용자 결정 |

## W1 진행 상황 (docs/w1-runbook.md 실행 로그가 원본)

- ✅ Step 1 worktree 생성 — 원본 무간섭 확인. **01 스크립트는 lockfile 감지로 수정됨** (web=yarn@1)
- ✅ Step 2 헤드리스 PLAN 생성 — **최대 리스크 해소**. AP-1234로 PLAN.md(4-PR 로드맵) 산출, batch mode·스킬 auto-discovery·repo-scope 정상. 비용 ~$2.65
- ✅ Step 3 codex 구현 — gpt-5.5로 PR1(jest config 표준화) 구현 검증 완료(2026-06-06). 샌드박스 격리·JSON 스트림 파싱 OK, 품질 우수(Open Question 자가검증으로 inline tsconfig 유지, a-components 93 tests green). **ADR-002(IMPL=codex) 실측 통과.** 미세 이탈(옵션 순서를 일관 통일했으나 티켓 명시 순서와 반대)→REVIEW 단계 필요 사례. 03 검증 프롬프트도 web=yarn을 명시함
- ⬜ Step 4 게이트 — 체크섬 메커니즘은 자명(PR1 테스트 무수정). test/lint/types는 **변경 워크스페이스로 스코프 필요**(W2 입력 6 참조)
- ✅ **아키텍처 평가 완료 (2026-06-06)**: ① 레포 환경 컨텍스트 격리 ② ai-skills 결합도 → ADR-005/006, W2 입력 7/8 도출. stacked PR 정책은 ADR-007로 ai-skills(`implement-jira`)+pando 문서 양쪽 반영 완료
- 보류: `~/.worktrees/web/feat-AP-1234`는 PLAN.md 검증 산출물 보존을 위해 **유지 권장** (Step 3/4 재료로 쓰거나, 정리 시 PLAN.md만 백업)

## W2 설계 입력 처리 현황 — W1 발견사항 기반

| 입력 | 상태 | 현재 반영 |
|---|---|---|
| base branch 동적 결정 | ⬜ 미해결 | `RepoProfile.baseBranch` 고정값만 있음. 티켓 fixVersion → `release/*` 매핑과 `WorkItem.baseBranch` override는 별도 ADR/계약 변경 필요 |
| Bash 화이트리스트 재설계 | ✅ 완료(기본형) | `WorkerRunOptions.allowedTools`, Claude Code 기본값, `config/stages.yaml` stage별 `allowed_tools` preset 도입 |
| flock 외부 의존 제거 | ✅ 완료 | `src/worktree/manager.ts`가 `.git/.dispatch.lock` atomic file lock 사용. 외부 `flock` 의존 없음 |
| allowedTools 필수값 | ✅ 완료 | Claude Code 기본 allowedTools에 `Task`, `mcp__claude_ai_Atlassian` 포함 |
| PLAN `[Blocker]` 파싱 | ✅ 완료(기본형) | `artifacts.ts` 파싱 + `pipeline/gates/artifact-schema.ts` 연결 + runner가 `failureKind=blocking-questions`를 `BLOCKING_QUESTIONS` 전이로 매핑 |
| 게이트 스코핑 | 🟨 일부 완료 | PM-agnostic exit-code gate와 command builder hook 도입. 변경 workspace/file 감지는 아직 미구현 |
| PM 자동감지 1급화 | ✅ 완료 | `src/core/config.ts`가 lockfile 감지(yarn→pnpm→npm), `package_manager` fallback, PM-agnostic action 지원 |
| ai-skills anti-corruption | ✅ 완료(기본형) | `artifacts.ts`가 PLAN 계약 소유, sanitized legacy fixture로 drift 감지, `stage-config.ts`가 stage→skill/source별 skill 설정을 타입 검증 |
| PLAN 커밋 분해 단위 검사 | ✅ 완료 | valid PLAN은 `Implementation Roadmap`의 `Commit N` 단위를 요구. legacy `Stacked PR Roadmap`은 파싱 가능하지만 현재 계약상 invalid |

## 로드맵 현재 위치

| 단계 | 상태 | 메모 |
|---|---|---|
| W1: 헤드리스 검증 | ✅ 완료 | worktree 생성, Claude PLAN, Codex IMPL, 수동 게이트 리스크 검증 완료 |
| W2-A: 데몬 기반 계약/어댑터 | ✅ 완료 | config loader, artifact schema, worktree manager, Claude/Codex engine adapter 구현. `pnpm verify` 통과 |
| W2-B: 파이프라인 결합 | ✅ 완료 | stage config loader, artifact/exit-code gate, pipeline runner skeleton, fake engine happy path/blocked/fail coverage |
| W2-C: 상태 저장/운영 루프 | ✅ 완료(기본형) | SQLite jobs/events/repos, runner persistence hook/resume, 초기 단일 in-flight daemon loop, `agentctl submit/show/retry` handler. W4에서 병렬 tick으로 확장됨 |
| W3: brief 경로 | ✅ 완료 | brief intake/template/loader, personal-site 프로파일 SPEC E2E, `agentctl submit brief` 연결 |
| W4: n×n 병렬 | ✅ 완료 | global/per-repo/per-provider 세마포어, 포트/캐시/env 격리, 병렬 daemon tick. PR #13 `feat: add parallel scheduler loop` |
| W5: 통제·운영 | ✅ 완료 | PR #17 safety gates부터 PR #25 Docker smoke deployment skeleton까지 develop 반영 완료. 로컬 Docker Desktop에서 image build, compose 기동, `/health`, `/dashboard`, `/briefs`, `/jobs` smoke 확인 완료 |

## 코드 현황

- `src/core/types.ts` — 계약 (WorkItem/RepoProfile/WorkerEngine/Gate). RepoProfile은 ADR-008에 따라 `intake.sources`와 `context.providers`를 canonical로 사용하고, `workItemSource`/`contextProviders`는 legacy 호환 필드로 유지
- `src/core/state-machine.ts` — 완료, 테스트 17개 100% 커버리지
- `src/core/config.ts` — `config/repos.yaml` snake_case → `RepoProfile` 검증/정규화, lockfile 기반 PM 감지(yarn→pnpm→npm), `package_manager` fallback, PM-agnostic action(`install/test/lint/typecheck`) 지원. W3에서 `intake.sources` + `context.providers` 구조로 이행했고, legacy `work_item_source`/`context_providers`는 계속 로드 가능. W4에서 `config/orchestrator.yaml`의 `global_concurrency`와 provider별 `max_concurrent`를 읽는 `loadOrchestratorConfigFromYaml` 추가
- `src/core/artifacts.ts` — W2 2단계 완료. `_spec.md`/`PLAN.md` 필수 스키마 검증, Open Questions `[Blocker]` 파싱, ADR-007의 commit 단위 `Implementation Roadmap` 검사. DEMO-1234 legacy `Stacked PR Roadmap`은 sanitized fixture로 drift 감지(파싱은 되지만 현재 계약 invalid)
- `src/worktree/manager.ts` — W2 3단계 완료. `01-worktree.sh` TS 이식, origin base 직접 분기, `~/.worktrees/{repo}/{branch-slug}` 규약, `.git/.dispatch.lock` atomic file lock, env copy/setup hook. 진짜 git integration 테스트 포함
- `src/engines/claude-code.ts` — W2 4단계 완료. `claude -p`, JSON output, allowedTools 기본값(`Task`, `mcp__claude_ai_Atlassian` 포함), ADR-004에 따라 `--mcp-config` 거부
- `src/engines/codex.ts` — W2 5단계 완료. `codex exec --json --sandbox workspace-write --model`, JSON-lines session/cost/output 파싱. 2026-06-07 full-daemon live smoke에서 Codex stdin 대기가 재현되어 기본 runner를 `spawn(..., stdio: ["ignore", "pipe", "pipe"])`로 전환하고 stdin 종료 회귀 테스트를 추가했다
- `src/core/stage-config.ts` — `config/stages.yaml` engine/model/skill/source별 skills/allowedTools/env/defaults 검증. W3에서 `allowed_tools_by_source`를 추가해 brief SPEC 경로가 Atlassian MCP tool을 받지 않도록 분리
- `src/pipeline/gates/artifact-schema.ts` — W2-B 완료. `_spec.md`/`PLAN.md` artifact schema gate. PLAN blocker는 `failureKind: "blocking-questions"`로 보고
- `src/pipeline/gates/exit-code.ts` — W2-B 완료. `RepoProfile.gates` PM-agnostic action을 package-manager command로 변환하고 exit code만 판정. workspace scope용 command builder hook 포함
- `src/pipeline/gates/checksum.ts` — W5 PR #17 완료. TEST 단계가 기록할 테스트/중요 파일 checksum manifest 순수 로직과 IMPL 단계 checksum mismatch gate 계약. 실패는 `{reason, evidence}` 구조로 보고하며 evidence는 changed/missing checksum JSON
- `src/pipeline/gates/diff-rules.ts` — W5 PR #17 완료. IMPL 단계 테스트 파일 수정/삭제 차단, protected path 변경 차단, monorepo workspace scope resolution을 git diff/file metadata 같은 결정적 입력만으로 판정. 실제 git diff 수집은 adapter/port 쪽 후속 연결 대상
- `src/intake/brief.ts` — W3 완료. ADR-008 brief template, 필수 섹션 검증(`Goal`, `User Story`, `Acceptance Criteria`, `Screens or Behavior`, `Non-Goals`, `Assets`, `Open Questions`), assets 파싱, `[Blocker]` → `failureKind=blocking-questions` SPEC gate 제공
- `src/pipeline/runner.ts` — W2-B/W2-C 완료. fake engine/gate 기반 runner skeleton에 persistence hook(`onEvent`, `onStateChange`)과 persisted stage resume 지원 추가. W4에서 job-level env 병합을 지원해 worktree isolation env(`PORT`, `XDG_CACHE_HOME`, `PANDO_*`)를 worker 실행에 전달. W5 PR 3에서 REVIEW가 IMPL과 독립된 engine/model/allowedTools/env/prompt stage를 받는 회귀 테스트와 injected clock 기반 `stage-started`/`stage-completed`/`stage-failed`/`worker-cost` telemetry 이벤트를 추가. `SPEC→PLAN→TEST→IMPL→REVIEW→PR→DONE`, SPEC/PLAN blocker→ESCALATED, gate retry budget→FAILED 테스트 포함
- `src/db/schema.sql`, `src/db/index.ts` — W2-C 완료. SQLite jobs/events/repos 저장소, `claimNextRunnable`, status update, event ordering, terminal retry, repo profile 저장/조회. W4에서 `claimNextRunnable({ excludeJobIds })`를 추가해 같은 daemon tick 안에서 이미 in-flight인 active job을 중복 claim하지 않음. W5 PR 2에서 `CANCELED` terminal 상태, running cancel request(`cancel_requested_at`), cleanup request/completed/failed event 계약을 추가. W5 PR 3에서 cost/duration/failure payload가 기존 `events.payload_json`으로 round-trip 되는 계약을 고정. ADR-001에 맞춰 `better-sqlite3`를 사용
- `src/scheduler/semaphore.ts`, `src/scheduler/scheduler.ts` — W4 완료. 순수 계층 인프로세스 세마포어와 scheduler. global cap, per-repo cap(`RepoProfile.concurrency`), per-provider cap(`RepoProfile.context.providers` + `config/orchestrator.yaml`)을 원자적으로 획득/해제. brief-only profile은 provider cap을 소비하지 않음
- `src/daemon/loop.ts` — W4 완료. `runDaemonOnce`가 scheduler cap 안에서 여러 job을 동시에 시작할 수 있음. SQLite `claimNextRunnable`은 계속 runnable source of truth이고, scheduler는 in-process 슬롯만 관리. W5 PR 2에서 cancel requested active job을 runnable claim 전에 처리하고 `RunningJobController` port로 stop request를 보낸 뒤 `CANCELED`로 완료하는 계약을 추가. W5 PR 3에서 runner telemetry payload를 DB event로 보존하고 runner에 clock port를 주입. worktree/provision/runner 실패는 `daemon-error` event와 `FAILED` 상태로 기록
- `src/daemon/full-daemon-smoke.ts`, `scripts/full-daemon-smoke.ts` — PR 1 계약 완료(2026-06-07). `pando` self-profile brief job 2개를 `runDaemonOnce`에 투입하고 real worktree provisioner, checked-in stage config, real `ClaudeCodeEngine`/`CodexEngine` adapter classes, deterministic package-action gates를 연결한다. `contract` mode는 worker/gate process runner를 fake로 주입해 Claude/Codex 호출 없이 host daemon wiring만 검증하고, evidence는 `/tmp` 아래 structured JSON으로 남긴다
- `src/daemon/worktree-isolation.ts` — W4 완료. job id와 branch 기반으로 deterministic port/cache/env isolation 값을 생성. `PORT`, `PANDO_ASSIGNED_PORT`, `PANDO_CACHE_DIR`, `PANDO_JOB_ID`, `XDG_CACHE_HOME`를 정의
- `src/daemon/worktree-provisioner.ts` — W4 완료. `RepoProfile` + `worktreeRoot`를 `ensureWorktree` 옵션으로 변환하고 setup command를 PM-agnostic action에서 생성. setup command에 job isolation env를 주입
- `src/worktree/manager.ts` — W4에서 setup command 실행 시 `setupEnv`를 process env에 병합하도록 확장
- `src/cli/agentctl.ts` — W3 완료. `submit jira`, `submit brief`, `show`, `retry`. W5 PR 2에서 직접 store 기반 `cancel <jobId>`와 `cleanup <jobId>`를 추가. cleanup은 worktree cleaner port를 통해 실행하고 request/completed/failed event를 남김. W5 PR 3에서 `show`가 event payload의 cost/duration/failure reason/evidence를 key=value 형식으로 출력. `submit brief`는 brief 파일을 읽어 schema 검증 후 title/assets를 WorkItem으로 정규화하고, `--brief-path` 생략 시 `briefs/{id}/brief.md`를 사용
- `src/cli/pandoctl.ts`, `packages/pandoctl/` — PR 10 완료. `routePandoctl`/`runPandoctl`이 `start`는 `runPandoStartCli`(데몬 부트스트랩), 나머지는 agentctl ops로 라우팅하는 통합 진입점이다. 번들 시 모든 모듈이 같은 `import.meta.url`을 공유해 `isDirectRun` 가드가 동시에 발화하는 문제를 막기 위해 pandoctl이 `globalThis.__PANDOCTL_EMBEDDED__`를 세팅하고 `src/cli/pando.ts`/`src/cli/agentctl.ts`/`src/server.ts`의 auto-run 가드가 이를 확인한다. `packages/pandoctl/build.mjs`(esbuild)가 `better-sqlite3`만 external로 두고 단일 ESM bin(`dist/pandoctl.mjs`, shebang + createRequire shim) + `schema.sql` 복사본을 만든다. `packages/pandoctl/package.json`은 `pandoctl@0.1.0` 실제 publish 후보(bin→dist, files=[dist, README.md], deps=better-sqlite3, build script). `scripts/pandoctl-pack-smoke.mjs`가 build→`npm pack --dry-run`→compiled bin/schema 포함·shebang·native sqlite 로드를 검증하고 `/tmp`에 evidence를 남긴다. 글로벌 bin은 symlink라 `pandoctl.ts`의 `isDirectRun`이 realpath를 해석한다.
- `src/api/app.ts`, `src/server.ts` — W5 PR 7에서 production static dashboard serving을 `/dashboard` 아래로 고정하고, Hono API/SQLite store/static dashboard를 같은 Node server entrypoint로 묶었다. `/health`, `/jobs`, `/briefs` 같은 API route는 JSON route로 유지되어 SPA fallback과 충돌하지 않는다
- `deploy/`, `config/orchestrator.docker.yaml` — W5 PR 7에서 single-container Dockerfile/compose skeleton을 추가했다. mount contract는 SQLite `/data/pando.sqlite`, repos `/repos`, worktrees `/worktrees`, config `/config`, skills `/skills`, HTTP `3210`, dashboard root `/app/dashboard/dist`
- `smoke/two-job-smoke.contract.json`, `scripts/two-job-smoke.mjs`, `docs/runbooks/two-job-smoke.md` — W5 PR 7에서 2-job smoke의 global cap 2~3, worktree collision check, provider cap check, gate evidence check, deterministic fake fallback reason 기록을 테스트 가능한 계약으로 고정했다. 2026-06-07에 `pnpm smoke:full-daemon` host contract + live dogfood runbook을 추가했다
- 검증: `pnpm verify` 통과(2026-06-06, PR #25 기준 27 files / 182 tests, coverage all statements 92.69% / branches 85.60% / functions 96.33% / lines 93.81%). 로컬 Docker Desktop에서 `docker compose -f deploy/docker-compose.yml up --build -d` 성공, container health `healthy`, `/health` JSON 200, `/dashboard` HTML 200, dashboard JS asset 200, `/briefs` enqueue + `/jobs` list 200 확인 후 `docker compose ... down -v`로 정리.
- **Live worker smoke readiness (2026-06-06, branch `chore/live-worker-smoke-readiness`)**:
  - 시작 전 `pnpm verify` 통과. 변경 후 최종 `pnpm verify`도 통과(27 files / 185 tests, coverage all statements 92.69% / branches 85.60% / functions 96.33% / lines 93.81%). Docker HTTP/API/static smoke도 재확인: compose build/up, health `healthy`, `/health` 200, `/dashboard` HTML 200, dashboard JS asset 200, `/briefs` enqueue + `/jobs` list 200, `down -v` 정리.
  - `scripts/two-job-smoke.mjs`에 `--mode readiness`와 host/docker target evidence를 추가했다. evidence는 CLI availability, auth signal booleans, mount/path readiness, global cap 2~3 여부를 구조화 JSON으로 기록한다. secret 값은 기록하지 않는다.
  - Host readiness 통과: `claude 2.1.167 (Claude Code)`, `codex-cli 0.137.0`, `~/.claude`, `~/.codex`, `~/.ai-skills`, `~/.worktrees`, repo/config paths 모두 ready. 명시 API key env는 unset이지만 기본 auth dir 신호가 있음.
  - Host live worker 2-job smoke 통과: `PANDO_GLOBAL_CONCURRENCY=2`, `PANDO_WORKTREE_ROOT=/tmp/pando-live-worker-smoke`, evidence `/tmp/pando-live-worker-smoke/live-worker-smoke.json`. `SMOKE-LIVE-CLAUDE`와 `SMOKE-LIVE-CODEX` 둘 다 exit `0`, `timedOut=false`, worktree path distinct, provider cap pass, gate evidence pass. 초기 구현에서 Codex가 `execFile` stdin 대기로 timeout됐고, `spawn(..., stdio: ["ignore", "pipe", "pipe"])`로 고쳐 재실행 통과.
  - Docker readiness/live follow-up: opt-in Linux CLI install layer로 `claude 2.1.167`, `codex-cli 0.137.0`가 container에서 available해졌다. runtime image는 `ca-certificates`, `git`, `openssh-client`를 포함한다. readiness evidence는 `claude.configFilePresent`와 `codex.configDirWritable`까지 기록해 directory-only false positive를 막는다. Evidence root: `/tmp/pando-docker-live-worker-smoke-20260607/evidence`.
  - Docker live worker smoke는 실제 실행했다. 최초 live evidence는 두 worker 모두 exit `1`: Claude는 `Not logged in`, Codex는 `no native root CA certificates found`. CA blocker를 runtime image 수정으로 제거한 뒤 `docker-live-worker-smoke-post-ca.json`을 재실행했고 readiness blockers는 `[]`, Codex는 exit `0`, Claude는 여전히 exit `1`이었다. 이 환경에서 Claude managed connector는 container로 상속되지 않으므로 다음 live pass는 `ANTHROPIC_API_KEY` 또는 container-local `claude /login` credential이 필요하다.
  - 범위 주의: Docker live worker smoke는 **worker probe**다. Host full daemon live pipeline smoke는 별도로 완료됐고, local daemon/dashboard/API는 `pando start`로 켤 수 있다.
- **Full daemon smoke contract (2026-06-07, branch `chore/full-daemon-live-smoke`)**:
  - `config/repos.yaml`에 `pando` self-profile을 brief-only target으로 추가했다. context providers는 비워 provider cap을 소비하지 않고, gates는 `pnpm test`/`pnpm lint`/`pnpm exec tsc --noEmit` package-action gate로 해석된다.
  - pass-path gate evidence를 DB event에 보존하도록 runner 계약을 보강했다. evidence는 command + exitCode JSON만 기록하고 worker output text는 gate 판정에 쓰지 않는다.
  - Host full-daemon **contract** smoke 재실행 통과: `globalConcurrency=2`, exactly 2 jobs(`PANDO-FULL-SMOKE-1`, `PANDO-FULL-SMOKE-2`), both `DONE`, worktree collision pass, provider usage `{}`, gate evidence pass. Evidence: `/tmp/pando-full-daemon-smoke-contract-20260607-003713/full-daemon-smoke.json`.
  - Host full-daemon **live** smoke: 같은 두 job과 global concurrency `2`로 실행했다. 최초 live run은 TEST 단계 Codex worker가 stdin 대기로 `Reading additional input from stdin...` evidence를 남겼고, 30분 stage timeout과 retry loop를 기다리지 않기 위해 종료했다. Structured failure evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-failure-evidence.json`.
  - Codex runner fix 후 같은 DB의 기존 두 job을 새 enqueue 없이 resume했고 둘 다 `DONE`까지 완료했다. `gateEvidence`, `durationPayloads`, 이전 실패 payload가 DB events에 남았다. Codex/Claude CLI가 parsable cost를 내지 않아 `worker-cost` event는 없었다. Resume evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-resume-evidence.json`.
  - pando self-profile dogfood job `PANDO-LIVE-DOGFOOD-1`을 `agentctl submit brief`로 단일 enqueue하고 full daemon 경로에서 실행했다. Worktree: `/tmp/pando-full-daemon-dogfood-20260607-010122/worktrees/pando/chore-full-daemon-live-dogfood-docs`; evidence: `/tmp/pando-full-daemon-dogfood-20260607-010122/dogfood-evidence.json`; final status `DONE`; docs 변경과 untracked `PLAN.md`를 남겼다.
  - 최종 검증: `pnpm format:check` 통과. `pnpm verify` 통과(2026-06-07, core 28 files / 196 tests, coverage all statements 92.58% / branches 85.15% / functions 96.69% / lines 94.01%; dashboard 1 file / 6 tests + types + build).
- 공개 repo hygiene: `tests/` 표면(`describe`/`it`, fixture 문구)은 영어로 정리. 실제 회사 티켓 키는 커밋하지 않고 `DEMO-1234` 같은 가상 키만 사용. `docs/`는 작업자용이라 한글 유지 허용

**최근 self-dogfood 결과 (2026-06-07, PR #33~#38).**

- PR #33에서 기본 운영 profile을 당분간 all-Claude로 전환했다. TEST/IMPL은 `claude-code sonnet`, PLAN/REVIEW는 `claude-code opus`를 쓴다. Codex adapter는 유지하지만 현재 기본 self-dogfood 경로에서는 쓰지 않는다.
- PR #34/#35에서 실제 pando self-dogfood 중 드러난 runtime blocker를 고쳤다. SPEC/PLAN prompt가 artifact schema(`## Requirements Overview`, `### Commit 1:`)를 명시하고, TEST/IMPL Claude stage는 직접 worktree edit toolset으로 제한한다.
- concurrency 3 self-dogfood batch 결과: `PANDO-3701` dashboard UX, `PANDO-3702` agentctl UX, `PANDO-3703` README/getting-started 모두 `DONE`. Evidence: `/tmp/pando-multi-run-20260607-024505/pando-multi-success-evidence.json`.
- 해당 batch에서 pando가 만든 PR #36, #37, #38은 develop에 merge됐다.

**다음 세션 시작점 — W6 운영 확장.**

W5의 최소 운영 준비와 첫 3-job self-dogfood batch는 닫혔다. 이후 운영 표면 다듬기에서 **pando start 단일 명령(#41), dashboard operations follow-up(#42), agentctl watch/smoke readiness(#40), draft PR gate(#44), pandoctl bin rename + README/docs parity(#51), real git checksum/diff gate adapter(#52), release/* base-branch routing(#53), web inline brief intake(#54), Docker worker readiness hardening(#55 + follow-up), local start dashboard/artifact hygiene(#62)** 이 닫혔다. 마지막 roadmap 항목이던 **pandoctl npm distribution(PR 10)** 도 닫혔다 — 통합 `pandoctl` 진입점 + esbuild 번들 빌드 + 실제 `pandoctl@0.1.0` 패키지. Stacked PR Roadmap(PR 1~10)은 전부 닫혔고, 다음은 **W6 운영 확장**이다.

## 남아있는 작업

1. ✅ **One-command local run UX** (PR #41) — `pando start`(= `pnpm pando start`) 한 번으로 `/tmp` run root 아래 local DB/worktree/config/dashboard/daemon을 켜고, dashboard URL·DB path·worktree root·종료(Ctrl+C)·cleanup(`rm -rf`)을 로그로 출력한다. port 충돌 시 다음 빈 port로 fallback한다.
2. ✅ **Web inline brief intake** (PR #54) — dashboard/API가 자연어 요청과 spec/docs/assets reference를 받아 canonical `brief.md`를 `/tmp` 또는 configured inbox에 materialize하고 WorkItem payload에 연결한다. 기존 file-path brief submit은 advanced/operator 경로로 유지된다.
3. ✅ **README/docs parity + pandoctl rename** (PR #51) — `package.json` `bin`에 `pandoctl`(→ `bin/pandoctl.mjs` → `src/cli/agentctl.ts`)을 추가해 ADR-010이 예약한 운영 CLI 이름을 실제 bin으로 노출했다. `pando start`는 그대로 daemon 부트스트랩 명령으로 유지. README/README.ko/runbook이 같은 명령(`pando start`, `pandoctl …`)과 limitations를 설명하도록 맞췄다. 내부 모듈 이름 `agentctl`은 ADR-010에 따라 유지.
4. ✅ **Dashboard follow-up** (PR #42) — branch/duration/cost 표시와 evidence copy를 포함한 operations follow-up을 반영했다.
5. ✅ **Agentctl follow-up** (PR #40) — `pandoctl watch`와 `smoke readiness` command를 추가했다. API-backed mode와 local DB mode 차이는 `docs/runbooks/agentctl.md`에 문서화돼 있다.
6. ✅ **PR-stage correctness** (PR #44) — deterministic gate로 draft PR을 강제한다.
7. ✅ **Gate adapter 연결** (PR #52) — checksum/diff/workspace scoping의 순수 계약을 실제 git inspector adapter에 연결했다. local runtime IMPL gate가 real git diff 수집을 사용한다.
8. ✅ **Release branch routing** (PR #53) — Jira `fixVersion` 기반 `release/*` base branch 매핑과 `WorkItem.baseBranch` override를 ADR-011과 코드/테스트로 고정했다.
9. ✅ **Docker worker readiness** (PR #55 + 이번 follow-up) — opt-in Linux worker CLI install layer, CA bundle, git/ssh runtime, auth/git credential readiness evidence를 갖췄다. Docker live worker smoke는 실제 실행했고 post-CA rerun에서 Codex는 exit `0`, Claude는 auth blocker로 exit `1`이었다. 이 환경에서 Claude Code managed connector는 container로 상속되지 않아 실제 Docker Claude call은 `ANTHROPIC_API_KEY` 또는 container-local `claude /login` credential이 필요하다는 blocker를 evidence로 남겼다.
10. ✅ **pandoctl npm distribution** (roadmap PR 10) — 통합 진입점 `src/cli/pandoctl.ts`가 `start`(= `pando start`)와 ops 서브커맨드를 한 바이너리로 합친다. `packages/pandoctl`는 esbuild로 번들된 `dist/pandoctl.mjs`(shebang) + `schema.sql`을 담은 실제 publish 후보(`pandoctl@0.1.0`)다. `better-sqlite3`만 native external로 두고 `npm i -g pandoctl`을 임시 `--prefix`로 검증했다(prebuilt 해결, node-gyp 불필요). 실제 npm publish는 W6 항목으로 남긴다.
11. **W6 다음 작업 순서** — 다음 작업은 후보가 아니라 아래 순서로 진행한다.
    1. **Docs/current-state sync** — PR #62 이후 상태를 handoff/roadmap/prompt에 계속 맞춘다. `pando start`는 source checkout의 `dashboard/dist`를 기본 dashboard root로 쓰고, accidental DB/evidence artifact는 repo root가 아니라 `/tmp`로 간다. `pandoctl` release workflow는 생겼지만 실제 npm publish는 아직 마지막 순서다.
    2. **3~5 job soak/nightly 운영화** — 기존 soak/failure analytics 기반을 nightly 또는 반복 실행 가능한 운영 루틴으로 올린다. 새 DB table은 추가하지 말고 기존 jobs/events payload와 `/tmp` structured JSON summary를 사용한다.
    3. **Dashboard failure/readiness analytics** — soak/nightly 결과, terminal failure reason, readiness/auth blocker를 dashboard에서 바로 읽을 수 있게 한다. 판단은 DB/event/structured evidence만 사용하고 LLM output text는 쓰지 않는다.
    4. **Provider backoff/retry policy** — timeout/rate-limit/auth/transient failure를 deterministic failure kind로 나누고 provider별 retry/backoff를 정교화한다. 비용과 무한 retry를 줄이는 것이 목표다.
    5. **Docker Claude live worker smoke** — 위 운영 루틴이 먼저 안정된 뒤 `ANTHROPIC_API_KEY` 또는 container-local `claude /login` credential로 Docker Claude live blocker를 다시 검증한다.
    6. **`pandoctl@0.1.0` 실제 npm publish** — 마지막에 release workflow dry-run → publish → global install/update smoke를 닫는다.

낮은 우선순위 후보: notifications, GitHub Issue/Jira write-back, auth hardening, Docker egress policy, split containers/TUI. 위 1~6이 끝나기 전에는 새 범위를 섞지 않는다.

새 세션에 그대로 전달할 상세 프롬프트는 `docs/next-session-prompt.md`에 있다.

W4 완료 판정:
- ✅ scheduler/semaphore 계약: global / per-repo / per-provider cap 테스트 완료
- ✅ provider cap 매핑: `RepoProfile.context.providers`와 `config/orchestrator.yaml` provider key를 사용. brief-only profile은 MCP provider cap을 소비하지 않음
- ✅ daemon loop: SQLite `claimNextRunnable`을 source of truth로 유지하면서 scheduler cap 안에서 다중 in-flight job 실행
- ✅ worktree isolation: job별 port/cache/env를 provision/setup/runner에 전달
- ✅ acceptance 검증: fake engine + deterministic gate 성격의 unit/integration tests. 실제 Claude/Codex CLI 실행은 W4 본 구현 acceptance에서 제외

W4/W5에서 의도적으로 남긴 것:
- 실제 Claude/Codex worker 2-job probe와 host full-daemon live dogfood는 완료. `pando start`로 local daemon/dashboard/API를 켤 수 있다.
- Docker live worker smoke는 시도 완료. Codex 쪽 image CA blocker는 제거했고 post-CA rerun에서 Codex는 exit `0`까지 확인했다. Claude managed connector는 이 환경에서 container로 상속되지 않는다. 다음 live pass는 `ANTHROPIC_API_KEY` 또는 container-local `claude /login` credential이 준비된 상태에서 재실행한다.
- Jira `fixVersion` 기반 release branch 매핑과 `WorkItem.baseBranch` override는 PR #53/ADR-011로 완료.
- monorepo 변경 workspace/file gate scoping의 순수 계약은 W5 PR #17에서 완료했고, 실제 git diff/checksum adapter 연결은 PR #52로 완료.
- GitHub Issue intake/write-back, Stacked PR 자동화, provider별 정교한 backoff는 아직 범위 밖

W5 우선순위(TDD):
1. ✅ **Safety gates** — checksum/diff gate 순수 계약, IMPL 테스트 파일 수정/삭제 차단, protected path 차단, deterministic workspace scoping, null-agent fake E2E 완료(PR #17)
2. ✅ **Lifecycle controls** — cancel/cleanup/resume 시나리오를 DB/daemon/CLI 계약으로 고정했다
3. ✅ **Review separation + telemetry** — REVIEW 단계가 IMPL과 다른 모델/엔진 설정을 쓰는 계약, cost/duration/failure reason event schema를 테스트로 고정했다
4. ✅ **Hono API + Operational CLI** — `/health`, `/jobs`, retry/cancel/cleanup API와 `agentctl list/cancel/cleanup/daemon` 추가
5. ✅ **Minimal dashboard** — Vite React SPA jobs list/detail/actions/brief submit/health 완료
6. ✅ **Docker + two-job smoke** — single-container skeleton, mount contract, static dashboard serving, deterministic fake smoke fallback 계약 완료. 로컬 Docker image build/compose health/API/dashboard smoke 완료. 실제 live worker smoke는 인증/CLI/비용 준비 후 global 2~3으로만 수행

## 참조 문서 지도

- `docs/research-v1.md` — 도구/패턴 리서치 (모델명·가격은 2차 소스, 재확인 필요)
- `docs/design-v2-multi-repo.md` — n×n 설계, `~/.ai-skills` 자산 매핑 (§4·§7 PLAN은 ADR-007 반영됨)
- `docs/w5-operational-readiness.md` — W5 테스트 시나리오 매트릭스, dashboard/API MVP, Docker shape, W5/W6 경계
- `docs/practical-adoption-roadmap.md` — PR #36~#62 이후 상태와 W6 실행 순서, Docker live worker credential blocker, pandoctl publish 순서
- `docs/adr/` — 001~011. **009**는 W5 dashboard/API/deploy 기본값(Vite React SPA + Hono + single container)을 고정하고, **011**은 release/* base-branch routing을 고정한다. 바꾸려면 새 ADR 먼저
- `docs/repo-structure.md` — 구조·인터페이스
- `docs/engineering-standards.md` — 개발 방법론 (superpowers + agent-skills 채택분)
- `docs/w1-runbook.md` — W1 절차 + 실행 로그
- `docs/next-session-prompt.md` — 다음 세션용 상세 프롬프트
