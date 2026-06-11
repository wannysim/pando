# 08 — 실행 백로그

> 작성일: 2026-06-12 · finding ID는 [02](./02-architecture-assessment.md), 마일스톤은 [05](./05-implementation-roadmap.md)
> 규칙: 전 항목 TDD(RED 먼저), 커밋 ~100라인 atomic, develop 기점 topic branch + squash-merge PR, 커밋 전 `bun run verify`.

---

## P0 — 즉시 (안전성·정직성·선행 조건)

- [ ] **B-01 (M0)** `pandoctl@0.1.0` npm publish — release workflow dry-run → publish → global install/update smoke. 수용: docs/README.md W6 큐 체크, `pandoctl-release.md` 런북에 증거 기록.
- [ ] **B-02 (M1, TV-01)** `check-coverage.ts`에 경로별 95% 임계치 추가. 수용: `src/core`/`src/pipeline/gates`/`src/scheduler` 미달 시 verify 실패, 경로별 수치 출력, 현 상태 green.
- [ ] **B-03 (M2, TV-07+IO-01)** 실제 CLI 출력 fixture 캡처(새니타이즈) + 공유 엔진 contract suite. 수용: 현 codex 파서가 실 스트림 fixture에서 cost/session 추출에 실패하는 RED가 먼저 존재, fake/claude/codex 3자가 동일 suite 통과.
- [ ] **B-04 (M2, IO-01)** claude-code 결과 JSON 파싱: `total_cost_usd`/`session_id`/`usage` → `WorkerResult`. 수용: claude 단계에서 `worker-cost` 이벤트 발화, 파싱 실패 시 폴백+`telemetry-parse-failed` 증거.
- [ ] **B-05 (M2, IO-01)** codex 스트림 파서 재작성(중첩 봉투·`token_count`) + truncate-before-append 버그 수정. 수용: B-03 fixture green.
- [ ] **B-06 (M2, PL-04)** 실패 피드백: `PromptBuildContext{attempt, lastFailure}`. 수용: 게이트 실패 후 2회차 프롬프트에 `{gateName, reason, truncated evidence}` 포함이 테스트로 고정.
- [ ] **B-07 (M2, PL-06)** 게이트 명령 타임아웃 port. 수용: 행 걸린 명령이 `timeoutMs` 후 결정적 gate-fail, 스케줄러 lease 해제.
- [ ] **B-08 (M3, IO-04)** stale `.dispatch.lock` 안전 회수. 수용: 죽은 PID 락은 회수, 살아있는 PID/EPERM 락은 보존 — 진짜 git 통합 테스트.
- [ ] **B-09 (M3, IO-05)** 워커 프로세스 그룹 kill + SIGTERM→SIGKILL 에스컬레이션 (양 엔진 + two-job live 프로브). 수용: 손자 프로세스 잔존 0 테스트.
- [ ] **B-10 (M1, PL-05)** diff-rules 기본 base ref를 `resolveBaseBranch`로. 수용: baseBranch override/fixVersion 케이스 테스트.
- [ ] **B-11 (M1, PL-15)** `[Blocker]` 단락 스캔. 수용: 비리스트 blocker가 ESCALATED 유발.
- [ ] **B-12 (M1, DS-01)** Playwright webServer `bun run dev`. 수용: `bun run smoke` 로컬 통과.
- [ ] **B-13 (M1, DS-02/08)** BriefSubmitPanel try/catch + analytics 에러 분기. 수용: 거부 시 에러 표면화 테스트, 스켈레톤 영구 표시 제거.

## P1 — 다음 (루프 완성·신뢰성·대시보드 데이터)

- [ ] **B-14 (M2)** **ADR-013 작성**: ReviewVerdict 계약, `reworkCyclesLeft`, `WorkerUsage`, pricing 설정 스키마, REVIEW 모델 분리 기본값. 수용: ADR 승인 후 하위 작업 착수.
- [ ] **B-15 (M2, PL-01/02)** REVIEW verdict 아티팩트 + `changes-requested` failureKind + `CHANGES_REQUESTED` 와이어링 + 유한 rework 카운터. 수용: 상태머신 전수표 확장(진동 종결 포함), null-agent REVIEW e2e, REVIEW 게이트가 local-runtime에 와이어링.
- [ ] **B-16 (M2, PL-17)** `forbidTestEditInImpl` 하드코딩 제거 — profile guard 존중. 수용: IMPL의 테스트 파일 추가/수정이 diff-rules에서 차단되는 e2e.
- [ ] **B-17 (M2, CF-04)** `core/cost.ts` + pricing 설정 + 추정/실측 플래그. 수용: 가격 하드코딩 0, 순수 함수 단위 테스트.
- [ ] **B-18 (M2, PL-11/12/14 + IO-09)** 텔레메트리 정밀화: attempt payload, 터미널 잡 이벤트, `deferred` 결과, `stage-canceled` 분리, claude 취소≠timeout. 수용: 이벤트 shape 테스트 + failure-analytics가 취소를 실패로 집계하지 않음.
- [ ] **B-19 (M3, IO-07/12)** `busy_timeout` + 원자 claim + lease 확보 후 전이. 수용: 교차 커넥션 이중 claim 불가 테스트.
- [ ] **B-20 (M3, IO-08)** TEST 체크섬 매니페스트 worktree 영속화. 수용: 데몬 재시작 후 IMPL checksum 게이트가 통과 아닌 검증 수행, 매니페스트 부재+TEST 완료 흔적 시 fail.
- [ ] **B-21 (M3, IO-02/03/14)** cleanup 실행기(데몬 tick) + agentctl 프로필 해석 수정 + 노화 sweep. 수용: API cleanup 요청이 실제 worktree 제거로 이어짐, dry-run 우선, 경로 가드.
- [ ] **B-22 (M4-a, PL-19/DS-11)** 타입드 이벤트 payload 유니온을 `api/schema.ts`로 export, 대시보드 stringly 추출 제거. 수용: `numberFrom(group, "costUsd")`류 호출 0.
- [ ] **B-23 (M4-a, IO-11/DS-06)** `GET /jobs/:id/summary`, `GET /analytics/cost`, `?limit/since` 페이지네이션·커서. 수용: API contract 테스트로 스키마 고정, `/analytics` 전체 스캔 제거.
- [ ] **B-24 (M4-b, DS-04)** App.tsx 분해 + `useDashboardData`(병렬 폴링, idle 30s 저속) + 데모 모드 + brief 폼 통합. 수용: 기존 테스트 전부 green(동작 불변), fake timer 도입.
- [ ] **B-25 (M1, CF-01/02/03)** 설정 로더 strict-key(미지 키 거부 또는 경고) + `pr.prompt` 처리 방침 결정 + `intake:` 파싱. 수용: stages.yaml의 효력 없는 키가 에러/경고로 표면화.
- [ ] **B-26 (M1, TV-02/DS-16)** oxlint 경계 보강(비접두 builtin, npm I/O 패키지, `**/git/*`) + dashboard lint 편입. 수용: 순수 계층에 `"fs"` import 시 lint 실패.
- [ ] **B-27 (M5, TV-05)** nightly cron(soak contract) + pandoctl-pack smoke·two-job contract·Playwright smoke CI 편입 + `oxfmt --check`.

## P2 — 이후

- [ ] **B-28 (M2, PL-03)** 세션 연속성 `(engine, sessionId)` 스레딩 — ADR-013의 정책 결정 후.
- [ ] **B-29 (M2, PL-20)** 단계별 retry_budget/timeout override.
- [ ] **B-30 (M2, PL-07)** 게이트 실패 백오프 + `gate-skipped` 이벤트 + `requiredGates` 선언.
- [ ] **B-31 (M2, PL-10)** errorCode canonical enum + 정확 매칭(substring fallback).
- [ ] **B-32 (M1, PL-08/16/22)** ZERO_CLOCK 제거, draft-pr 아티팩트 제외 목록, evidence truncate.
- [ ] **B-33 (M3, IO-10/20)** 데몬 heartbeat → `/health`, API 에러 로깅·구조화 매핑·duplicate 409.
- [ ] **B-34 (M3, IO-13/16/17)** pandoctl ops의 run-root DB 자동 해석, 포트 충돌 회피, setup 타임아웃+락 축소.
- [ ] **B-35 (M4-c)** **ADR-015 작성** → ops 테마 + RunSummaryStrip/TaskMatrix/PhaseTimeline/ModelCostPanel/EventFeed. 수용: [04 §5](./04-dashboard-redesign-plan.md) 능력 표의 "있음" 항목 전부 렌더, 가짜 진행률 0, `DEMO FEED` 워터마크.
- [ ] **B-36 (M4-d, DS-10/13)** a11y 패스 + 성능 패스(50잡 매트릭스 tick < 16ms) + Playwright smoke 데모 모드 재작성.
- [ ] **B-37 (M5, IO-21/PL-18)** 중복 추출(shellGateRunner/branchSlug/removeUndefined/brief 조립) + provider→engine rename + pr-draft/draft-pr 파일명 정리.
- [ ] **B-38 (M5, TV-09)** server.ts(61%)·cli(84%) 커버리지 보강.
- [ ] **B-39 (M3, IO-15)** worktree 재사용 정책(재시도 시 reset 여부) 결정 + 구현.

## Future (필요 증명 후 / 별도 ADR)

- [ ] **B-40 (IO-06)** **ADR-014**: 데몬 동시성 모델 — batch tick → per-job refill. 가장 침습적, M3 마지막 단독 진행.
- [ ] **B-41 (CF-04 후속)** per-job/per-day 비용 캡 게이트 — 누적 `worker-cost` 초과 시 결정적 escalate.
- [ ] **B-42** SSE/실시간 push — 폴링 최적화(B-23/24) 계측 후 필요 증명 시.
- [ ] **B-43 (PL-13)** legacy 이벤트 어휘(`stage-pass` 등) 폐기 — 소비자 감사 + 1릴리즈 병행 후.
- [ ] **B-44** 워커 "현재 활동" 스트림 노출 — ADR-002 경계(게이트 판정 비사용) 안에서 관측 전용 채널 설계.
- [ ] **B-45 (PL-21)** stage skill 스레딩 또는 삭제 — prompts/ vs `.ai-skills` 경계(repo-structure §7-1) 결정과 함께.
- [ ] 기존 유보 항목 (W6 규율): notifications, GitHub Issue/Jira write-back, 공개 auth, Docker egress, split containers, TUI — 본 계획 범위 밖 유지.
