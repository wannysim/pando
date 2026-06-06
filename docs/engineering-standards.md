# 엔지니어링 표준 — 이 프로젝트의 개발 방법론

> 작성일: 2026-06-06 · 적용 대상: 오케스트레이터 레포 자체의 개발 (파이프라인이 만드는 코드가 아니라 **우리가 이 시스템을 만드는 방식**)
> 레퍼런스: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (43k★, Google SWE 문화 기반) · [obra/superpowers](https://github.com/obra/superpowers) (213k★, Jesse Vincent의 TDD 중심 방법론)
> 결정 반영: 테스트 커버리지 중시 / briefs 커밋 / 대시보드는 웹(모바일 접근) / prompts는 이 레포에

---

## 0. 두 레퍼런스에서 무엇을 가져오나

| 출처 | 채택 | 채택 이유 | 미채택 |
|---|---|---|---|
| **agent-skills** (Addy Osmani) | spec-driven-development, planning-and-task-breakdown, test-driven-development(테스트 피라미드 80/15/5, DAMP over DRY, Beyoncé Rule), incremental-implementation(~100라인 변경 단위), api-and-interface-design(Hyrum's Law, 계약 우선), code-review-and-quality, code-simplification(Chesterton's Fence), documentation-and-adrs, security-and-hardening(시크릿) | Google SWE 문화의 검증된 규율. 특히 "검증은 증거로"(Verification is non-negotiable)와 anti-rationalization 표는 우리 게이트 철학과 동일 | frontend-ui-engineering·performance·browser-testing 등은 대시보드 만들 때 그때 로드. deprecation/shipping은 규모상 불필요 |
| **superpowers** (Jesse Vincent) | brainstorming→writing-plans→subagent-driven-development 루프, **RED-GREEN-REFACTOR 강제**("테스트보다 먼저 쓴 코드는 삭제"), verification-before-completion, systematic-debugging(4단계 근본원인), YAGNI | 너의 `web/.claude/skills`에 이미 subagent-driven-development가 있음 — 같은 계보라 학습 비용 0. TDD 강제 수준이 agent-skills보다 높아서 "높은 커버리지 all-pass" 요구에 더 부합 | 나머지 collaboration 스킬은 플러그인 설치로 자동 활성화되므로 별도 채택 절차 불필요 |

적용 방식 (둘 다 MIT, Claude Code 플러그인):

```bash
# 이 레포에서 개발 세션 열 때 (superpowers는 Codex 플러그인도 있음)
/plugin install superpowers@claude-plugins-official
/plugin marketplace add addyosmani/agent-skills && /plugin install agent-skills@addy-agent-skills
```

플러그인 + 아래 §1~§4를 압축한 **CLAUDE.md(AGENTS.md 겸용)**를 레포 루트에 둔다. 스킬 전문을 복사하지 않는다(이중 관리 금지) — 원칙만 CLAUDE.md에 박고, 스킬은 플러그인이 로드.

**도그푸딩 포인트**: 이 표준은 나중에 파이프라인의 IMPL/REVIEW 단계 워커 프롬프트에도 그대로 주입한다. 우리가 지키는 규율 = 에이전트에게 시키는 규율.

---

## 1. 개발 사이클 (superpowers 워크플로우의 우리 버전)

```
① 설계 합의 (brainstorming/spec)   — 기능마다 docs/specs/{slug}.md. 이미 docs/에 v1·v2·구조 문서가 이 역할
② 작업 분해 (writing-plans)        — 태스크당 2~30분 단위, 파일 경로·수용 기준 명시
③ RED   — 실패하는 테스트 먼저. 실패 확인 없이 구현 시작 금지
④ GREEN — 테스트를 통과시키는 최소 구현 (YAGNI)
⑤ REFACTOR + 커밋 — 변경 ~100라인 내외 atomic commit (agent-skills 변경 사이징)
⑥ verification-before-completion — "된 것 같다" 금지. pnpm verify 출력이 증거
```

규칙 세 줄 요약: **테스트 없는 구현 코드 금지 · 커밋 전 `pnpm verify` 통과 · 아키텍처 결정은 ADR로.**

---

## 2. 테스트 전략 — "높은 커버리지 all-pass"의 구체화

### 2.1 도구와 기준

- **vitest** + v8 coverage. `pnpm verify` = `pnpm coverage && pnpm lint && pnpm types` (`vitest run --coverage`, `oxlint .`, `tsc --noEmit`)
- 커버리지 게이트(CI 실패 기준): `src/core` `src/pipeline/gates` `src/scheduler` **95%+** / 전체 **85%+** / `src/cli`·엔트리 제외 가능
- 테스트 피라미드 80/15/5 (agent-skills): unit 다수, integration 소수, e2e 스모크 한 줌
- **DAMP over DRY**: 테스트는 중복돼도 읽혀야 한다. 과한 헬퍼 추상화 금지
- **Beyoncé Rule**: "If you liked it, you should have put a test on it" — 깨지면 곤란한 동작엔 전부 테스트. 게이트/상태머신/락이 1순위

### 2.2 테스트 가능성을 위한 아키텍처 제약 (구조에 미치는 영향)

핵심: **부수효과를 가장자리로 밀어내는 ports & adapters**. 기존 구조 설계의 디렉터리는 유지하되 의존 방향을 강제한다:

```
src/core, src/pipeline(stages·gates 로직), src/scheduler   ← 순수. I/O 임포트 금지 (oxlint 경계 규칙으로 강제)
        │ 의존 (인터페이스로만)
        ▼
ports: WorkerEngine, Vcs(git), IssueTracker(jira), Clock, Db
        ▲ 구현
adapters: engines/claude-code·codex, worktree/manager, reporters/jira, db/
```

| 계층 | 테스트 방법 | 비고 |
|---|---|---|
| core·gates·scheduler (순수) | unit — fake port 주입, 빠르고 결정적 | 커버리지 95% 대상. 상태머신 전이표는 전수 테스트 |
| worktree adapter | **integration — 진짜 git** (`mktemp` bare repo + clone). git을 모킹하면 거짓 안심 | superpowers 철학: evidence over claims |
| jira adapter | unit — HTTP 레벨 모킹(msw/nock) + 실서버 스모크는 수동 스크립트 | rate limit/429 재시도 케이스 포함 |
| engine adapters | **contract test** — 동일 테스트 스위트를 fake/claude/codex 구현에 공유 실행. CI에선 fake만, 실 CLI는 로컬 태그드 테스트 | 엔진 교체 가능성의 실질 보증 |
| e2e | fake engine으로 submit→PR 풀 사이클 1개 + **null-agent 테스트**(아무것도 안 하는 엔진이 게이트 전부 탈락하는지) | v2 §의 reward-hacking 방어를 시스템 자신에게 적용 |

### 2.3 CI (.github/workflows/ci.yml)

push/PR마다: `pnpm verify` + 커버리지 임계치. Shift Left(agent-skills ci-cd) — 로컬 `pnpm verify`와 CI가 완전히 같은 명령. main 브랜치 보호 + PR 필수는 너 혼자여도 켜둔다(에이전트가 이 레포 자체를 만지게 될 미래 대비).

---

## 3. 설계 원칙 (api-and-interface-design + code-simplification 채택분)

1. **계약 우선**: §3 인터페이스(WorkItem, RepoProfile, WorkerEngine, Gate)가 먼저, 구현이 나중. 변경 시 ADR
2. **Hyrum's Law 의식**: 엔진 어댑터의 `output` 필드처럼 "관측 가능한 모든 동작"에 의존이 생긴다 — 게이트가 LLM output 텍스트에 의존하지 못하게 타입 수준에서 차단(`output`을 게이트 컨텍스트에서 제외)
3. **Chesterton's Fence**: `.ai-skills` 규약(락 파일, 경로 규칙)을 바꿀 땐 왜 그렇게 돼 있는지 먼저 문서로 확인 — worktree-dispatch §5 같은 규칙엔 이유가 있다
4. **YAGNI**: BullMQ 추상화 레이어를 미리 만들지 않는다. 큐 인터페이스 하나만 두고 SQLite 구현 1개로 시작 (ADR-001)
5. **에러 시맨틱**: 모든 단계 실패는 `{stage, gateName, reason, evidence}` 구조화 — 디버깅 가능성이 곧 운영 가능성

---

## 4. 문서화 (documentation-and-adrs 채택분)

- `docs/adr/NNN-title.md` — 결정과 **이유**. 초기 3건 예약: 001 SQLite-only, 002 worker=기존 CLI 하네스(직접 구축 대신), 003 대시보드 웹(모바일 접근)
- `docs/specs/` — 기능별 스펙 (개발 사이클 ①의 산출물)
- README는 "왜 + 5분 안에 돌려보기"만. 장황한 설명은 docs/로

---

## 5. 구조 설계 문서에 반영할 변경분 (이번 결정 통합)

1. **briefs/ 커밋** — gitignore 안 함 (확정)
2. **dashboard = 웹** — 데몬이 HTTP API(Hono 추천: 가볍고 Node/Bun/Workers 호환)를 서빙, `dashboard/`는 React SPA. Tailscale로 폰에서 접속해 brief 투입·진행 확인·retry까지. `agentctl`은 같은 API의 CLI 클라이언트로 재정의 (API가 단일 진실원 — 웹/CLI가 같은 API)
3. **tests/ 추가**:
   ```
   tests/
   ├── unit/          # core, gates, scheduler (미러 구조)
   ├── integration/   # worktree(실제 git), db
   ├── contract/      # engine 공유 스위트
   └── e2e/           # fake-engine 풀 사이클 + null-agent
   ```
4. **.github/workflows/ci.yml** + CLAUDE.md(본 표준 압축본) + docs/adr/ 추가
5. 모듈 경계 oxlint 규칙 (`no-restricted-imports`로 core→adapter 임포트 차단)
