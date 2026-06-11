# 03 — 루프 엔지니어링 개선

> 작성일: 2026-06-12 · finding ID는 [02-architecture-assessment.md](./02-architecture-assessment.md) 참조
> "루프 엔지니어링" = AI 에이전트가 계획→구현→테스트→평가→개선을 반복해 고품질 결과에 도달하는 워크플로우. pando의 존재 이유이며, 이 문서가 본 계획의 심장이다.

---

## 1. 현재 루프 지원 현황

pando는 루프의 **골격**을 이미 갖췄다:

- 단계 상태머신 + 단계별 retry budget (`core/state-machine.ts`)
- 결정적 게이트 7종 (exit-code, artifact-schema, checksum, diff-rules, pr-draft, draft-pr, brief-intake)
- 단계 멱등성 + SQLite 재개 (크래시 복구 = 단계 단위 재실행)
- provider 실패 분류 → 백오프 → `deferredUntil` 스케줄러 연동
- 이벤트 스트림 텔레메트리 (`stage-started/completed/failed`, `worker-cost`)

그러나 루프를 루프이게 만드는 **세 가지 피드백 채널이 전부 끊겨 있다**:

| 채널 | 상태 | finding |
|---|---|---|
| **평가→재작업** (REVIEW가 IMPL로 되돌리기) | dead code — `CHANGES_REQUESTED` 생산자 0, REVIEW 게이트 0 | PL-01 |
| **실패→다음 시도** (게이트 증거가 프롬프트로) | 미구현 — budget 소진까지 동일 프롬프트 반복 | PL-04 |
| **세션 연속성** (단계 간 컨텍스트) | 계약만 존재 — 매 단계 cold start | PL-03 |
| **비용 신호** (토큰/비용 관측) | 캡처 자체가 깨짐 | IO-01 |

즉 현재의 "루프"는 사실상 **동일 입력 재시도기**다. 아래 §2–§7이 이를 진짜 개선 루프로 바꾼다.

## 2. 명시적 phase/task 모델 (권장)

현재 암묵적인 것들을 데이터로 승격한다. 전부 순수 계층 additive 변경:

```typescript
// core/state-machine.ts 확장 (ADR-013 필요 — MachineState는 core 계약)
export interface MachineState {
  status: JobStatus;
  attemptsLeft: number;        // 단계 내 재시도 (기존)
  reworkCyclesLeft: number;    // REVIEW→IMPL 재작업 사이클 (신규, GATE_PASS에 리셋되지 않음)
}

// runner가 매 시도에 들고 다니는 컨텍스트 (PL-04, PL-14)
export interface AttemptContext {
  attempt: number;             // 1-based, 현재 stage 내
  maxAttempts: number;
  lastFailure?: StageFailure;  // {stage, gateName, reason, evidence(truncated)}
}
```

규칙:

- `attempt`/`maxAttempts`를 모든 stage 이벤트 payload에 포함 (PL-14).
- 터미널 이벤트 `job-done | job-failed | job-escalated | job-canceled` 신설 — analytics가 `state-change` payload를 뒤지지 않게.
- `PipelineRunResult`에 `deferred?: {untilMs}` 추가 (PL-12).
- 취소는 `stage-canceled`로 분리, 실패 집계에서 제외 (PL-11, IO-09).

## 3. REVIEW⇄IMPL 재작업 루프 (PL-01/02) — **ADR-013 제안**

ADR-002의 원칙(게이트는 LLM 텍스트 불신)을 지키면서 REVIEW 판정을 결정화한다:

1. **verdict 아티팩트 계약**: REVIEW 워커는 `review.json`을 작성해야 통과한다.
   ```typescript
   // core/artifacts.ts에 스키마 추가
   interface ReviewVerdict {
     schemaVersion: 1;
     verdict: "approve" | "changes-requested";
     findings: Array<{ file: string; reason: string; severity: "blocker" | "major" | "minor" }>;
   }
   ```
   판정에 쓰는 것은 **파일 존재 + JSON 스키마 + verdict 필드**뿐 — `pr.json`(draft-pr 게이트)과 동일한 패턴. LLM의 산문은 여전히 신뢰하지 않는다. findings는 IMPL 재시도 프롬프트의 피드백 재료(§4)로만 쓴다.
2. **게이트 연결**: `GateResult.failureKind`에 `"changes-requested"` 추가 → runner가 REVIEW 단계에서만 이를 `CHANGES_REQUESTED` 이벤트로 매핑 (BLOCKING_QUESTIONS가 SPEC/PLAN에서만 동작하는 것과 대칭).
3. **유한성 보장**: `reworkCyclesLeft`(기본 2~3, stages.yaml 설정)를 `CHANGES_REQUESTED`가 차감하고 `GATE_PASS`는 리셋하지 않는다. 소진 시 `FAILED`. 이것 없이는 자율 데몬의 비용이 무한 (PL-02).
4. **모델 분리 유지**: REVIEW는 IMPL과 다른 engine/model 강제(ADR-002). 현재 전 단계 codex/gpt-5.5 기본값은 이 규칙과 잠재 긴장 — stages.yaml에서 review를 다른 모델로 되돌리는 것을 ADR-013에서 함께 결정.
5. **null-agent 확장**: 아무것도 안 하는 REVIEW 엔진(verdict 파일 미작성)이 게이트에서 떨어지는 e2e 추가.

## 4. 실패 피드백·재시도 전략 (PL-04/07, PL-03)

```typescript
// pipeline/runner.ts
export interface PromptBuildContext {
  item: WorkItem;
  profile: RepoProfile;
  worktree: string;
  attempt: number;             // 신규
  lastFailure?: StageFailure;  // 신규 — 직전 시도의 게이트/엔진 실패 증거 (truncate된)
  reviewFindings?: ReviewVerdict["findings"]; // 신규 — CHANGES_REQUESTED로 IMPL 재진입 시
}
```

- **buildPrompt가 실패를 안다**: 2회차 시도 프롬프트에 "직전 시도는 `lint-exit-code` 게이트에서 exit 1 — 증거: ..." 가 들어간다. 결정적 실패의 반복 확률이 구조적으로 줄어든다.
- **게이트 실패에도 백오프** (PL-07): 엔진 실패만 `decideRetry`를 타는 현 구조를 게이트 실패에도 적용하되, 게이트 실패는 결정적이므로 짧은 고정 지연(예: transient 2s급)이면 충분. 목적은 rate 보호가 아니라 연속 LLM 호출 폭주 방지.
- **세션 연속성** (PL-03): `result.sessionId`를 루프 로컬에 보관, 같은 engine이 연속될 때만 다음 `run()`에 전달. engine이 바뀌면(REVIEW 모델 분리) 리셋. claude/codex 세션은 호환되지 않으므로 `(engine, sessionId)` 쌍으로 관리.
- **단계별 budget/timeout** (PL-20): `stages.yaml`의 각 단계에 `retry_budget`/`timeout_minutes` override 허용. IMPL은 길게, SPEC은 짧게.

## 5. 결정적 게이트 전략 강화

| 항목 | 현재 | 개선 |
|---|---|---|
| 게이트 타임아웃 (PL-06) | 없음 — 멈춘 테스트가 잡 영구 정지 | `GateCommandRunner`에 `timeoutMs`+`signal`. 타임아웃 = 결정적 gate-fail (`reason: "gate timed out after Nms"`) |
| 게이트 부재 = 통과 (PL-01 뿌리) | `gates?.[stage] ?? []` — 와이어링 누락이 침묵 무검증 | **최소 게이트 선언**: stage 정의에 `requiredGates: string[]`, runner가 누락 시 기동 시점에 throw. "검증 없는 단계"는 명시적 opt-out으로만 |
| 게이트 의존 순서 암묵 (pr-draft←draft-pr) | 배열 순서 관습 | 게이트에 `produces?/requires?: string[]` (아티팩트 이름) 선언, 조립 시점 위상 검증 |
| 미설정 action = 통과 (`exit-code.ts:42-47`) | evidence 텍스트로만 구분 | `gate-skipped` 이벤트 분리 발화 — "실행돼서 통과"와 "부재로 통과"를 텔레메트리에서 구분 |
| `forbidTestEditInImpl` 무력화 (PL-17) | `local-runtime.ts:149` 하드코딩 false | profile guard 존중으로 복원. checksum이 추가 파일을 못 보므로 diff-rules가 유일한 방어선임을 테스트로 박제 |
| base ref 오판 (PL-05) | `origin/${profile.baseBranch}` | `resolveBaseBranch` 사용 — draft-pr와 단일화 |
| `[Blocker]` 단락 미탐 (PL-15) | 리스트 항목만 스캔 | Open Questions 섹션 본문 전체 스캔 |
| 아티팩트 오염 (PL-16) | `git add -A` | 파이프라인 아티팩트(`pr.json`, `_spec.md`, `PLAN.md`, `review.json`, `.pando/`) 제외 목록 |

## 6. 텔레메트리 모델 (IO-01 — 모든 관측성 작업의 선행 조건)

### 6.1 캡처 (엔진 어댑터)

```typescript
// core/types.ts — WorkerResult 확장 (ADR-013에 포함)
export interface WorkerUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;        // 엔진이 합계만 줄 때
}
export interface WorkerResult {
  ok: boolean;
  sessionId?: string;
  costUsd?: number;            // 엔진이 직접 보고하는 USD (claude total_cost_usd)
  usage?: WorkerUsage;         // 신규
  model?: string;              // 실제 사용 모델 (요청 모델과 다를 수 있음)
  errorCode?: string;
  output: string;
}
```

- **claude-code**: `-p --output-format json`의 최종 JSON 문서를 파싱해 `total_cost_usd`, `session_id`, `usage.{input_tokens,output_tokens,cache_read_input_tokens}` 추출. 파싱 실패 시 기존 동작(원문 output)으로 폴백 — 절대 침묵 실패하지 않고 `telemetry-parse-failed` evidence를 남김.
- **codex**: 실제 `codex exec --json` 봉투(중첩 `msg.type`, `token_count` 이벤트)에 맞게 파서 재작성. **실제 CLI 출력을 fixture로 박제한 contract test가 선행** (TV-07) — 이번에 파서가 깨진 채 침묵한 근본 원인이 fixture 부재였다.
- `worker-cost` 이벤트 payload 확장: `{costUsd?, usage?, engine, model, stage, attempt}`.

### 6.2 가격/비용 산정 (CF-04 — ADR 필요)

- 가격은 **설정으로만** — 하드코딩 금지. `config/pricing.yaml`(또는 orchestrator.yaml 섹션):
  ```yaml
  pricing:
    schemaVersion: 1
    models:
      gpt-5.5:        { input_per_mtok: 0.0, output_per_mtok: 0.0 }  # 예시값 — 커밋 전 실측
      claude-opus-4-8: { input_per_mtok: 0.0, output_per_mtok: 0.0 }
  ```
- 우선순위: 엔진이 보고한 `costUsd` > `usage × pricing` 추정(`estimated: true` 플래그) > 미상. 추정과 실측을 절대 섞어 표기하지 않는다.
- 비용 계산은 순수 함수 `core/cost.ts`(신규)로 — 단위 테스트 대상.
- (후속, ADR) per-job/per-day 비용 캡: 누적 `worker-cost` 합이 캡 초과 시 결정적 escalate. 자율 데몬의 지출 안전장치.

### 6.3 저장·노출

- ADR-001 존중: 새 테이블 없이 `events.payload_json` 유지. 집계는 SQL(`json_extract`)로.
- 신규 API (대시보드 선행 데이터):
  - `GET /jobs/:id/summary` — 단계별 attempt 수·duration·cost·usage 합산, 터미널 사유, PR URL.
  - `GET /analytics/cost?since=` — 잡/모델/일자별 비용·토큰 집계.
  - `GET /jobs?limit=&offset=`, `GET /jobs/:id/events?since=<sequence>&limit=` (IO-11/DS-06).
- 이벤트 payload 타입드 유니온을 `src/api/schema.ts`로 export (PL-19/DS-11) — 대시보드가 stringly 추출을 중단.

## 7. 신뢰성 개선 (루프가 멈추지 않게)

| 항목 | finding | 처방 |
|---|---|---|
| stale lock 데드락 | IO-04 | `.dispatch.lock`에 쓴 PID를 읽어 ESRCH+mtime 노화 시 안전 회수 (pando-gc의 PID 판정 로직 재사용) |
| 좀비 프로세스 | IO-05 | detached spawn + 프로세스 그룹 kill + SIGTERM→SIGKILL 에스컬레이션 (두 엔진 공통, two-job-smoke 라이브 프로브에도 적용) |
| claim 원자성 | IO-07/12 | `busy_timeout` pragma + lease 확보 후 상태 전이. 단일 데몬 가정은 런북에 명문화 |
| 체크섬 매니페스트 휘발 | IO-08 | worktree 아티팩트로 영속화. TEST 완료 흔적이 있는데 매니페스트가 없으면 **통과가 아니라 실패** |
| cleanup 미실행 | IO-02/03/14 | 데몬 tick에 cleanup 실행기(취소 처리와 동형) + agentctl 프로필 해석 수정 + 노화 sweep |
| head-of-line blocking | IO-06 | per-job detached promise + 슬롯 refill. **데몬 동시성 의미가 바뀌므로 ADR-014로 결정 후 진행** |
| 데몬 heartbeat | IO-10 | last-tick 시각/에러 카운터를 store 또는 인메모리로 API에 주입 — `/health`가 진실을 말하게 |

## 8. 권장 도입 순서

```
1. 텔레메트리 캡처 복구 (IO-01 + TV-07 fixture)   ← 모든 관측·비용 작업의 토대
2. 실패 피드백 (PL-04) + attempt 이벤트 (PL-14)    ← 즉시 성공률 개선, 순수 additive
3. 게이트 견고화 (PL-05/06/15/16/17 + gate-skipped) ← 전부 소형 독립 PR
4. ADR-013: REVIEW verdict + reworkCyclesLeft + WorkerUsage + pricing 스키마
5. REVIEW 루프 구현 (PL-01/02) + null-agent 확장
6. 세션 연속성 (PL-03), 단계별 budget/timeout (PL-20)
7. ADR-014: 데몬 동시성 모델 (IO-06) — 마지막. 가장 침습적
```
