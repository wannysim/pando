# 07 — 리스크 레지스터

> 작성일: 2026-06-12 · 대상: [05-implementation-roadmap.md](./05-implementation-roadmap.md)가 도입하는 변경
> 표기: 발생가능성 × 영향 = L/M/H

---

## 1. 아키텍처 리스크

| ID | 리스크 | 발생/영향 | 완화 |
|---|---|---|---|
| R-A1 | ADR-014(데몬 동시성 모델 변경)가 claim/취소/텔레메트리의 미묘한 의미를 깨뜨림 — 가장 침습적인 변경 | M/H | 마지막에 단독 진행. full-daemon-smoke contract + soak를 회귀 하네스로 사용. 기존 batch tick을 플래그로 보존해 비교 가능하게 |
| R-A2 | `MachineState` 확장(`reworkCyclesLeft`)이 core 계약 변경 — 기존 직렬화된 잡과 불일치 | M/M | ADR-013에 마이그레이션 규칙 명시(`attempts_left`만 있는 기존 행은 rework 기본값으로 보정 — `ensureColumn` 패턴). 상태머신 전수표 갱신 선행 |
| R-A3 | 게이트 port 시그니처 변경(timeoutMs)이 모든 어댑터/smoke 하네스에 파급 | H/L | additive optional 파라미터로 도입, shellGateRunner 공유 추출(IO-21)을 먼저 해 변경 지점을 1곳으로 |
| R-A4 | claim 원자화(IO-07/12)가 "QUEUED→SPEC 선전이"에 의존하던 숨은 소비자를 깨뜨림 (Hyrum) | M/M | 변경 전 `status`/`started_at` 소비처 전수 grep, smoke 증거 스키마 비교 |
| R-A5 | 순수 계층에 기능을 넣다 I/O 경계를 침범 | L/H | TV-02 lint 보강을 M1에서 먼저 — 도구가 막게 |

## 2. 루프 동작 리스크

| ID | 리스크 | 발생/영향 | 완화 |
|---|---|---|---|
| R-L1 | REVIEW 루프 활성화로 LLM 비용 급증 (재작업 사이클 × 재시도 budget) | M/H | `reworkCyclesLeft` 기본값 보수적(2), 게이트 실패 백오프(PL-07) 동시 도입, 비용 캡(CF-04)을 같은 마일스톤에. 개인 레포에서 먼저 가동(설계 v2 §8 실험장 원칙) |
| R-L2 | `forbidTestEditInImpl` 복원(PL-17)으로 기존에 통과하던 IMPL이 대량 실패 | H/M | **의도된 실패**임을 인지하고 진행. 실패 사유가 `{stage, gateName, reason, evidence}`로 명확히 남는지 먼저 확인. 레포별 guard로 점진 적용 가능 |
| R-L3 | 실패 피드백(PL-04)이 프롬프트를 오염 — 잘못된 증거가 워커를 잘못된 방향으로 유도 | M/M | evidence는 truncate된 결정적 신호만 주입(LLM 산문 배제 — ADR-002 정신), attempt 2+에만 포함, self-benchmark로 성공률 전후 비교 |
| R-L4 | 세션 연속성(PL-03)이 단계 격리를 약화 — 이전 단계의 오류 컨텍스트가 전염 | M/M | 정책을 ADR-013에서 결정(기본: 같은 stage 재시도 내에서만 세션 유지, 단계 경계는 cold start 유지가 안전한 기본값) |
| R-L5 | errorCode enum 강화(PL-10)가 미지의 실 에러 패턴을 unknown으로 강등 → 백오프 부정확 | M/L | substring을 fallback으로 유지, unknown 분류율을 analytics로 관찰 |

## 3. UX 리스크 (대시보드)

| ID | 리스크 | 발생/영향 | 완화 |
|---|---|---|---|
| R-U1 | 레트로 테마가 가독성/시인성을 해침 (점멸·저대비·장식 과잉) | M/M | 대비비 4.5:1 하한, 장식은 CSS 1겹(끄면 평범한 다크), `prefers-reduced-motion` 전면 존중, 기존 light 테마 보존 |
| R-U2 | App.tsx 분해(M4-b) 중 동작 회귀 | M/M | 기존 25개 테스트를 불변식으로 — 분해 PR은 시각·동작 변화 0을 명시적 수용 기준으로 |
| R-U3 | 데모 모드가 실 데이터로 오인됨 | L/H | `DEMO FEED` 상시 워터마크, 데모 클라이언트는 빌드 플래그로만 주입, 실 모드 미가용 필드는 "—" 표기 |
| R-U4 | ADR-009 제약(컴포넌트 제한)과 충돌 | H/L | ADR-015로 먼저 갱신 — 결정 없이 구현하지 않음 |

## 4. 성능 리스크

| ID | 리스크 | 발생/영향 | 완화 |
|---|---|---|---|
| R-P1 | 이벤트 증분 커서/페이지네이션 도입 전 EventFeed가 폴링 부하 가중 | M/M | M4-a(API)를 M4-c(UI)보다 먼저 — 순서 강제 |
| R-P2 | 토큰/비용 집계 SQL(`json_extract`)이 events 성장에 따라 느려짐 | M/M | since 파라미터 필수화, 필요 시 표현식 인덱스. 새 테이블은 ADR-001상 새 ADR 필요 — 계측 후 판단 |
| R-P3 | 프로세스 그룹 kill(IO-05)이 macOS/리눅스에서 상이하게 동작 | M/M | 두 플랫폼 의미 차이를 테스트로 박제(detached+negative pid), Docker smoke로 리눅스 검증 |

## 5. 테스트/마이그레이션 리스크

| ID | 리스크 | 발생/영향 | 완화 |
|---|---|---|---|
| R-T1 | per-dir 커버리지 게이트가 미래의 정당한 리팩터를 막음 (사각 파일이 lcov에 잡히며 급락) | L/M | 게이트 메시지에 경로별 수치 출력, 임계 조정은 ADR 아닌 PR 논의로 가능함을 명시 |
| R-T2 | 실 CLI fixture가 CLI 버전업으로 stale — 파서가 fixture에만 맞고 실물과 또 어긋남 | M/M | fixture에 캡처 시 CLI 버전 명기, two-job live smoke(수동)가 주기적 실물 검증 역할. 파서는 미지 필드 관용(unknown-tolerant)으로 |
| R-T3 | oxlint correctness 재활성(TV-04)·dashboard lint 편입이 대량 노이즈 | H/L | 별도 정리 wave PR로 격리, 규칙별 단계 도입 |
| R-T4 | 구버전 DB(`ensureColumn` 경로)와 신규 컬럼/이벤트 어휘 혼재 | M/M | legacy DB fixture 테스트(§3.2), 이벤트 소비자는 누락 필드 관용으로 작성 |
| R-T5 | legacy 이벤트 어휘 폐기(PL-13)가 미발견 소비자를 깨뜨림 | M/M | 폐기 전 소비처 감사(대시보드/analytics/agentctl/benchmark), 한 릴리즈 동안 병행 방출 유지 |

## 6. 운영/일정 리스크

| ID | 리스크 | 발생/영향 | 완화 |
|---|---|---|---|
| R-O1 | 계획이 비대해 W6 큐 규율(한 번에 하나)을 침식 | M/M | docs/README.md 활성 큐에는 마일스톤 단위로만 등재, 이 폴더는 참조 문서로 유지 |
| R-O2 | cleanup 실행기(IO-02)의 FS 삭제가 잘못된 경로를 지움 | L/H | ADR-012 패턴 준용: dry-run 기본, 경로 가드(worktree root 하위 검증), 삭제 전 경로-일치 검증(기존 `failJobCleanup` 가드 재사용) |
| R-O3 | stale lock 회수(IO-04)가 살아있는 락을 탈취 | L/H | PID 생존 확인(ESRCH만 회수) + mtime 노화 이중 조건, EPERM은 생존으로 간주(pando-gc 선례) |
