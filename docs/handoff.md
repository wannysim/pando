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

## W2(데몬 TS 구현)에 들어가야 할 설계 입력 — W1에서 발견

1. **base branch 동적 결정**: `RepoProfile.baseBranch` 고정값 가정이 티켓별로 깨짐 (fixVersion → release/* 매핑 필요). `WorkItem`에 baseBranch 오버라이드 추가는 계약 변경이므로 ADR과 함께
2. **Bash 화이트리스트 재설계**: `Bash(git *)`만으론 파이프/복합 명령 거부로 turn 낭비. 단계별 allowedTools 프리셋 필요
3. **flock 외부 의존 제거**: macOS에 flock 기본 없음 → TS 이식 시 `proper-lockfile` 류로
4. **allowedTools 필수값**: `Task` + `mcp__claude_ai_Atlassian` (ADR-004)
5. PLAN 게이트 고도화: PLAN.md의 `[Blocker]`/Open Questions 파싱 → blocking이면 ESCALATED (상태머신에 이벤트 이미 있음: `BLOCKING_QUESTIONS`)
6. **게이트 스코핑**: 전체 `test` 금지 — 변경 워크스페이스/파일로 한정(turbo affected 등). pts는 base 이슈로 baseline부터 적색(codex 무관)이라, 전체 게이트는 무관한 기존 실패를 IMPL 실패로 오판함. 또한 `config/repos.yaml`의 `gates`(test/lint/types)가 아직 전부 `pnpm` → web은 yarn이라 정정 필요(setup만 고쳐짐)
7. **PM 자동감지 1급화** (ADR-005): `setup`/`gates`를 PM-agnostic 동작(install/test/lint/typecheck)으로 표현하고 lockfile로 PM 감지(yarn→pnpm→npm). `RepoProfile`에 `packageManager?` fallback 필드. repos.yaml web `gates` pnpm 정정 포함
8. **ai-skills anti-corruption** (ADR-006): 스킬명을 stages/profile 설정으로 추출, `artifacts.ts`가 `_spec.md`/`PLAN.md` 스키마 소유 + AP-1234 PLAN.md를 픽스처로 **골든 계약테스트**, 의존 규약(worktree-dispatch §1/§5/§8, implement-jira PLAN 스키마, verifier JSON) 버전핀 목록 유지
9. **PLAN 게이트는 커밋 분해 단위 검사** (ADR-007): "PR 분해" 아님. Stacked 제안 섹션(1000줄+)은 옵션 파싱

## 코드 현황

- `src/core/types.ts` — 계약 (WorkItem/RepoProfile/WorkerEngine/Gate). 변경 시 ADR
- `src/core/state-machine.ts` — 완료, 테스트 17개 100% 커버리지
- **다음 세션 시작점 — W2 진입.** 권장 순서(TDD, 계약 먼저):
  1. **config 로더** — yaml→`RepoProfile` 검증 + **PM lockfile 자동감지**(ADR-005). 순수 계층, fake fs unit
  2. **`src/core/artifacts.ts`** — `_spec.md`/`PLAN.md` 스키마 정의·검증 + **골든 계약테스트**(`~/.worktrees/web/feat-AP-1234/PLAN.md`를 픽스처로, ADR-006). ai-skills drift 안전망이라 일찍
  3. **worktree manager** — `01-worktree.sh` TS 이식, 진짜 git(mktemp bare repo) integration, flock→proper-lockfile(W2 입력 3)
  4. **claude-code engine adapter** — `02` 이식, `--mcp-config` 없이 connector 상속(ADR-004) + allowedTools 프리셋(W2 입력 4)
  5. **codex engine adapter** — `03` 이식(샌드박스/JSON 파싱 W1 검증됨), 게이트는 변경 워크스페이스 스코프(W2 입력 6)
  - ①②가 계약 기반이라 먼저. `state-machine.ts`는 완료(17 test 100%)라 ④⑤ 엔진이 붙으면 파이프라인 골격 완성. scheduler 세마포어는 n×n(W4) 전까지 단일 in-flight로 미뤄도 됨

## 참조 문서 지도

- `docs/research-v1.md` — 도구/패턴 리서치 (모델명·가격은 2차 소스, 재확인 필요)
- `docs/design-v2-multi-repo.md` — n×n 설계, `~/.ai-skills` 자산 매핑 (§4·§7 PLAN은 ADR-007 반영됨)
- `docs/adr/` — 001~007. **005**(레포 컨텍스트 격리)·**006**(ai-skills 결합 최소화)·**007**(PLAN 커밋분할)이 이번 평가·피드백 산출. 바꾸려면 새 ADR 먼저
- `docs/repo-structure.md` — 구조·인터페이스 (※ §4 MCP 주입 전제는 ADR-004로 폐기됨)
- `docs/engineering-standards.md` — 개발 방법론 (superpowers + agent-skills 채택분)
- `docs/w1-runbook.md` — W1 절차 + 실행 로그
