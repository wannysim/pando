# pando — agent instructions

Multi-repo background coding agent orchestrator. 하나의 데몬이 여러 레포에 git worktree를 만들고, 코딩 에이전트 CLI(claude/codex)를 워커로 부려 Jira 티켓/brief를 SPEC→PLAN→TEST→IMPL⇄REVIEW→PR 파이프라인으로 처리한다.

## 필독 문서

- `docs/repo-structure.md` — 디렉터리 구조, 핵심 인터페이스 (WorkItem, RepoProfile, WorkerEngine, Gate)
- `docs/engineering-standards.md` — 개발 방법론 전문
- `docs/adr/` — 깨면 안 되는 결정들. 바꾸려면 새 ADR 먼저

## 개발 규율 (위반 금지)

1. **TDD 강제**: 실패하는 테스트 먼저 작성하고 실패를 확인한 뒤 구현한다. 테스트보다 먼저 쓴 구현 코드는 삭제하고 다시 시작한다 (RED-GREEN-REFACTOR).
2. **커밋 전 `pnpm verify`**: coverage(전체 85%+, core/gates/scheduler 95%+) + eslint + tsc 전부 통과. "된 것 같다"는 증거가 아니다.
3. **변경 사이징**: 커밋당 ~100라인 내외, atomic. 하나의 커밋은 하나의 이유.
4. **계층 경계**: `src/core`, `src/pipeline`, `src/scheduler`는 순수 계층 — I/O 임포트 금지(eslint가 강제). 부수효과는 port 인터페이스 뒤의 adapter(`engines/`, `worktree/`, `reporters/`, `db/`, `intake/`)에만.
5. **게이트는 결정적 신호만**: LLM 출력 텍스트를 게이트 판정에 사용하는 코드를 작성하지 않는다. exit code, 파일 아티팩트, 체크섬, 구조화 JSON만.
6. **YAGNI**: 지금 필요 없는 추상화를 만들지 않는다. (예: 큐는 SQLite 구현 1개로 시작 — ADR-001)
7. **에러 시맨틱**: 단계 실패는 `{stage, gateName, reason, evidence}` 구조로. 침묵 실패 금지.
8. **언어**: 외부 공개물(README, `AGENTS.md`, git 커밋 메시지)은 영어로 작성. `CLAUDE.md`·`docs/`는 한글 허용(작업용 문서라 본인이 빠르게 읽는 게 우선).

## Git / 릴리즈 규칙

- 모든 작업은 `develop`에서 새 topic 브랜치를 만들어 시작한다. `main`과 `develop`에는 직접 push하지 않는다.
- 일반 기능/수정 브랜치는 PR로 `develop`에 넣고, merge 방식은 squash merge를 사용한다.
- 릴리즈는 `release/*` 브랜치에서 안정화한 뒤 PR로 `main`에 넣고, merge 방식은 merge commit을 사용한다.
- 릴리즈 후에는 같은 릴리즈 변경을 `develop`에도 반영하고, 이때도 merge commit을 사용해 릴리즈 경계를 보존한다.
- 릴리즈 태그는 `v` prefix 없이 작성한다. 예: `0.1`, `0.2`, `1.0.0`.
- 커밋 메시지와 GitHub Release 제목/노트는 영어로 작성한다.

## 테스트 작성 규칙

- 테스트 피라미드 80/15/5 (unit/integration/e2e). DAMP over DRY — 테스트는 중복돼도 읽혀야 한다.
- worktree adapter는 진짜 git으로 테스트한다 (임시 디렉터리에 bare repo). git 모킹 금지.
- engine adapter는 contract test — 같은 스위트를 fake/실구현이 공유.
- 깨지면 곤란한 동작엔 전부 테스트 (Beyoncé Rule). 상태머신 전이표는 전수 테스트.

## 현재 상태

`docs/handoff.md`를 먼저 읽을 것 — 진행 상황, W1 발견사항, 다음 구현 후보가 정리돼 있다.

## 외부 의존 컨텍스트

- `~/.ai-skills` — 사용자의 기존 Claude Code 스킬 레포. 파이프라인 단계 프롬프트가 이 스킬들을 참조한다 (`implement-jira` batch mode, `worktree-dispatch` 규약 등). **이 레포의 규약(경로/락/접두사)과 호환을 유지할 것.**
- worktree 경로 규약: `${WORKTREE_ROOT:-~/.worktrees}/{repo}/{branch-slug}` — `.ai-skills`의 `worktree-dispatch` §1과 동일.
- 권장 플러그인: superpowers, agent-skills(addyosmani) — 이 표준의 원전.
