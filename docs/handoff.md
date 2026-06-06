# 인수인계 — 현재 상태와 다음 단계 (2026-06-06)

> 이 문서는 세션 간 컨텍스트 이관용. 새 세션은 CLAUDE.md → 이 문서 → 참조 문서 순으로 읽으면 된다.

## 프로젝트 한 줄 정의

**pando** — 하나의 데몬이 여러 레포에 git worktree를 틔우고 claude/codex CLI를 워커로 부려, Jira 티켓/brief를 `SPEC→PLAN→TEST→IMPL⇄REVIEW→PR` 파이프라인으로 자동 처리하는 multi-repo background coding agent orchestrator.

## 지금까지 결정된 것 (변경하려면 ADR 먼저)

| 결정 | 근거 |
|---|---|
| 상태/큐 = SQLite 단독, 인프로세스 세마포어 3계층 (global 6 / per-repo / per-provider) | ADR-001 |
| 워커 = 기존 CLI 헤드리스 (codex exec, claude -p). SPEC/PLAN은 Claude Code(MCP+스킬), TEST/IMPL은 Codex, REVIEW는 구현과 다른 모델 | ADR-002 |
| 대시보드 = 웹. 데몬이 Hono HTTP API 서빙, agentctl도 같은 API 클라이언트 | ADR-003 |
| 헤드리스 MCP = claude.ai connector **상속** (`--mcp-config` 주입 금지) | ADR-004 ← W1 실측 |
| 레포 환경 컨텍스트 = 선언적 프로파일 + **PM lockfile 자동감지** + SPEC source 분기 + profile fail-fast | ADR-005 ← 평가 |
| `~/.ai-skills` 결합 = 스킬명 설정화 + **PLAN.md 계약을 pando가 소유**(골든 계약테스트) + 의존 규약 버전핀 | ADR-006 ← 평가 |
| PLAN 산출 = **작업단위 커밋 분할이 기본**, Stacked PR은 net 1000줄 초과 시에만 제안 | ADR-007 (ai-skills 스킬 + pando 문서 양쪽 반영) |
| RepoProfile은 intake source와 context source를 분리. 실제 회사 Jira/Confluence/Figma 설정은 private local config에만 둠 | ADR-008 |
| 게이트 = 결정적 신호만 (exit code/아티팩트/체크섬). LLM output은 Gate 컨텍스트에서 타입 제외 | CLAUDE.md 규율 5 |
| 개발 = TDD 강제, `pnpm verify`(커버리지 85%+/core 95%+), core·pipeline·scheduler 순수 계층(eslint 강제) | engineering-standards |
| worktree 규약 = `~/.worktrees/{repo}/{slug}`, origin ref 직접 분기(원본 무간섭), `.dispatch.lock` 공유 | design-v2 §3.2, `~/.ai-skills` 호환 |
| 1차 버전은 티켓당 PR 1개 (Stacked PR 자동화는 후순위) | design-v2 §7 |
| 홈서버 Docker 이전은 후반 로드맵. 지금은 로컬 맥 | 사용자 결정 |

## W1 진행 상황 (docs/w1-runbook.md 실행 로그가 원본)

- ✅ Step 1 worktree 생성 — 원본 무간섭 확인. **01 스크립트는 lockfile 감지로 수정됨** (web=yarn@1)
- ✅ Step 2 헤드리스 PLAN 생성 — **최대 리스크 해소**. AP-1234로 PLAN.md(4-PR 로드맵) 산출, batch mode·스킬 auto-discovery·repo-scope 정상. 비용 ~$2.65
- ✅ Step 3 codex 구현 — gpt-5.5로 PR1(jest config 표준화) 구현 검증 완료(2026-06-06). 샌드박스 격리·JSON 스트림 파싱 OK, 품질 우수(Open Question 자가검증으로 inline tsconfig 유지, a-components 93 tests green). **ADR-002(IMPL=codex) 실측 통과.** 미세 이탈(옵션 순서를 일관 통일했으나 티켓 명시 순서와 반대)→REVIEW 단계 필요 사례. 03 스크립트도 pnpm→yarn 정정함
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
| W2-C: 상태 저장/운영 루프 | ✅ 완료(기본형) | SQLite jobs/events/repos, runner persistence hook/resume, 단일 tick daemon loop, `agentctl submit/show/retry` handler |
| W3: brief 경로 | ✅ 완료 | brief intake/template/loader, personal-site 프로파일 SPEC E2E, `agentctl submit brief` 연결 |
| W4: n×n 병렬 | ⬅️ **다음 작업** | global/per-repo/per-provider 세마포어, 포트/캐시 격리, 병렬 스케줄링 |
| W5: 통제·운영 | ⬜ 예정 | diff/checksum gate 강화, 리뷰어 모델 분리, 비용 추적, 웹 대시보드/원격 투입 |

## 코드 현황

- `src/core/types.ts` — 계약 (WorkItem/RepoProfile/WorkerEngine/Gate). RepoProfile은 ADR-008에 따라 `intake.sources`와 `context.providers`를 canonical로 사용하고, `workItemSource`/`contextProviders`는 legacy 호환 필드로 유지
- `src/core/state-machine.ts` — 완료, 테스트 17개 100% 커버리지
- `src/core/config.ts` — `config/repos.yaml` snake_case → `RepoProfile` 검증/정규화, lockfile 기반 PM 감지(yarn→pnpm→npm), `package_manager` fallback, PM-agnostic action(`install/test/lint/typecheck`) 지원. W3에서 `intake.sources` + `context.providers` 구조로 이행했고, legacy `work_item_source`/`context_providers`는 계속 로드 가능
- `src/core/artifacts.ts` — W2 2단계 완료. `_spec.md`/`PLAN.md` 필수 스키마 검증, Open Questions `[Blocker]` 파싱, ADR-007의 commit 단위 `Implementation Roadmap` 검사. DEMO-1234 legacy `Stacked PR Roadmap`은 sanitized fixture로 drift 감지(파싱은 되지만 현재 계약 invalid)
- `src/worktree/manager.ts` — W2 3단계 완료. `01-worktree.sh` TS 이식, origin base 직접 분기, `~/.worktrees/{repo}/{branch-slug}` 규약, `.git/.dispatch.lock` atomic file lock, env copy/setup hook. 진짜 git integration 테스트 포함
- `src/engines/claude-code.ts` — W2 4단계 완료. `claude -p`, JSON output, allowedTools 기본값(`Task`, `mcp__claude_ai_Atlassian` 포함), ADR-004에 따라 `--mcp-config` 거부
- `src/engines/codex.ts` — W2 5단계 완료. `codex exec --json --sandbox workspace-write --model`, JSON-lines session/cost/output 파싱
- `src/core/stage-config.ts` — `config/stages.yaml` engine/model/skill/source별 skills/allowedTools/env/defaults 검증. W3에서 `allowed_tools_by_source`를 추가해 brief SPEC 경로가 Atlassian MCP tool을 받지 않도록 분리
- `src/pipeline/gates/artifact-schema.ts` — W2-B 완료. `_spec.md`/`PLAN.md` artifact schema gate. PLAN blocker는 `failureKind: "blocking-questions"`로 보고
- `src/pipeline/gates/exit-code.ts` — W2-B 완료. `RepoProfile.gates` PM-agnostic action을 package-manager command로 변환하고 exit code만 판정. workspace scope용 command builder hook 포함
- `src/intake/brief.ts` — W3 완료. ADR-008 brief template, 필수 섹션 검증(`Goal`, `User Story`, `Acceptance Criteria`, `Screens or Behavior`, `Non-Goals`, `Assets`, `Open Questions`), assets 파싱, `[Blocker]` → `failureKind=blocking-questions` SPEC gate 제공
- `src/pipeline/runner.ts` — W2-B/W2-C 완료. fake engine/gate 기반 runner skeleton에 persistence hook(`onEvent`, `onStateChange`)과 persisted stage resume 지원 추가. `SPEC→PLAN→TEST→IMPL→REVIEW→PR→DONE`, SPEC/PLAN blocker→ESCALATED, gate retry budget→FAILED 테스트 포함
- `src/db/schema.sql`, `src/db/index.ts` — W2-C 완료. SQLite jobs/events/repos 저장소, `claimNextRunnable`, status update, event ordering, terminal retry, repo profile 저장/조회. 현재는 `node:sqlite` 사용으로 테스트 실행 시 ExperimentalWarning이 출력될 수 있음
- `src/daemon/loop.ts` — W2-C 완료. 단일 in-flight `runDaemonOnce`: runnable job claim → worktree provision → runner 실행 → 상태/이벤트 persistence. worktree/provision 실패는 `daemon-error` event와 `FAILED` 상태로 기록
- `src/daemon/worktree-provisioner.ts` — W2-C 완료. `RepoProfile` + `worktreeRoot`를 `ensureWorktree` 옵션으로 변환하고 setup command를 PM-agnostic action에서 생성
- `src/cli/agentctl.ts` — W3 완료. `submit jira`, `submit brief`, `show`, `retry`. `submit brief`는 brief 파일을 읽어 schema 검증 후 title/assets를 WorkItem으로 정규화하고, `--brief-path` 생략 시 `briefs/{id}/brief.md`를 사용
- 검증: `pnpm verify` 통과(2026-06-06, `feat/w3-brief-intake`, 16 files / 110 tests, coverage all statements 93.38% / branches 87.1% / functions 96.71% / lines 94.98%). `node:sqlite` 사용으로 검증 중 ExperimentalWarning 1회 출력됨
- 공개 repo hygiene: `tests/` 표면(`describe`/`it`, fixture 문구)은 영어로 정리. 실제 회사 티켓 키는 커밋하지 않고 `DEMO-1234` 같은 가상 키만 사용. `docs/`는 작업자용이라 한글 유지 허용

**다음 세션 시작점 — W4 n×n 병렬.** 권장 순서(TDD):
1. Scheduler/semaphore 계약을 `global / per-repo / per-provider` 3계층으로 고정하고, SQLite runnable job claim과 결합할 최소 인터페이스를 정한다
2. provider cap은 `RepoProfile.context.providers`와 `config/orchestrator.yaml` provider key를 매핑해 적용한다. brief-only profile은 MCP provider cap을 소비하지 않아야 한다
3. worktree provision 단계에서 port/cache/env 격리 값을 job별로 주입한다
4. daemon loop를 단일 tick에서 다중 in-flight 실행으로 확장하되, SQLite는 source of truth로 유지한다
5. 병렬 테스트는 fake engine + deterministic gates로 시작하고, worktree adapter는 기존처럼 진짜 git integration test만 사용한다
6. 실제 회사 Jira/Confluence/Figma URL·project key·page id·file id는 public config/docs/test fixture에 커밋하지 않음

## 참조 문서 지도

- `docs/research-v1.md` — 도구/패턴 리서치 (모델명·가격은 2차 소스, 재확인 필요)
- `docs/design-v2-multi-repo.md` — n×n 설계, `~/.ai-skills` 자산 매핑 (§4·§7 PLAN은 ADR-007 반영됨)
- `docs/adr/` — 001~008. **005**(레포 컨텍스트 격리)·**006**(ai-skills 결합 최소화)·**007**(PLAN 커밋분할)·**008**(intake/context source 분리)이 이번 평가·피드백 산출. 바꾸려면 새 ADR 먼저
- `docs/repo-structure.md` — 구조·인터페이스 (※ §4 MCP 주입 전제는 ADR-004로 폐기됨)
- `docs/engineering-standards.md` — 개발 방법론 (superpowers + agent-skills 채택분)
- `docs/w1-runbook.md` — W1 절차 + 실행 로그
