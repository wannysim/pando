# development plan — pando 개선 계획 (2026-06)

> 작성일: 2026-06-12 · 전제: 코드베이스 전수 분석(`src/`, `dashboard/`, `tests/`, `scripts/`, `config/`) + 문서 전수 분석(ADR 001–012, 런북, 히스토리)
> 목적: "루프 엔지니어링"(AI 에이전트가 계획→구현→테스트→평가→개선을 반복해 고품질 결과에 도달하는 워크플로우)을 더 강한 피드백, 명시적 상태 전이, 더 나은 관측성, 결정적 게이트, 안전한 자동화로 끌어올리기 위한 실행 계획
> 수명: 이 폴더는 계획 문서다. 로드맵이 소화되면 `w5-operational-readiness.md`처럼 Archive 처리한다. 바인딩 결정은 여기가 아니라 ADR에만 기록한다 (`docs/README.md` 라우팅 규칙).

---

## 1. 이 문서 묶음의 목적

pando는 W5 운영 준비를 마치고 W6 큐를 거의 소진한 상태다. 그러나 전수 분석 결과,
**프로젝트가 표방하는 핵심 루프(IMPL⇄REVIEW 재작업 루프, 실패 피드백, 비용/토큰 텔레메트리)가
계약(타입·문서)에는 존재하지만 구현에는 빠져 있는 영역**이 다수 발견됐다.
이 계획은 그 간극을 우선순위화하고, 대시보드를 "루프 관제실(command center)"로
재설계하는 로드맵까지 포함한다.

## 2. 읽는 순서

| 문서 | 내용 | 이런 질문일 때 |
|---|---|---|
| [01-repository-analysis.md](./01-repository-analysis.md) | 레포 목적, 제품 비전, 워크플로우, 모듈 책임, 명령어 | "pando가 뭐고 지금 어떻게 동작하나" |
| [02-architecture-assessment.md](./02-architecture-assessment.md) | 현재 아키텍처 평가 — 강점/약점/발견사항 전체 카탈로그 (finding ID 정의) | "어디가 약한가" |
| [03-loop-engineering-improvements.md](./03-loop-engineering-improvements.md) | 루프 모델 개선 — 명시적 phase/task 모델, 게이트 전략, 피드백·재시도, 텔레메트리 | "루프를 어떻게 더 잘 모델링하나" |
| [04-dashboard-redesign-plan.md](./04-dashboard-redesign-plan.md) | 대시보드 재설계 — 레트로 SF 관제실 UI, 타입 데이터 모델, 목 데이터 전략 | "대시보드를 어디로 끌고 가나" |
| [05-implementation-roadmap.md](./05-implementation-roadmap.md) | 마일스톤 M0–M5 로드맵, 항목별 난이도/리스크/검증 | "무엇을 어떤 순서로" |
| [06-testing-and-verification-strategy.md](./06-testing-and-verification-strategy.md) | 테스트/검증 전략 — 커버리지 게이트, CI 개선, 권장 테스트 | "어떻게 검증하나" |
| [07-risk-register.md](./07-risk-register.md) | 변경이 도입하는 리스크와 완화책 | "뭐가 깨질 수 있나" |
| [08-backlog.md](./08-backlog.md) | P0/P1/P2/Future 실행 백로그 + 수용 기준 | "당장 집어들 작업" |

## 3. 최우선 권고 요약

1. **[P0] 텔레메트리 캡처 복구** — claude-code 어댑터는 `--output-format json`을 요청하고도 결과를 파싱하지 않아 `costUsd`/`sessionId`/토큰이 전부 유실되고, codex 파서는 실제 `codex exec --json` 봉투 형태(중첩 `msg`, `token_count`)와 맞지 않는다. 입출력 토큰을 `WorkerResult`에 추가하는 것이 대시보드 비용 패널의 선행 조건이다. (`02` IO-01)
2. **[P0] REVIEW⇄IMPL 재작업 루프 와이어링** — `CHANGES_REQUESTED` 이벤트는 상태머신에 정의됐지만 생산자가 0개다. REVIEW 단계는 게이트가 하나도 없어 엔진 exit 0이면 무조건 통과한다. 결정적 `review.json` verdict 아티팩트 + 게이트 + 유한 재작업 카운터를 도입한다. (`03` §3, ADR 필요)
3. **[P0] 실패 피드백 루프** — 게이트 실패 증거가 다음 시도 프롬프트에 전달되지 않아, 결정적 실패는 budget 소진까지 동일 프롬프트로 반복된다. `PromptBuildContext`에 `{attempt, lastFailure}`를 추가한다. (`03` §4)
4. **[P0] 데몬 생존성 3종** — stale `.dispatch.lock` 영구 데드락, 게이트 명령 타임아웃 부재, 워커 프로세스 트리 좀비. (`02` IO-04/PL-06/IO-05)
5. **[P1] 커버리지 게이트 정합화** — CLAUDE.md가 요구하는 core/gates/scheduler 95%는 `scripts/check-coverage.ts`에서 강제되지 않는다. 지금 추가하면 첫날부터 green이다. (`06` §2)
6. **[P1] 대시보드 데이터 계층 → UI 재설계 순서 준수** — 타입드 이벤트 유니온, 집계 엔드포인트, `App.tsx`(1,267줄) 분해를 먼저 하고, 그 위에 레트로 SF 관제실 테마를 입힌다. (`04`)

## 4. 구현 순서 (요약)

```
M0 활성 W6 큐 종결 (pandoctl publish)          ← 기존 큐 규율 존중
M1 Quick wins (안전·소규모, 즉시 가능)          ← 08-backlog P0 소형 항목
M2 루프 엔지니어링 코어 (텔레메트리 → 피드백 → REVIEW 루프)
M3 데몬/어댑터 신뢰성 (락, 좀비, 클레임 원자성, cleanup 실행기)
M4 대시보드 (데이터 계약 → 컴포넌트 분해 → 관제실 UI)
M5 테스트/CI 강화 (nightly cron, smoke in CI, 엔진 contract fixture)
```

상세는 [05-implementation-roadmap.md](./05-implementation-roadmap.md).

## 5. ADR 준수 선언

이 계획은 다음을 위반하지 않는다: SQLite 단일 저장소(ADR-001), 게이트의 LLM 출력 불신(ADR-002),
API 단일 진실원(ADR-003), MCP connector 상속(ADR-004), Vite+React SPA/REST v1(ADR-009),
결정적 base branch 해석(ADR-011), run GC 매니페스트(ADR-012).
새 결정이 필요한 항목(재작업 budget 모델, REVIEW verdict 아티팩트 계약, 대시보드 시각 언어 확장,
토큰 텔레메트리 스키마)은 본문에 **"ADR 필요"**로 표기했고, 구현 전에 새 ADR(013+)로 먼저 박제한다.
