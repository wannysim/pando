# 05 — 구현 로드맵

> 작성일: 2026-06-12 · 항목 ID는 [02](./02-architecture-assessment.md) 카탈로그, 수용 기준은 [08-backlog.md](./08-backlog.md)
> 원칙: 커밋당 ~100라인 atomic, 전 항목 TDD(RED 먼저), 매 PR `bun run verify`. 바인딩 결정은 ADR 선행.

---

## 0. 마일스톤 개관과 의존 관계

```
M0 ──→ M1 ──→ M2 ──→ M4 (대시보드는 M2 텔레메트리에 의존)
         └──→ M3 (신뢰성 — M2와 병행 가능)
         └──→ M5 (테스트/CI — 상시 병행, 일부는 M1에 포함)
```

| 마일스톤 | 주제 | 규모 감 |
|---|---|---|
| M0 | W6 큐 종결 (`pandoctl` publish) | PR 0–1개 |
| M1 | Quick wins — 안전한 소형 수정 일괄 | 소형 PR ~12개 |
| M2 | 루프 엔지니어링 코어 | ADR 1 + PR ~8개 |
| M3 | 데몬/어댑터 신뢰성 | ADR 1 + PR ~7개 |
| M4 | 대시보드 재설계 | ADR 1 + PR ~10개 |
| M5 | 테스트/CI 강화 | PR ~6개 |

## M0 — 활성 큐 종결 (선행)

기존 `docs/README.md` 큐 규율("Deferred until the queue above is closed") 존중.
`pandoctl@0.1.0` publish: release workflow dry-run → `NPM_TOKEN`으로 publish → global install/update smoke → 큐 체크 + 런북 갱신. 본 로드맵은 publish 완료 후 docs/README.md의 새 활성 큐로 등재한다.

## M1 — Quick wins

전부 독립적·소형·기존 테스트 비파괴. 착수 순서 무관.

| 항목 | finding | 파일 | 난이도 | 효과 | 검증 |
|---|---|---|---|---|---|
| per-dir 95% 커버리지 게이트 | TV-01 | `scripts/check-coverage.ts` | 하 | 핵심 계층 회귀 차단 | 게이트 추가 후 verify green 확인 |
| Playwright `bun run dev` 수정 | DS-01 | `dashboard/playwright.config.ts` | 최하 | e2e smoke 부활 | `bun run smoke` 로컬 통과 |
| BriefSubmitPanel try/catch | DS-02 | `App.tsx` | 최하 | 침묵 실패 제거 | 거부 케이스 테스트 선행 |
| analytics 에러 분기 / idle 저속 폴링 | DS-08/09 | `App.tsx` | 하 | UX 정직성 | 컴포넌트 테스트 |
| 진행률 미터를 `STAGE_ORDER` 유도로 | DS-03 | `App.tsx` | 하 | 가짜 진행률 제거 | 단위 테스트 |
| diff-rules base ref → resolver | PL-05 | `gates/diff-rules.ts` | 하 | 릴리즈 잡 오판 제거 | fixVersion/override 케이스 테스트 |
| `[Blocker]` 단락 스캔 | PL-15 | `core/artifacts.ts` | 하 | 에스컬레이션 우회 봉쇄 | 단락형 blocker 테스트 |
| ZERO_CLOCK 제거(clock 필수화) | PL-08 | `pipeline/runner.ts` | 하 | 침묵 오염 제거 | 타입 에러로 강제 |
| evidence 기록 truncate | PL-22/IO-19 | `runner.ts`, `loop.ts` | 하 | DB 비대 방지 | truncate 경계 테스트 |
| agentctl cleanup 프로필 해석 | IO-03 | `cli/agentctl.ts` | 하 | 죽은 명령 복구 | repos.yaml 경유 테스트 |
| stages.yaml strict-key + intake 파싱(또는 거부) | CF-01/02/03 | `core/stage-config.ts`, `core/config.ts` | 중 | 설정 드리프트 차단 | unknown-key 거부 테스트 |
| oxlint 경계 보강 + dashboard lint 편입 | TV-02, DS-16 | `.oxlintrc.json` | 중 | 경계 도구 강제 | lint 1회 정리 wave 각오 |
| tsconfig에 `scripts/` 포함 | TV-03 | `tsconfig.json` | 하 | 운영 스크립트 타입 안전 | tsc 통과 확인 후 |
| verify 중복 실행 제거 | TV-06 | `package.json` | 하 | CI 시간 절감 | verify green |

## M2 — 루프 엔지니어링 코어

> 근거와 설계는 [03-loop-engineering-improvements.md](./03-loop-engineering-improvements.md). **ADR-013**(REVIEW verdict 계약 + `reworkCyclesLeft` + `WorkerUsage` + pricing 스키마)을 먼저 작성한다.

| 순서 | 항목 | finding | 파일 | 난이도 | 리스크 | 검증 |
|---|---|---|---|---|---|---|
| 1 | 실제 CLI 출력 fixture + 공유 엔진 contract suite | TV-07 | `tests/unit/engines/` 신설 | 중 | L | fixture 재생으로 현 파서 결함이 RED로 재현됨을 먼저 확인 |
| 2 | claude JSON 결과 파싱 (cost/session/usage) | IO-01 | `engines/claude-code.ts` | 중 | L | contract suite + 파싱 실패 폴백 테스트 |
| 3 | codex 스트림 파서 재작성 (중첩 봉투, token_count) | IO-01 | `engines/codex.ts` | 중 | M | fixture 기반. truncate-before-append 버그 동시 수정 |
| 4 | `WorkerResult.usage`/`model` + `worker-cost` payload 확장 | IO-01 | `core/types.ts`, `runner.ts` | 하 | L | ADR-013 후. additive |
| 5 | `core/cost.ts` 순수 비용 계산 + `config/pricing.yaml` | CF-04 | 신설 | 중 | L | 단위 테스트, 추정/실측 플래그 |
| 6 | 실패 피드백 `PromptBuildContext{attempt,lastFailure}` | PL-04 | `runner.ts` | 중 | L | 2회차 프롬프트에 증거 포함 테스트 |
| 7 | attempt/터미널 이벤트, `deferred` 결과, 취소 이벤트 분리 | PL-11/12/14, IO-09 | `runner.ts`, `claude-code.ts` | 중 | L | 이벤트 shape 테스트 |
| 8 | 게이트 타임아웃 port | PL-06 | `gates/exit-code.ts`, adapters | 중 | M | 행 걸린 명령 테스트 (자식 프로세스 sleep) |
| 9 | 게이트 실패 백오프 + gate-skipped 이벤트 | PL-07, §5 | `runner.ts` | 하 | L | 백오프 메타데이터 테스트 |
| 10 | REVIEW verdict 아티팩트 + `changes-requested` 게이트 + `reworkCyclesLeft` | PL-01/02 | `core/artifacts.ts`, `state-machine.ts`, `runner.ts`, `local-runtime.ts` | **상** | M | 상태머신 전수표 확장 + 무한 진동 RED 테스트 + null-agent REVIEW e2e |
| 11 | `forbidTestEditInImpl` 하드코딩 제거 | PL-17 | `local-runtime.ts` | 하 | M(의도된 실패 증가) | e2e에서 테스트 추가 시도가 차단됨 확인 |
| 12 | 세션 연속성 `(engine, sessionId)` 스레딩 | PL-03 | `runner.ts` | 중 | M | 엔진 교체 시 리셋 테스트 |
| 13 | 단계별 retry_budget/timeout override | PL-20 | `stage-config.ts`, `runner.ts` | 중 | L | additive 파싱 테스트 |

## M3 — 데몬/어댑터 신뢰성 (M2와 병행 가능)

| 항목 | finding | 난이도 | 리스크 | 검증 |
|---|---|---|---|---|
| stale `.dispatch.lock` 회수 | IO-04 | 중 | M — 살아있는 락 탈취 금지 | 진짜 git + 죽은 PID 통합 테스트 |
| 프로세스 그룹 kill + SIGKILL 에스컬레이션 | IO-05 | 중 | M | 손자 프로세스 생존 테스트 (실제 spawn) |
| `busy_timeout` + 원자 claim + lease 후 전이 | IO-07/12 | 중 | M — claim 의미 변경 | sqlite-job-store 동시성 테스트 추가 |
| 체크섬 매니페스트 worktree 영속화 | IO-08 | 중 | L | 데몬 재시작 시나리오 테스트 |
| cleanup 실행기 (데몬 tick) + 노화 sweep | IO-02/14 | 중 | M — FS 삭제 | dry-run 우선, ADR-012 GC 패턴 준용 |
| setup 타임아웃 + 락 범위 축소 | IO-17 | 하 | L | 행 setup 테스트 |
| 포트 충돌 회피 | IO-16 | 하 | L | 충돌 jobId 쌍 테스트 |
| worktree 재사용 정책 (reset 여부) | IO-15 | 중 | M — 정책 결정 필요 | 결정 후 |
| 데몬 heartbeat → `/health` | IO-10 | 하 | L | API contract 테스트 |
| API 에러 로깅/구조화 매핑/duplicate 409 | IO-20 | 하 | L | contract 테스트 |
| **ADR-014: 데몬 동시성 모델 (head-of-line 해소)** | IO-06 | **상** | **H** — 핵심 의미 변경 | full-daemon-smoke contract + soak로 회귀 검증. 마지막에 단독 진행 |

## M4 — 대시보드 ([04](./04-dashboard-redesign-plan.md) §11의 a–d)

| 단계 | 항목 | 의존 | 난이도 | 검증 |
|---|---|---|---|---|
| M4-a | 타입드 이벤트 유니온 export(PL-19/DS-11), `/jobs/:id/summary`, `/analytics/cost`, events since-cursor, 페이지네이션(IO-11/DS-06) | M2 #4–5 | 중 | API contract 테스트 (ADR-009 "응답 스키마는 테스트로 고정") |
| M4-b | App.tsx 분해 + `useDashboardData`(병렬 폴링, idle 저속) + 데모 모드 + 중복 해소(DS-12) | 없음 — M2와 병행 가능 | 중 | 기존 25개 테스트 전부 유지(리팩터 불변식), fake timer 도입(DS-14) |
| M4-c | **ADR-015** → ops 테마 + RunSummaryStrip/TaskMatrix/PhaseTimeline/ModelCostPanel/EventFeed | M4-a, M4-b | 상 | 컴포넌트 테스트 + 데모 시나리오 스냅샷 |
| M4-d | a11y 패스(DS-10) + 성능 패스(DS-13, 50잡 프로파일) + Playwright smoke 데모 모드 재작성 + CI 편입(TV-05) | M4-c | 중 | axe 기본 점검 + Profiler 예산 |

## M5 — 테스트/CI ([06](./06-testing-and-verification-strategy.md))

| 항목 | finding | 난이도 |
|---|---|---|
| nightly cron workflow (`soak:nightly` contract 모드) | TV-05 | 하 |
| `smoke:pandoctl-pack` + two-job contract를 PR CI에 | TV-05 | 하 |
| server.ts/cli 커버리지 보강 | TV-09 | 중 |
| `correctness` 카테고리 재활성 검토 | TV-04 | 중 |
| shellGateRunner 등 중복 추출 | IO-21, PL-18 | 하 |
| e2e 명명/문서화 정리 | TV-08 | 최하 |

## 산출 ADR 목록

| ADR | 내용 | 선행 마일스톤 |
|---|---|---|
| ADR-013 | 루프 계약 확장: ReviewVerdict 아티팩트, `reworkCyclesLeft`, `WorkerUsage`, pricing 설정, REVIEW 모델 분리 기본값 복원 여부 | M2 |
| ADR-014 | 데몬 동시성 모델 (batch tick → per-job refill) | M3 말 |
| ADR-015 | 대시보드 시각 언어·컴포넌트 확장 (ADR-009 갱신, #85 정식화 포함) | M4-c |
