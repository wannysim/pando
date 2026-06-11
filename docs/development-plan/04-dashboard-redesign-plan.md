# 04 — 대시보드 재설계 계획

> 작성일: 2026-06-12 · 전제: ADR-003(웹 대시보드, API 단일 진실원), ADR-009(Vite+React SPA, REST v1, Hono 정적 서빙)
> 방향: "AI 운영 관제실" — 레트로 SF / DOS 풍 시각 언어의 고대비 전술 대시보드. 저작권 자산·로고·특정 IP 직접 차용 금지.
> ADR-009는 shadcn 프리미티브를 제한적으로 채택하고 chart·복잡한 레이아웃을 W5에서 배제했다. 본 재설계는 그 범위를 넘으므로 **착수 전 ADR-015(대시보드 시각 언어·컴포넌트 확장)로 결정을 갱신**한다. (#85 Magic UI 카드가 이미 비공식적으로 확장한 상태 — 이번에 정식화)

---

## 1. 현재 대시보드 평가

- **구조**: 단일 페이지, 라우터 없음, `App.tsx` 1,267줄에 15개 컴포넌트 (DS-04). 스타일은 전역 `styles.css` 1,185줄, 디자인 토큰은 CSS 변수.
- **데이터**: 4s 순차 폴링 (DS-05). 서버 타입 직접 import로 계약 중복은 없음 (강점). 이벤트 payload는 무타입 stringly 추출 (DS-11).
- **표현**: 모던 슬레이트/블루 ops 콘솔 — 레트로 요소 없음. StageTimeline은 세로 리스트, 진행률 미터는 상태별 하드코딩 상수(DS-03, 가짜). `engine`/`model` 미표시(DS-07), 비용은 codex 한정 단계별 텍스트뿐, 토큰·누적 비용·run summary 없음.
- **품질**: App.test.tsx 25케이스로 동작 커버는 양호. Playwright smoke는 pnpm 잔재로 사망(DS-01). a11y 다수 결함(DS-10). oxlint 제외(DS-16).

결론: **갈아엎지 않는다.** 데이터 계층(타입드 이벤트, 집계 API)을 먼저 세우고, App.tsx를 분해한 뒤, 그 위에 새 시각 언어를 입힌다. 폐기 대상은 스타일과 일부 컴포넌트 구조이지 테스트·API 계약이 아니다.

## 2. 제안 제품 경험

운영자가 대시보드를 열면 3초 안에 답할 수 있어야 하는 질문:

1. **지금 무엇이 돌고 있나** — 활성 잡 N개, 각각 어느 단계, 얼마나 걸렸나
2. **루프가 건강한가** — 막힌 잡(ESCALATED/대기), 실패 패턴, 데몬 heartbeat
3. **얼마를 쓰고 있나** — 이 run의 누적 비용/토큰, 모델별 분포
4. **방금 무슨 일이 있었나** — 전 잡 통합 이벤트 피드

상호작용 원칙: 목록→상세 drill-down 유지, 모든 조작(retry/cancel/cleanup)은 기존 REST 액션 그대로. 새 화면이 아니라 **밀도와 정보 위계의 재편**이다.

## 3. 정보 구조 (IA)

```
┌─ TOP BAR ──────────────────────────────────────────────────────┐
│ PANDO//OPS  daemon:heartbeat  run-root  cost: $X.XX  ◴ clock   │
├─ FLEET (좌, 넓게) ───────────────┬─ DETAIL (우, sticky) ───────┤
│ ① Run Summary Strip              │ ⑤ 선택 잡 헤더 (상태/branch) │
│    활성/대기/터미널 카운트, 글로벌  │ ⑥ Phase Timeline (가로)      │
│    진행 게이지, 누적 비용/토큰      │    SPEC▸PLAN▸TEST▸IMPL⇄REV▸PR│
│ ② Task Matrix (병렬 작업 그리드)   │    단계별 attempt/시간/모델   │
│    잡별 행: 단계 셀, elapsed,      │ ⑦ Model/Cost 패널            │
│    진행률, 모델 뱃지, 비용          │    단계×모델×토큰×비용 표      │
│ ③ Failure/Readiness Analytics    │ ⑧ Gate Evidence 뷰어          │
│ ④ Event Feed (전 잡, tail -f 풍)  │ ⑨ Actions (retry/cancel/…)   │
└──────────────────────────────────┴──────────────────────────────┘
+ Intake(brief 폼)는 모달/별도 탭으로 강등 — 관제 화면의 상시 점유 해제
```

## 4. UI/UX 방향 — 레트로 SF 관제실

**무드**: 어두운 전술 콘솔. 모노스페이스 수치, 스캔라인 질감, 박스 드로잉 프레임, 신호등 대비의 상태색. "DOS 시대 관제 소프트웨어가 2026년에 다시 만들어졌다면"의 감각. 특정 애니메이션/메카 IP의 화면·로고·고유 명칭을 모사하지 않는다 — 일반적 장르 관습(격자, 게이지, 경고 점멸)만 차용.

**디자인 토큰** (기존 CSS 변수 체계 위에 테마로 추가 — light 테마 유지, `data-theme="ops"` 신설):

```css
:root[data-theme="ops"] {
  --bg: #050a08;            /* 깊은 흑녹 */
  --panel: #0a120e;
  --grid-line: #123524;
  --fg: #c8e6c9;            /* 인광 그린 화이트 */
  --accent: #33ff99;        /* 주 신호색 */
  --warn: #ffb000;          /* 앰버 */
  --danger: #ff4d4d;
  --info: #4dd2ff;
  --font-mono: "IBM Plex Mono", "JetBrains Mono", ui-monospace, monospace; /* OFL 라이선스 */
}
```

- **타이포**: 수치·ID·로그는 모노스페이스, 본문 라벨은 기존 Inter 유지(가독성). 전각 박스 드로잉 문자(`─ │ ┌ ┐`)로 패널 프레임 — 이미지 자산 0.
- **질감**: 스캔라인/CRT 글로우는 `linear-gradient` 오버레이 + 미세 `box-shadow`로만. `prefers-reduced-motion` 시 전부 비활성.
- **상태 언어**: RUNNING=점멸 커서(▮), DONE=고정 ●, FAILED=반전 블록, ESCALATED=앰버 점멸, DEFERRED=모래시계+카운트다운.
- **수상급이되 운영 가능**: 장식은 전부 CSS 클래스 한 겹 — 끄면 평범한 다크 대시보드가 남도록. 시인성(대비비 ≥ 4.5:1)이 장식에 우선.

## 5. 요구 능력 ↔ 데이터 가용성

| 능력 | 서버 데이터 | 필요 작업 |
|---|---|---|
| 글로벌 루프 진행 | 부분 — `/jobs` status에서 유도 가능 | `STAGE_ORDER` 인덱스 기반 유도 (클라) + run summary API |
| 활성 phase 표시 | 있음 — `JobStatus`가 곧 단계 | 렌더만 |
| phase 타임라인 | 있음 — stage 이벤트 | 가로 타임라인 컴포넌트화 |
| 단계 내 % 진행 | **없음** — stage-started~종료 사이 불투명 | 정직하게 처리: 결정 신호(attempt/k, elapsed/timeout 비율)만 표시. 가짜 % 금지 (DS-03 교훈) |
| 병렬 작업 매트릭스 | 부분 — status/startedAt 있음, "현재 활동" 없음 | Task Matrix는 가용 필드로 구성. 활동 스트림은 Future(ADR 필요 — 워커 출력 노출은 ADR-002 경계 주의) |
| 단계/태스크별 모델 | 있음 — 이벤트 payload `engine`/`model` (미렌더) | 타입드 유니온 후 렌더 (DS-07) |
| 토큰 사용량 | **없음** | IO-01 + §6 모델 — M2 의존 |
| 추정/누적 비용 | 부분(codex 한정 stage cost) | IO-01 + `GET /analytics/cost` + pricing 설정 |
| 이벤트/로그 스트림 | 있음(`/jobs/:id/events`, 미사용) + 전 잡 피드 없음 | `GET /events?since=` 커서 엔드포인트 신설 |
| run summary | 부분(`TerminalJobSummary` 미노출) | `GET /jobs/:id/summary` 신설 |

## 6. 타입드 데이터 모델

`dashboard/src/model/`에 **UI 도메인 모델**을 두고, API DTO→모델 매퍼를 단방향으로 만든다.
(API DTO는 계속 `src/api/schema.ts` 공유 — ADR-003/009 준수. 아래는 UI 전용 뷰모델.)

```typescript
// dashboard/src/model/loop.ts
export type PhaseKey = "SPEC" | "PLAN" | "TEST" | "IMPL" | "REVIEW" | "PR";
export type PhaseState = "pending" | "active" | "passed" | "failed" | "reworked" | "skipped";

export interface LoopRun {              // 잡 1개 = 루프 런 1개
  jobId: string;
  repo: string;
  title: string;
  status: JobStatus;                    // src/core/types 공유
  phases: PhaseProgress[];              // 항상 6개, STAGE_ORDER 순
  startedAt?: string;
  finishedAt?: string;
  elapsedMs: number;
  cost: CostSummary;
  worktreePath?: string;
  prUrl?: string;
}

export interface PhaseProgress {
  phase: PhaseKey;
  state: PhaseState;
  attempts: AttemptSummary[];           // attempt별 1행
  activeAttempt?: { startedAtMs: number; timeoutMs: number };  // 단계 내 "정직한 진행" 재료
}

export interface AttemptSummary {
  attempt: number;
  outcome: "passed" | "failed" | "blocking" | "canceled" | "running";
  engine?: string;
  model?: string;
  durationMs?: number;
  usage?: TokenUsage;
  costUsd?: number;
  costEstimated?: boolean;              // 실측/추정 구분 — 절대 혼용 표기 금지
  gateName?: string;
  reason?: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface CostSummary {
  totalUsd?: number;
  estimated: boolean;
  byModel: Array<{ model: string; usd?: number; usage?: TokenUsage }>;
}

export interface FeedEvent {            // 전 잡 이벤트 피드
  sequence: number;
  jobId: string;
  type: PipelineEventType;              // src/api/schema의 타입드 유니온 (PL-19 산출물)
  stage?: PhaseKey;
  at: string;
  summary: string;                      // 매퍼가 생성한 1줄 — 원본 payload는 detail에서
}
```

매퍼(`dashboard/src/model/from-api.ts`)는 순수 함수로 작성하고 단위 테스트한다 — 기존 `lib/timeline.ts`의 그룹핑 로직을 이쪽으로 흡수.

## 7. 컴포넌트 구성 (App.tsx 분해 산출물)

```
dashboard/src/
├── components/
│   ├── RunSummaryStrip.tsx      # ① 카운트/게이지/누적 비용
│   ├── TaskMatrix.tsx           # ② 병렬 작업 그리드 (행=LoopRun, 셀=PhaseProgress)
│   ├── PhaseTimeline.tsx        # ⑥ 가로 타임라인 (기존 StageTimeline 대체)
│   ├── ModelCostPanel.tsx       # ⑦ 단계×모델×토큰×비용
│   ├── EventFeed.tsx            # ④ 가상화된 tail (since-cursor 증분 페치)
│   ├── GateEvidence.tsx         # ⑧ 기존 EvidenceBlock 확장
│   ├── AnalyticsPanel.tsx ...   # 기존 이전
│   └── intake/                  # 기존 두 brief 폼 통합 (DS-12 중복 해소)
├── hooks/useDashboardData.ts    # 폴링 통합: Promise.all 병렬화, idle 30s 저속 폴링(DS-09)
├── model/  lib/format.ts        # §6 모델 + 포맷터 (formatDurationMs 등 직접 테스트)
└── theme/ops.css                # §4 토큰 — styles.css에서 테마 분리
```

## 8. 목/데모 데이터 전략

- **명시적 데모 모드만**: `VITE_PANDO_DEMO=1`일 때 `createDemoApiClient()`(실제 `PandoApiClient` 인터페이스 구현)가 주입된다. 프로덕션 코드 경로에 목 데이터가 섞이는 일은 없고, UI에 `DEMO FEED` 워터마크 뱃지를 상시 표시한다 — 가짜를 진짜처럼 보이게 하지 않는다.
- 데모 시나리오는 fixture 파일(`dashboard/src/demo/scenarios/*.ts`)로: 정상 6단계 완주, REVIEW 재작업 2회, ESCALATED, deferred-backoff, 3잡 병렬. 시나리오는 결정적 시계로 재생(시드 고정) — 스크린샷·시연·Playwright smoke 모두 이걸 사용.
- 토큰/비용처럼 서버가 아직 못 주는 필드는 데모 모드에서만 채워진다. 실 모드에서는 "—"로 정직하게 비운다 (M2 완료 시 자연 해소).

## 9. 접근성·반응형

- 모든 상태 전달은 색+형태+텍스트 3중화 (점멸·색상 단독 금지). `prefers-reduced-motion` 전면 존중.
- DS-10 해소를 재설계에 포함: tablist 키보드 내비, 진행 표시는 `role="progressbar"`+`aria-valuenow`, 에러 배너 `role="alert"`, EventFeed는 `aria-live="polite"`(과다 발화 방지를 위해 배치 갱신), 타임스탬프는 로캘 포맷+`<time datetime>`.
- 반응형: 기존 1180/860/680px 브레이크포인트 유지. 모바일(Tailscale 접속 시나리오)에서는 Task Matrix가 카드 리스트로 강등, Detail이 전면 시트로.

## 10. 렌더링·애니메이션 성능

- **폴링 → 증분**: EventFeed는 `?since=<sequence>` 커서로 증분만 수신, 리스트는 가상화(고정 행높이 단순 windowing — 외부 라이브러리 불필요). 전체 상태 객체 교체 대신 jobId 키 기반 병합으로 행 단위 `memo` 유지 (DS-13).
- SSE는 Future로 보류 — 폴링 최적화로 충분한지 먼저 계측 (ADR-009의 "필요 증명 후 확장" 원칙).
- 장식 애니메이션은 `transform`/`opacity`만 사용(컴포지터 한정), 점멸은 CSS animation 공유 — JS 타이머로 깜빡이지 않는다. `new Date()` 직접 호출 대신 1s 단일 ticker context로 elapsed 갱신.
- 성능 예산: 50 잡 × 6 단계 매트릭스에서 폴링 tick당 리렌더 < 16ms (React Profiler로 검증 항목화).

## 11. 마일스톤 (상세는 [05](./05-implementation-roadmap.md) M4)

```
M4-a 데이터 계약: 타입드 이벤트 유니온 export, /jobs/:id/summary, /analytics/cost,
      events since-cursor, 페이지네이션          ← M2(IO-01) 후
M4-b App.tsx 분해 + useDashboardData + 데모 모드 (시각 변화 없음 — 순수 리팩터)
M4-c ops 테마 + RunSummaryStrip/TaskMatrix/PhaseTimeline/ModelCostPanel/EventFeed
M4-d a11y/성능 패스 + Playwright smoke를 데모 모드 기반으로 재작성 + CI 편입
```
