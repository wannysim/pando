# 02 — 아키텍처 평가

> 작성일: 2026-06-12 · 이 문서가 finding ID(PL-/IO-/DS-/TV-/CF-)의 정의 원천이다. 다른 문서는 ID로만 참조한다.
> file:line은 분석 시점 기준이며 코드 변경에 따라 어긋날 수 있다 — 심볼 이름으로 재탐색할 것.

---

## 1. 현재 아키텍처

```
                       ┌──────────────────────────────────────────────┐
 intake (brief/jira) → │ SQLite (jobs/events/repos) ── 단일 진실원      │ ← agentctl(직접 DB 일부)
                       └──────────────┬───────────────────────────────┘
                                      │ claimNextRunnable (deferredUntil 존중)
                  daemon tick ────────┤
                  (runDaemonOnce)     │ scheduler 3계층 세마포어 (global/repo/provider)
                                      ▼
                       worktree provisioner (origin ref 분기 + 격리 env)
                                      ▼
                       pipeline runner (순수) ── state-machine ── gates(순수+port)
                                      │ engines port (claude-code / codex spawn)
                                      ▼
                       PipelineRunEvent → persistence hook → events 테이블
                                      ▼
                       Hono API (/jobs /analytics ...) ← dashboard SPA (4s 폴링) / pandoctl
```

순수 계층(`core/pipeline/scheduler`)은 port 인터페이스(`GateCommandRunner`, `TextFileReader`,
`FileProbe`, `PipelineClock`, `WorkerEngine`)로 I/O를 주입받고 oxlint가 경계를 (부분적으로) 강제한다.

## 2. 강점

- **순수 계층 규율이 실제로 지켜진다**: core/pipeline/scheduler는 `yaml`과 `node:path`만 import. 테스트 커버리지 95.8–100%.
- **게이트의 LLM 출력 차단이 타입 수준에서 성립**: `GateContext`에 `WorkerResult.output`이 없다 (ADR-002 Hyrum's Law 방어).
- **상태머신 전수 테스트**: 모든 단계 × 모든 이벤트 × 터미널 거부 매트릭스, 순수성 검증 포함.
- **worktree는 진짜 git으로 테스트** (임시 bare repo), DB는 진짜 SQLite로 테스트 — 모킹 금지 규율 준수.
- **증거 기반 운영 문화**: smoke/soak/benchmark가 schemaVersion 있는 JSON 증거를 남기고, readiness는 비밀값이 아닌 presence boolean만 기록.
- **타입 계약 공유**: 대시보드가 `src/api/schema.ts`·`src/core/types.ts`를 직접 import — 계약 중복 없음.
- **결정적 base-branch resolver**(ADR-011), run-GC 플래너(ADR-012) 같은 "순수 함수 + 어댑터" 분리가 일관됨.

## 3. 발견사항 카탈로그

리스크: H(높음)/M(중간)/L(낮음). "즉시"=기존 테스트를 깨지 않고 작은 PR로 가능.

### 3.1 순수 계층 (PL)

| ID | 위치 | 문제 | 근본 원인 → 제안 | 리스크 | 즉시 |
|---|---|---|---|---|---|
| PL-01 | `state-machine.ts:80`, `runner.ts:118-124` | `CHANGES_REQUESTED` 생산자 0개 — REVIEW⇄IMPL 재작업 루프가 dead code. REVIEW는 게이트도 없어(`local-runtime.ts:147-176`) 엔진 exit 0이면 통과 | `GateResult.failureKind`에 `"changes-requested"` 없음 → verdict 아티팩트+게이트+이벤트 매핑 신설 ([03 §3](./03-loop-engineering-improvements.md)) | H | ADR 후 |
| PL-02 | `state-machine.ts:74` | 재작업 루프를 잇는 순간 무한 루프 — `GATE_PASS`가 budget을 풀로 리셋해 REVIEW→IMPL→REVIEW 진동이 비용 무제한 | budget 카운터 1개가 "단계 내 재시도"와 "재작업 사이클"을 겸함 → `MachineState`에 별도 `reworkCyclesLeft` (ADR 필요) | H | ADR 후 |
| PL-03 | `types.ts:66,77`, `runner.ts:221-234` | `sessionId`가 계약에만 있고 runner가 전달/캡처 안 함 — 모든 단계·재시도가 cold start | runner에 세션 상태 없음 → 엔진 변경 시 리셋 규칙과 함께 스레딩 | M | 예 |
| PL-04 | `runner.ts:46-50,226-231` | 게이트 실패 증거가 다음 시도 프롬프트에 미전달 — 결정적 실패가 budget 소진까지 동일 프롬프트 반복 | `PromptBuildContext`가 `{item, profile, worktree}`뿐 → `{attempt, lastFailure}` 추가 | H | 예 |
| PL-05 | `diff-rules.ts:96-98` | 기본 base ref가 `origin/${profile.baseBranch}` — ADR-011 resolver 미사용. 릴리즈 브랜치 잡에서 오판정 | `draft-pr.ts:25`와 로직 이중화·발산 → `resolveBaseBranch` 사용 | M–H | 예 |
| PL-06 | `exit-code.ts:19-22`, `draft-pr.ts` | 게이트 명령 타임아웃 없음 — 멈춘 테스트가 스케줄러 lease를 쥔 채 잡을 영구 정지 | port 시그니처에 deadline 없음 → `timeoutMs`+`signal` 추가, 타임아웃=결정적 gate-fail | H | 예 |
| PL-07 | `runner.ts:182,250-256` | 게이트 실패는 백오프 0으로 즉시 재시도 — 엔진 호출 비용 연사 | `decideRetry`가 엔진 실패 경로에만 연결 → 게이트 실패에도 (별도) 백오프 정책 | M | 예 |
| PL-08 | `runner.ts:140,426-430` | `clock` 미주입 시 `ZERO_CLOCK` — durationMs 전부 0, `deferredUntilMs`가 1970년 기준 | 침묵하는 퇴화 기본값 → clock 필수화 또는 명시적 실패 | M | 예 |
| PL-09 | `scheduler.ts:97-104` | per-repo 세마포어 용량이 최초 acquisition에 동결 — config 재로드 무시 | 캐시에 용량 미저장 → 용량 검증/재구성 또는 "scheduler 수명=config 수명" 문서화 | L–M | 예 |
| PL-10 | `retry-policy.ts:65-72` | errorCode substring 매칭 — `"author_validation"`이 auth로 분류돼 즉시 ESCALATED | 자유 문자열 위 needle 매칭 → canonical errorCode enum + 정확 매칭, substring은 fallback | M | 예 |
| PL-11 | `runner.ts:162-164` | 취소된 시도가 `engine-fail`/`stage-failed`로 집계 — analytics 오염 | runStage 내부에 취소 인지 없음 → `stage-canceled` 이벤트 분리 | L–M | 예 |
| PL-12 | `runner.ts:197-199` | `PipelineRunResult`가 "deferred"를 표현 못 함 — 비터미널 상태로 break만 | → `deferred?: {untilMs}` 필드 추가 | L | 예 |
| PL-13 | `runner.ts:72-107` | 신·구 이벤트 어휘 동시 방출 (`stage-pass` vs `stage-completed`) — 소비자마다 dedupe | → 소비자 감사 후 legacy set 폐기 일정 수립 | L | 감사 후 |
| PL-14 | `runner.ts:157,377` | 이벤트에 `attempt` 없음, 터미널 잡 이벤트(`job-done` 등) 없음 | → stage payload에 attempt/maxAttempts, 터미널 이벤트 추가 | L | 예 |
| PL-15 | `artifacts.ts:262-267` | `[Blocker]`를 리스트 항목에서만 탐지 — 단락으로 쓰면 에스컬레이션 우회 (안전장치 false-pass) | → 섹션 본문 전체 스캔 | M | 예 |
| PL-16 | `draft-pr.ts:49` | `git add -A`가 `pr.json`/`PLAN.md`/`_spec.md` 스크래치 아티팩트까지 PR에 커밋 | → 아티팩트 경로 제외 또는 `.git/info/exclude` 프로비저닝 | M | 예 |
| PL-17 | `local-runtime.ts:149` | `forbidTestEditInImpl: false` 하드코딩 — profile guard 무시. checksum은 추가 파일을 못 봐(`checksum.ts:132-161`) IMPL이 자가 충족 테스트를 추가해도 미탐지 | → 하드코딩 제거, `ctx.profile.guards` 존중 (의도된 실패 증가) | H | 예 |
| PL-18 | `retry-policy.ts` vs `scheduler.ts` | "provider"가 엔진명/컨텍스트 제공자 두 의미. `pr-draft.ts`(검증) vs `draft-pr.ts`(행위) 명명 혼란. `TextFileReader`/`removeUndefined` 중복 정의 | → rename + 공유 port 승격 (기계적) | L | 예 |
| PL-19 | `runner.ts:72-107,129` | `payload: Record<string, unknown>` — 소비자가 stringly 추출. `WORKER_STAGE_BY_STAGE`가 `Partial` 거짓 타입 | → 이벤트별 타입드 payload 유니온 ([04 §6](./04-dashboard-redesign-plan.md)), `Record<StageName,...>` | L | 예 |
| PL-20 | `stage-config.ts:20-23` | `timeoutMinutes`/`retryBudget`이 전역 단일값 — SPEC과 IMPL이 같은 30분 | → 단계별 override (additive) | M | 예 |
| PL-21 | `stage-config.ts:49` | `resolveStageSkill` export·테스트되나 미사용 — config가 효력 없는 채 존재 | → buildPrompt에 스레딩 또는 삭제 | L | 예 |
| PL-22 | `runner.ts:142-146,260` | 증거/이벤트 메모리 무제한 — 엔진 실패 시 전체 output(최대 10MB)이 evidence로 | → 기록 시점 truncate(예: 16KB)+해시, 전문은 파일 아티팩트 | L–M | 예 |

### 3.2 어댑터/IO 계층 (IO)

| ID | 위치 | 문제 | 근본 원인 → 제안 | 리스크 | 즉시 |
|---|---|---|---|---|---|
| IO-01 | `claude-code.ts:78-83`, `codex.ts:59-86` | **토큰/비용 텔레메트리 사실상 전멸**: claude는 JSON을 요청만 하고 파싱 안 함(`total_cost_usd`/`session_id`/`usage` 유실, `worker-cost` 미발화). codex 파서는 top-level 키만 봐서 실제 봉투(중첩 `msg`, `token_count`)와 불일치 — contract stub만 통과. 토큰 필드는 시스템 어디에도 없고 가격표·집계 엔드포인트도 없음 | 계약을 실제 CLI 출력으로 검증한 적 없음 → claude 결과 JSON 파싱, codex 스트림 파서 수정, `WorkerResult.usage{inputTokens,outputTokens,...}` 추가, 실제 출력 fixture 기반 contract test ([03 §6](./03-loop-engineering-improvements.md)) | H | 예 |
| IO-02 | `api/app.ts:192-209`, `db/index.ts:440-460` | `POST /jobs/:id/cleanup`은 이벤트만 남기는 무동작 — 소비하는 실행기가 없음 | cleanup executor 미구현 → 데몬 tick에서 cancel처럼 처리 | M | 예 |
| IO-03 | `agentctl.ts:283` | `agentctl cleanup`은 기본 와이어링에서 항상 실패 — `upsertRepoProfile`을 아무도 호출 안 해 profile이 늘 undefined | YAML↔DB 프로필 동기화 부재 → agentctl이 repos.yaml 로드 또는 데몬 기동 시 upsert | L | 예 |
| IO-04 | `worktree/manager.ts:150-178` | stale `.dispatch.lock` 영구 데드락 — PID를 쓰지만 읽지 않음. 홀더 크래시 후 해당 레포 전체가 30s timeout 무한 반복 | → EEXIST 시 PID 생존 확인(ESRCH)+mtime 노화로 안전 회수 | M–H | 예 |
| IO-05 | `codex.ts:137,140`, claude `execFile` | SIGTERM 단발·직계 자식만 kill — 에이전트 CLI의 프로세스 서브트리(테스트 러너, MCP 서버)가 좀비로 생존 | → `detached:true`+프로세스 그룹 kill, SIGTERM→SIGKILL 에스컬레이션 | M | 예 |
| IO-06 | `loop.ts:77-109`, `local-runtime.ts:72` | head-of-line blocking — tick 시작에만 claim, `Promise.all` 대기, 실행 중 tick skip. 30분짜리 한 단계가 신규 claim·타 잡 취소 확정을 전부 봉쇄 | smoke용 batch-동기 설계가 데몬으로 승격 → per-job detached promise + 슬롯 refill (설계/ADR 필요) | H | ADR 후 |
| IO-07 | `db/index.ts:203-250` | claim이 SELECT-then-UPDATE 비트랜잭션, `busy_timeout` pragma 없음 — 멀티 프로세스 시 이중 claim, agentctl 동시 쓰기 시 raw SQLITE_BUSY | → `busy_timeout` + `UPDATE...RETURNING` 원자 claim, 단일 데몬 규칙 문서화 | L–M | 예 |
| IO-08 | `local-runtime.ts:128,330-336` | TEST 체크섬 매니페스트가 인메모리 Map — 데몬 재시작(명시적 크래시 복구 경로) 시 IMPL checksum 게이트가 **조용히 통과** | → worktree 아티팩트(`.pando/test-checksums.json`) 또는 events로 영속화, 매니페스트 부재+TEST완료 시 fail/warn | M | 예 |
| IO-09 | `claude-code.ts:112` | `timedOut = killed || signal==="SIGTERM"` — 취소가 timeout으로 분류돼 analytics 오염 (PL-11과 결합) | → 자체 타이머 발화 시에만 timedOut | L | 예 |
| IO-10 | `api/app.ts:100-108` | `/health`의 `daemon:{status:"ok"}` 하드코딩 — 데몬 미가동이어도 ok | → last-tick heartbeat/lastError 주입 | L | 예 |
| IO-11 | `api/app.ts:111-152`, `db/index.ts:526-530` | 페이지네이션 전무, `/analytics`가 요청마다 전체 잡×전체 이벤트 메모리 로드 — 4s 폴링과 결합 시 O(N·M) 상시 부하 | → SQL 집계, `?limit=&since=` 파라미터 | L–M | 예 |
| IO-12 | `db/index.ts:233-249`, `loop.ts:92-96` | claim 시점에 QUEUED→SPEC 선전이 — lease 거부되면 실행 없이 SPEC+started_at 상태로 잔류, 타이밍 메트릭 왜곡 | → lease 확보 후 전이(peek-claim 분리) | M | 주의해 예 |
| IO-13 | `pando.ts:47` vs `agentctl.ts:53` vs `server.ts:14` | DB 기본 경로 분열 — `pandoctl start` 직후 `submit`이 데몬이 안 읽는 `/tmp/pando.sqlite`에 들어감 | → ops 명령이 ADR-012 매니페스트에서 최신 live run-root 해석 | L | 예 |
| IO-14 | `local-runtime.ts:182`, `pando-gc.ts` | `~/.worktrees`(장수 배포 경로)가 GC 스토리 밖 — 터미널 잡 worktree 무한 누적 (IO-02/03과 결합) | → cleanup 실행기 + 노화 기반 sweep | M | 부분 |
| IO-15 | `manager.ts:61-64` | worktree 재사용 시 fetch/reset/env 재복사/setup 재실행 없음 — 이전 시도 잔재가 IMPL diff에 혼입 | → 재시도 정책 결정 필요(stage-resume 보호 vs reset) | M | 정책 후 |
| IO-16 | `worktree-isolation.ts:35-38` | 포트가 `hash(jobId) % range` — 충돌 검사 없음 (100포트 범위) | → 활성 잡 포트 대조 또는 순차 할당 | L | 예 |
| IO-17 | `manager.ts:78-81` | setup 명령이 `.dispatch.lock`을 쥔 채 타임아웃 없이 실행 — 멈춘 `bun install`이 레포 전체 봉쇄 | → 타임아웃 + git 변이 구간만 락 | L | 예 |
| IO-18 | `run-manifest.ts:27` 외 | `JSON.parse as` 무검증 다수 — 손상된 매니페스트가 `pando start`/`gc` 크래시 | → 소형 validator, 매니페스트는 quarantine-and-continue | L | 예 |
| IO-19 | `runner.ts:264`, `loop.ts:299` | 엔진 실패마다 전체 output을 `events.evidence`에 저장 — retryBudget 10이면 잡 하나가 ~100MB 가능 (PL-22의 persistence 측) | → 기록 시 truncate+파일 아티팩트 경로 저장 | L–M | 예 |
| IO-20 | `api/app.ts:505-519`, `server.ts:118-121` | 에러 처리 침묵 다수: 500이 서버측 로그 없음, store 에러를 메시지 substring으로 매핑, readiness/repos 로드 에러 swallow, `cancel-stop-failed` 잡이 영구 재시도 | → 구조화 에러 코드, 서버 로깅, 취소 실패 attempt cap | M | 예 |
| IO-21 | 다수 | 중복: `shellGateRunner` 3벌, `branchSlug` 2벌, brief WorkItem 조립 2벌, `removeUndefined` 5벌, CLI/API의 retry/cancel/cleanup 의미 발산 | → 공유 모듈 추출 (기계적) | L | 예 |

### 3.3 대시보드 (DS)

| ID | 위치 | 문제 | 리스크 | 즉시 |
|---|---|---|---|---|
| DS-01 | `playwright.config.ts:13` | `webServer.command: "pnpm dev"` — bun 마이그레이션 잔재, e2e smoke 사망 | L | 예 |
| DS-02 | `App.tsx:1007-1014` | `BriefSubmitPanel.submit` try/catch 없음 — unhandled rejection, 침묵 실패 | L | 예 |
| DS-03 | `App.tsx:1070-1133`, `styles.css:863-901` | 진행률 미터가 상태별 하드코딩 상수(가짜) — CANCELED는 PR에서 취소돼도 0% | L | 예 |
| DS-04 | `App.tsx` 전체 | 1,267줄 god file — 15개 컴포넌트+12개 헬퍼 단일 모듈. 재설계 선행 분해 필요 | M | 점진 |
| DS-05 | `App.tsx:169-174` | 4s마다 health→analytics→jobs→detail 순차 await + IO-11 결합 | L | 예 |
| DS-06 | `App.tsx:122`, `app.ts:122` | `recentEvents` 무제한 — 긴 루프에서 payload·DOM 무한 성장 | M | API와 함께 |
| DS-07 | — | `engine`/`model`/`providerKind`/`backoffMs`가 서버에 있는데 미렌더 | L | 예 |
| DS-08 | `App.tsx:420-431` | analytics 실패 시 스켈레톤 영구 표시 (에러 분기 없음) | L | 예 |
| DS-09 | `App.tsx:178-182` | 활성 잡 없으면 폴링 전면 중단 — 외부 enqueue가 수동 새로고침 전까지 안 보임 | L | 예 |
| DS-10 | `App.tsx:642-656,1145` 등 | a11y: tablist에 arrow-key/aria-controls 없음, 미터가 progressbar 롤 아님, 에러 배너 aria-live 없음, ISO 타임스탬프 원문 | L | 예 |
| DS-11 | `timeline.ts:92-98` | 이벤트 payload stringly 추출 — 타입드 유니온 부재 (PL-19와 동일 뿌리) | M | PL-19와 |
| DS-12 | `App.tsx:79` 외 | `TERMINAL_STATUSES`/실패 이벤트 목록이 서버·클라 3곳 중복 | L | 예 |
| DS-13 | 매 tick | 전 상태 객체 교체로 트리 전체 리렌더 — 병렬 매트릭스 도입 전 memo/구조 공유 필요 | M | 분해와 함께 |
| DS-14 | `App.test.tsx:108-120` | 자동 새로고침 테스트가 실제 4.6s sleep — fake timer 미사용 | L | 예 |
| DS-15 | — | 토큰/누적 비용/run summary/글로벌 이벤트 피드 데이터 자체가 서버에 없음 (IO-01 의존) | — | M2 후 |
| DS-16 | `.oxlintrc.json:10` | dashboard가 ignorePatterns — React 코드 전체 미린트 (TV-04와 동일) | M | 예 |

### 3.4 테스트/검증/설정 (TV, CF)

| ID | 위치 | 문제 | 리스크 | 즉시 |
|---|---|---|---|---|
| TV-01 | `scripts/check-coverage.ts:16-19` | 문서가 요구하는 core/gates/scheduler 95%가 미강제 (전역 85%만) — 현재 통과 중이라 게이트 추가가 첫날부터 green | H(회귀 침묵) | 예 |
| TV-02 | `.oxlintrc.json:62-99` | 계층 경계 lint 구멍: 비접두 `"fs"`, `node:https` 등 미차단, `better-sqlite3`/`hono` 직수입 가능, `**/git/*` 패턴 누락, dynamic import 미커버 | M | 예 |
| TV-03 | `tsconfig.json:15` | `scripts/` 타입체크 제외 — 운영 스크립트 4종이 tsc 밖 | M | 예 |
| TV-04 | `.oxlintrc.json:5,10` | `correctness` 카테고리 전역 off + dashboard ignore | M | 검증 후 |
| TV-05 | ci.yml | nightly cron 부재("soak:nightly"가 실제로 nightly 아님), `smoke:pandoctl-pack`·Playwright smoke·two-job contract가 CI 밖 | M | 예 |
| TV-06 | `package.json` | verify에서 dashboard 테스트 2회·tsc 3회 중복 실행 | L | 예 |
| TV-07 | 엔진 테스트 | "fake/실구현 공유 contract suite" 미실현 — 분리된 2개 스위트, 실제 CLI 출력 fixture 없음 (IO-01을 못 잡은 원인) | H | 예 |
| TV-08 | `tests/e2e/` | "e2e"가 실제로는 in-process(fake 엔진+:memory:) — 피라미드 지표 오해 소지 | L | 문서화 |
| TV-09 | 커버리지 | `src/server.ts` 61% lines, `src/cli` 84.4% — 전역 집계에 가려짐 | M | 예 |
| CF-01 | `config/stages.yaml:40-47` vs `stage-config.ts:66` | `pr.prompt` 블록이 로더에서 침묵 드랍 — 실제 프롬프트는 `local-runtime.ts:199` 하드코딩. 운영자가 yaml을 고쳐도 무효 | M | 예 |
| CF-02 | `config/orchestrator.yaml:7-10` | `intake:` 섹션 전체를 아무도 파싱 안 함 | L | 예 |
| CF-03 | 로더 전반 | unknown key 침묵 무시 (CF-01/02의 뿌리) → strict-key 검증 또는 경고 | M | 예 |
| CF-04 | config | 가격/토큰 예산/비용 캡 설정 전무 — live 모드 지출 무제한 (IO-01 후속, ADR 필요) | M | 설계 후 |
| CF-05 | `config.ts` | repo 간 port_range 중복 검증 없음 | L | 예 |

## 4. 관심사별 종합

- **경계/계층**: 구조는 모범적이나 강제 도구(TV-02)와 명명(PL-18)에 구멍. `src/git/inspector.ts`가 adapter인데 lint 패턴 밖.
- **상태 관리**: 상태머신 자체는 견고. 문제는 **데이터 모델에 있는 상태로 가는 길이 없는 것**(PL-01 CANCELED/CHANGES_REQUESTED, ESCALATED 복귀 경로 부재)과 claim의 비원자성(IO-07/12).
- **관측성**: 이벤트 스트림 기반은 좋으나 — 토큰 없음(IO-01), attempt 없음(PL-14), 취소 오염(PL-11/IO-09), 이중 어휘(PL-13), 무타입 payload(PL-19). 데몬 heartbeat 없음(IO-10).
- **에러 처리**: 게이트 실패는 구조화가 잘 됨. API 500 무로그, swallow된 로드 에러, substring 에러 매핑이 약점(IO-20).
- **성능**: 단일 운영자 규모에선 양호. 구조적 병목은 head-of-line blocking(IO-06)과 O(N·M) analytics(IO-11)+4s 폴링(DS-05).
- **유지보수성**: `App.tsx`(DS-04)와 `agentctl.ts`(647줄), shellGateRunner 3벌(IO-21)이 주된 부채.
