# 06 — 테스트·검증 전략

> 작성일: 2026-06-12 · 기준: `docs/engineering-standards.md`(피라미드 80/15/5, DAMP, Beyoncé Rule, 진짜 git, contract test)

---

## 1. 현재 검증 워크플로우

```
bun run verify
├── verify:core
│   ├── coverage = bun test tests dashboard/src --coverage → scripts/check-coverage.ts (전역 85%)
│   ├── lint     = oxlint .
│   └── types    = tsc --noEmit   (include: src, tests)
└── bun --filter=@pando/dashboard run verify  (test:ci + types + build)
```

- 테스트 분포: unit 52 / integration 4 / e2e 2 (+dashboard 2) ≈ **88/7/5** — integration이 목표(15%) 대비 과소.
- pre-commit은 oxfmt(포맷)만. lint/types/test는 CI에서만 자동 강제.
- CI(`ci.yml`): verify → `benchmark:self` → step summary + PR 코멘트. 로컬/CI 동일 명령 (Shift Left 준수).
- 실측 커버리지: core 95.8% / pipeline 99.6% / scheduler 100% — 우수. **약점: `src/server.ts` 61%, `src/cli` 84.4%** (전역 집계에 가려짐).

## 2. 커버리지 게이트 정합화 (TV-01 — M1 최우선)

`scripts/check-coverage.ts`에 경로 prefix별 임계치 추가:

```typescript
const PATH_THRESHOLDS = [
  { prefix: "src/core/",           lines: 95, functions: 95 },
  { prefix: "src/pipeline/gates/", lines: 95, functions: 95 },
  { prefix: "src/scheduler/",      lines: 95, functions: 95 },
];
```

현재 전부 통과 수준이므로 도입 비용 0. CLAUDE.md 규칙 2와 도구가 비로소 일치한다.
주의: bun lcov는 테스트가 로드한 파일만 기록 — 미로드 파일은 보이지 않는다. `scripts/` 4종 래퍼가 대표적 사각지대 (TV-03과 함께 해소).

## 3. 갭과 권장 테스트

### 3.1 단위 (순수 계층)

- **상태머신**: `CHANGES_REQUESTED`→`GATE_PASS` budget 리셋 상호작용(무한 진동의 RED 테스트 — M2 #10 선행), `transition(budget=0)`, `reworkCyclesLeft` 도입 시 전수표 확장.
- **retry-policy**: 적대적 errorCode(`"author_validation"`, `"e1401"`) 분류 테스트 — PL-10 수정의 RED.
- **artifacts**: 단락형 `[Blocker]`(PL-15), H1이 본문 중간에 있는 케이스, 섹션 substring 오매칭.
- **runner**: 멀티 게이트 순서(실패 후 게이트 미실행), 게이트 행 타임아웃, 2회차 프롬프트 피드백 포함, deferred 결과 표현.
- **cost.ts(신설)**: 가격표 조회, 실측 vs 추정 플래그, 미상 모델 처리 — 텔레메트리/비용 계산은 전부 순수 함수로 두고 여기서 검증.

### 3.2 통합 (과소 영역 보강)

- **엔진 contract suite** (TV-07, 가장 중요): `tests/unit/engines/engine-contract.ts` 공유 스위트를 fake/claude/codex 3자가 통과. **실제 CLI 출력 fixture**(`tests/fixtures/engine-output/claude-result.json`, `codex-exec-stream.jsonl` — 실 실행 캡처를 새니타이즈)를 파서에 재생. IO-01이 침묵한 근본 원인이 fixture 부재였다 — 이것이 본 전략의 Beyoncé Rule 1순위.
- **sqlite-job-store**: 교차 커넥션 경합(busy_timeout), 이중 claim 시도, `ensureColumn` 멱등성(구버전 DB fixture), 손상 payload_json 행.
- **worktree-manager**: stale lock 회수(죽은 PID), setup 타임아웃, dirty 재사용.
- **daemon**: 재시작-중도-잡 크래시 복구 시나리오(IO-08 체크섬 매니페스트 영속화 검증 포함), cancel-stop-failed 반복 cap.

### 3.3 대시보드

- 모델 매퍼(`model/from-api.ts`) 순수 함수 단위 테스트 — timeline.ts 흡수분 포함.
- 폴링 훅: fake timer 기반(현 4.6s 실 sleep 제거, DS-14), idle 저속 폴링, 실패 시 에러 상태.
- 데모 모드 시나리오 재생 스냅샷(결정적 시계).
- Playwright smoke를 데모 모드로 재작성 후 **CI 편입** (현재 어느 게이트에도 없음).
- a11y: 핵심 화면 axe 기본 점검을 컴포넌트 테스트에 포함.

### 3.4 결정적 게이트 테스트

- null-agent 확장: REVIEW verdict 미작성 엔진이 실패하는 e2e (M2 #10과 동시).
- gate-skipped vs gate-passed 이벤트 구분 테스트.
- diff-rules를 release 브랜치(base override/fixVersion) 기준으로 — PL-05의 RED.
- `requiredGates` 누락 시 기동 실패 테스트.

### 3.5 텔레메트리/비용 계산 테스트

- `worker-cost` payload 확장 shape 고정 (API contract 테스트 — ADR-009 "응답 스키마는 테스트로 고정" 원칙을 이벤트 payload까지 확대).
- `/jobs/:id/summary`·`/analytics/cost` 집계 정확성: 알려진 이벤트 fixture → 기대 합계.
- 추정 비용에 `estimated: true`가 끝까지 전파되는지 (UI 표기 혼용 방지).

## 4. `bun run verify` 사용 지침

- 코드 변경이 있는 모든 커밋 전 실행 (CLAUDE.md 규칙 2). 문서-only 변경은 대상 아님.
- M1의 TV-06 적용 후: dashboard 테스트 1회만 실행되도록 중복 제거 — verify 시간 단축.
- 신규 게이트(per-dir 커버리지) 도입 후 실패 메시지는 경로별로 분리 출력해 어디가 떨어졌는지 즉시 보이게.

## 5. CI 개선 (TV-05)

| 추가 | 내용 |
|---|---|
| nightly cron | `schedule:`로 `soak:nightly`(contract 모드, 결정적) + 증거 artifact 업로드. "nightly"가 실제로 nightly가 되게 |
| PR CI 확장 | `build:pandoctl && smoke:pandoctl-pack`(릴리즈 날 발견 방지), two-job-smoke contract 모드, Playwright smoke(데모 모드, chromium만) |
| 포맷 게이트 | `oxfmt --check`를 CI에 — pre-commit은 우회 가능 |
| 게이트 유지 | live smoke(자격증명 필요)는 계속 수동 — CI에 비밀키를 들이지 않는 현 원칙 유지 |
