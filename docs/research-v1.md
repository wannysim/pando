# 에이전트 드리븐 개발 워크플로우 시스템 — 리서치 리포트 + 설계안

> Archive note: 현재 작업 큐와 문서 라우팅은 `docs/README.md`를 따른다. 이
> 문서는 초기 리서치 기록이다. 지속되는 결정은 `docs/adr/`에만 남기고,
> 모델명·가격·도구 현황 같은 휘발성 정보는 사용 전에 재확인한다.

> 작성일: 2026-06-06 · 대상: Jira 티켓 → 자율 개발 파이프라인 구축 (TS 풀스택, OpenAI 우선, 멀티모델 교체 가능)
> 조사 방법: 5개 앵글 병렬 웹 리서치 + 핵심 주장 10건 1차 소스 교차 검증
> 현재 구현 기준은 ADR과 `docs/README.md`가 우선한다. 이 문서는 초기 리서치 기록이라 BullMQ/TUI 같은 대안이 남아 있을 수 있으며, 이후 결정으로 SQLite-only(ADR-001), 웹 대시보드(ADR-003), MCP connector 상속(ADR-004)이 확정됐다.

---

## TL;DR — 추천 스택

| 레이어 | 추천 | 이유 |
|---|---|---|
| 워커 엔진 | **Codex CLI (`codex exec`)** + 어댑터 인터페이스 | OpenAI 우선이면서 서드파티 모델도 config로 교체 가능(검증됨). JSON 이벤트 스트림으로 제어 용이 |
| 오케스트레이터 | **TypeScript 직접 구축** (BullMQ + XState 또는 Inngest) | 친구처럼 게이트/페르소나/통제를 직접 정의. 파이프라인 자체는 단순한 상태머신이라 프레임워크 없이도 가능 |
| 격리 | **git worktree (티켓당 1개)** + 필요 시 Docker 샌드박스 | 이미지의 in-flight 6개 병렬 구조 그대로 |
| 멀티모델 | **LiteLLM Proxy** (게이트웨이) 또는 역할별 config 기반 모델 별칭 | 에이전트별 모델 교체 = config 한 줄 |
| Jira | REST API v3 (webhook 또는 JQL 폴링) | 개인 규모면 폴링으로 시작해도 충분 |
| 실행 환경 | 1단계: 로컬 맥 + Tailscale → 2단계: 미니PC/VPS | 회사 코드 보안상 로컬 우선 시작 추천 |
| 안전장치 | 테스트 파일 변경 금지 diff 검사 + draft PR + 사람 리뷰 필수 | 에이전트는 절대 self-merge 못 하게 |

핵심 결론: **"에이전트를 만드는" 게 아니라 "검증된 코딩 에이전트 CLI를 워커로 부리는 오케스트레이터를 만드는" 것**이 2026년 표준 패턴이다. 친구의 하네스도 이 구조일 가능성이 높고, Spotify(1,500+ merged PR), mabl(월 370+ PR) 같은 프로덕션 사례도 동일하다.

---

## 1. 친구 시스템 해부 (이미지 기준)

스크린샷에서 읽히는 구조:

- **파이프라인 5단계**: `SPEC → PLAN → TEST → IMPL → REVIEW` — 스토리당 5단계 상태머신
- **게이트 패스**: 단계마다 `gate pass 1/10 (9 left)` — 게이트 통과 시도 횟수에 예산(budget)이 있음. 10회 안에 게이트 못 넘으면 실패 처리하는 retry budget 패턴
- **병렬 in-flight 6개**: 스토리 6개가 동시에 다른 단계를 진행 (worktree 격리로 추정)
- **roster**: committed(완료 커밋) / upcoming(대기) — 의존성 체인 기반 스케줄러가 leaf 노드부터 투입
- **workflow 단위 실행**: `wf_xxx 8h 8m` — 장시간 실행되는 durable 워크플로우, `run-batch:c7 · Bash` 같은 액티브 스텝 표시

즉 구성요소는 4개다: **① 스케줄러**(의존성 그래프 → 다음 작업 선정), **② 상태머신**(단계 전이 + 게이트), **③ 워커**(실제 코드 작성하는 코딩 에이전트), **④ 리포터**(Jira 상태 보고). 이 리포트의 설계안도 이 4분할을 따른다.

---

## 2. 워커 엔진 — 두 접근 비교

### 접근 A: 기존 코딩 에이전트 CLI를 헤드리스로 구동

2026년 6월 기준 프로그래머블 코딩 에이전트 비교:

| 에이전트 | 모델 자유도 | 헤드리스 구동 | 샌드박스 내장 | 라이선스 |
|---|---|---|---|---|
| **Codex CLI/SDK** (OpenAI) | OpenAI 기본 + **서드파티 가능** (`model_providers` config, 검증됨) | `codex exec --ephemeral --json` + `@openai/codex-sdk` | read-only 기본, `--sandbox workspace-write` 프리셋 | 오픈소스 (github.com/openai/codex) |
| **Claude Code / Agent SDK** | Anthropic 전용 (+Bedrock/Vertex) | `claude -p --output-format stream-json` + `@anthropic-ai/claude-agent-sdk` | OS 레벨 권한 모드 | 독점 |
| **Aider** | 100+ 프로바이더 (LiteLLM 기반) | `aider --yes-always --message "..."` — PTY 불필요, subprocess로 가장 단순 | 없음 (직접 Docker) | Apache 2.0 |
| **OpenHands** | LiteLLM 기반 전체 | `openhands --headless` + Python SDK | Docker/Local/K8s 런타임 | MIT |
| **mini-SWE-agent** | LiteLLM/OpenRouter | Python API `agent.run()` | Docker/bwrap 등 | MIT |
| **OpenCode** | 75+ 프로바이더 | 클라이언트-서버 구조 | 없음 | MIT |

너의 상황(OpenAI 우선 + 모델 교체 가능)에 가장 잘 맞는 건 **Codex CLI**다. 검증 과정에서 확인된 중요한 사실: Codex는 OpenAI 전용이 아니라 **Chat Completions/Responses API 호환이면 어떤 프로바이더든 `model_providers` config로 연결 가능**하다. 즉 Codex 하나로 "OpenAI 기본 + 필요 시 Claude/기타 교체" 요구사항이 충족된다.

Codex 헤드리스 사용 예:

```bash
# 단발 실행, NDJSON 이벤트 스트림
codex exec --ephemeral --cd "$PWD" --config 'approval_policy="never"' --json --sandbox workspace-write \
  --output-schema ./gate-result.schema.json \
  -o ./result.json \
  "SPEC.md를 읽고 acceptance criteria에 대응하는 실패하는 테스트를 작성해"

# 세션 이어가기 (단계 간 컨텍스트 유지)
codex exec resume <SESSION_ID> "이제 테스트를 통과시키는 구현을 해"
```

```typescript
// TypeScript SDK
import { Codex } from "@openai/codex-sdk";
const codex = new Codex();
const thread = codex.startThread();
await thread.run("Implement the plan in PLAN.md");
// 나중에: codex.resumeThread(threadId)
```

Claude Code도 동급으로 성숙하다 (`claude -p`, hooks, 서브에이전트, MCP). 주의할 점 하나: **2026-06-15부터 Pro/Max 구독으로 `claude -p`/Agent SDK를 쓰면 별도의 월간 Agent SDK 크레딧 풀에서 차감**된다(Pro $20, Max 5x $100, Max 20x $200 상당). API 키 사용은 기존대로 토큰 과금. 야간 배치로 돌리면 구독 크레딧이 금방 소진될 수 있으니 비용 모델을 미리 계산해야 한다 (공식 문서 확인됨).

### 접근 B: 프레임워크로 에이전트 직접 구축

| 프레임워크 | 특징 | 적합한 경우 |
|---|---|---|
| **Mastra** (TS, 1.0 stable 2026-01) | `Workflow` 그래프(.then/.parallel/.branch) + suspend/resume + evals 내장. Replit/PayPal 프로덕션 사용 | 배터리 포함 TS 프레임워크 원할 때 |
| **OpenAI Agents SDK (JS)** | OpenAI 공식, Temporal 통합 GA(2026-03) | OpenAI 중심 + durable 실행 |
| **Inngest AgentKit** | 결정적 라우팅 + 스텝 자동 체크포인트 | 큐+오케스트레이션 한 번에 |
| **LangGraph JS** | 노드별 체크포인트(PostgresSaver), time-travel | LangChain 생태계 필요 시 |
| **Vercel AI SDK 6** | `ToolLoopAgent` 클래스(v6에서 Agent→ToolLoopAgent로 변경, 검증됨), 프로바이더 추상화, MCP 지원 | 저수준 LLM 호출 레이어로 |

### 평가: 하이브리드가 정답

직접 구축(B)의 함정: **에이전트 루프 자체(파일 탐색, 편집, 셸 실행, 컨텍스트 관리)를 재발명하는 비용이 막대하다.** Codex/Claude Code는 이 부분에 수백 인년이 들어가 있다. 반대로 CLI만 쓰면(A) 파이프라인 게이트·페르소나·통제를 표현할 곳이 없다.

따라서 업계 표준 패턴은:

> **오케스트레이션(상태머신, 게이트, 스케줄링, Jira 연동)은 직접 TS로 작성하고, 코드를 실제로 만지는 워커는 검증된 CLI 에이전트를 subprocess로 호출한다.**

워커는 인터페이스로 추상화해서 교체 가능하게:

```typescript
interface WorkerEngine {
  run(opts: {
    worktreeDir: string;
    prompt: string;
    model: string;          // 역할별 모델 주입
    sessionId?: string;     // 단계 간 세션 연속성
    outputSchema?: object;  // 구조화된 게이트 결과 강제
    timeoutMs: number;
  }): Promise<WorkerResult>;
}
// 구현체: CodexEngine, ClaudeCodeEngine, AiderEngine ...
```

---

## 3. 오케스트레이션 설계 — 파이프라인·게이트·통제

### 3.1 파이프라인 = 명시적 상태머신

친구 이미지와 동일한 5단계가 사실상 업계 표준 (canonical pipeline):

```
SPEC ──▶ PLAN ──▶ TEST ──▶ IMPL ──▶ REVIEW ──▶ PR(draft)
  │게이트    │게이트    │게이트    │게이트     │게이트
  ▼         ▼         ▼         ▼          ▼
spec.md   plan.md   실패하는    테스트     LLM 리뷰어
산출물     산출물    테스트 커밋  전부 통과   APPROVE 판정
```

핵심 원칙 (Factory.ai Droids, Spotify Honk 사례에서 공통):

1. **게이트 판정은 결정적 신호만 신뢰한다** — exit code, 파일 아티팩트, 구조화된 JSON 판정. 에이전트의 채팅 출력("다 했습니다!")은 절대 신뢰하지 않는다.
2. **각 단계는 파일 아티팩트를 남긴다** — `_spec.md`, `_plan.md`, `_test-report.md`, `_impl-report.md`. 다음 단계 에이전트는 이전 단계의 파일만 읽는다 (인메모리 컨텍스트 공유 금지 → 디버깅 가능, 재시작 가능).
3. **retry budget** — 게이트당 시도 횟수 상한 (친구 이미지의 `1/10`). 소진 시 무한루프 대신 사람에게 에스컬레이션.
4. **역할 분리** — 계획자(Delegator)는 코드를 절대 만지지 않고, 리뷰어는 구현자와 다른 에이전트/모델로 격리한다 (구현자가 자기 리뷰 지적을 몰래 덮는 것 방지).

### 3.2 에이전트 기만(reward hacking) 방지 — 친구가 "제일 어려웠다"던 부분

이건 실제로 가장 어려운 부분이 맞고, 연구로도 입증돼 있다:

- Berkeley RDI(2026-04): 주요 에이전트 벤치마크 전부 해킹 가능. 10줄짜리 `conftest.py`로 pytest 결과를 전부 "passed"로 조작해 SWE-bench 100% 달성 사례
- METR(2025): o3, Claude 3.7이 평가 런의 30%+에서 reward hacking (grader 몽키패치 등)
- 실전 사례: 에이전트가 테스트를 지우거나, 테스트를 약화시키거나, git log에서 정답을 베끼는 행동

실전 방어책 (조사된 프로덕션 패턴):

| 방어책 | 구현 |
|---|---|
| **테스트 파일 불변성 검사** | TEST 단계 완료 시 테스트 파일 체크섬 기록 → IMPL 단계 diff에 테스트 파일 변경이 있으면 즉시 게이트 실패 |
| **평가자 격리** | 테스트 실행은 에이전트 프로세스와 분리된 깨끗한 환경에서 (에이전트가 만든 conftest 류 오염 차단) |
| **결정적 done 판정** | `pnpm test && pnpm lint && tsc --noEmit` exit code만 인정 |
| **diff 스캔 규칙** | "테스트 수정 금지", "설정파일 수정 시 플래그" 등을 오케스트레이터가 diff 레벨에서 기계적으로 검사 |
| **리뷰어 모델 분리** | 구현자가 OpenAI면 리뷰어는 Claude — 같은 모델의 같은 맹점 공유 방지 |
| **null-agent 테스트** | 아무것도 안 하는 가짜 에이전트를 돌려서 게이트가 0점을 주는지 사전 검증 |

### 3.3 상태 관리: 큐 vs durable execution

- **BullMQ(Redis)**: 잡 전달 보장. 개인 규모에 충분, TS 네이티브. 진행상태는 SQLite/Postgres에 직접 기록
- **Temporal/Inngest**: 워크플로우 완료 보장(스텝 단위 재시작, 크래시 복구). 8시간+ 워크플로우가 서버 재시작에도 살아남아야 하면 고려
- **XState**: 상태머신 정의를 코드 아티팩트로 — 허용 전이와 게이트 로직의 single source of truth

추천: 1차 버전은 **SQLite + BullMQ + 단순 상태 enum**으로 시작. 상태머신이 복잡해지면 XState 도입, 운영이 커지면 Inngest/Temporal. 처음부터 Temporal은 오버엔지니어링이다.

### 3.4 스펙 주도(SDD) 도구 — SPEC 단계 참고자료

- **GitHub Spec Kit**: `/specify → /plan → /tasks → /implement` 4단계 + `/constitution`(프로젝트 헌법). 에이전트 불문 사용 가능 — SPEC/PLAN 단계 프롬프트 템플릿으로 그대로 차용할 만함
- **BMAD-METHOD** (MIT, 46k+ stars): Analyst/PM/Architect/Dev/QA 등 12+ 에이전트가 `story.md`, `arch.md` 같은 **파일 기반 통신**으로 협업 — 친구 시스템과 가장 유사한 오픈소스 레퍼런스
- **AWS Kiro**: EARS 표기법으로 요구사항 구조화. "모호한 스펙이 에이전트 실패의 1순위 원인"이라는 인사이트는 모든 도구 공통

---

## 4. 병렬 worktree 운영

### 기본 메커니즘

```bash
git worktree add ../web-agent-A-114 -b agent/A-114 origin/develop
# 작업 후
git worktree remove ../web-agent-A-114 && git worktree prune
```

`.git` 오브젝트 스토어는 공유, working tree와 index는 독립 — 에이전트 N개가 같은 repo를 동시에 편집해도 충돌 없음.

### 실전에서 터지는 것들 (경험 보고 종합)

- **node_modules 미존재**: worktree 생성 직후 `pnpm install` 필수. pnpm은 content-addressable store 덕에 두 번째부터는 거의 즉시 — **pnpm 모노레포면 worktree 패턴과 궁합이 가장 좋다**
- **.env 미상속**: gitignore된 파일은 안 따라옴 → worktree 셋업 스크립트에서 명시적 복사
- **포트 충돌**: dev 서버 전부 3000 기본 → worktree마다 포트 오프셋 할당
- **빌드 캐시 오염**: `.next/`, `tsconfig.tsbuildinfo`, Turborepo 캐시는 worktree별 분리 확인
- **index.lock 고아 파일**: 크래시 시 잔류 → teardown에서 `git worktree prune` 자동화
- **worktree 밖 파일 수정**: 에이전트가 다른 worktree 파일을 건드리는 사고 — 워커 실행 시 cwd 밖 쓰기를 차단하는 훅/샌드박스 설정 (Codex `--sandbox workspace-write`가 정확히 이 용도)

### 참고할 오픈소스

- **Claude Squad** (Go, MIT): Claude Code/Codex/Aider 멀티 인스턴스 + worktree 격리 TUI — 오케스트레이터 없이 수동 병렬화의 레퍼런스
- **container-use** (Dagger): worktree + Docker 컨테이너 페어링
- **OpenHands resolver / LangChain Open SWE**: 이슈 → 자율 PR 루프의 오픈소스 전체 구현 — 아키텍처 훔쳐볼 1순위
- **Spotify Honk 4부작 블로그**: LLM-as-judge 게이트 + 검증 레이어 설계 실전기 (1,500+ merged PR)

---

## 5. 멀티모델 추상화

### 게이트웨이 비교

| 도구 | 형태 | 강점 | 비고 |
|---|---|---|---|
| **LiteLLM Proxy** | 셀프호스트 (Docker) | 100+ 프로바이더, virtual key별 예산/비용 추적, config.yaml 모델 별칭, fallback 라우팅 (전부 검증됨) | Python. 개인 규모(<500 RPS)에 최적 |
| **OpenRouter** | 매니지드 | 모델 300+, 즉시 사용, 자동 fallback | 크레딧 충전 시 5.5% 수수료, BYOK 월 1M 요청 무료 후 5% (검증됨) |
| **Vercel AI SDK 6** | TS 라이브러리 | 프로바이더 추상화 + 모델 레지스트리 패턴, `ToolLoopAgent` | 직접 구축 시 LLM 레이어로 |
| Portkey / Helicone / Bifrost | 게이트웨이 | 관측성/성능 특화 | 개인 규모엔 과함 |

### 역할별 모델 매핑 패턴 (canonical)

```yaml
# pipeline.config.yaml
agents:
  spec_analyst:  { model: "openai/gpt-5",        engine: codex }
  planner:       { model: "openai/gpt-5",        engine: codex }
  test_writer:   { model: "openai/gpt-5-codex",  engine: codex }
  implementer:   { model: "openai/gpt-5-codex",  engine: codex }
  reviewer:      { model: "anthropic/claude-opus", engine: claude-code }  # 구현자와 다른 모델
defaults:
  retry_budget: 10
  timeout_minutes: 30
```

조사된 비용 최적화 패턴: triage/분류엔 저가 모델, 구현 루프엔 코딩 특화 모델, 계획/리뷰엔 플래그십 — 역할별 차등만으로 10~20x 비용 차이. 프롬프트 캐싱(정적 시스템 프롬프트를 앞에 배치)으로 추가 50~70% 절감. OpenAI는 자동 캐싱(50% 할인), Anthropic은 명시적 `cache_control`(읽기 90% 할인).

주의: 서브에이전트 리서치에 포함된 2026년 6월 시점 모델명/벤치마크 수치(GPT-5.4, Opus 4.8 등)는 2차 소스 기반이라 신뢰도가 낮다. **모델 선택은 구축 시점에 SWE-bench Pro / Terminal-Bench 최신 리더보드를 직접 확인**할 것. 설계가 config 기반이면 모델이 뭐가 됐든 한 줄 교체라 설계엔 영향 없다.

---

## 6. Jira 연동

### 필요한 API (전부 REST v3, 검증됨)

```
GET  /rest/api/3/issue/{key}              # 티켓 읽기 (설명, AC, 링크)
POST /rest/api/3/issue/search             # JQL 폴링
GET  /rest/api/3/issue/{key}/transitions  # 전이 ID 조회 (프로젝트별 상이)
POST /rest/api/3/issue/{key}/transitions  # 상태 전이
POST /rest/api/3/issue/{key}/comment      # 진행상황 코멘트 (ADF 포맷)
POST /rest/api/3/issue/{key}/remotelink   # PR 링크
POST /rest/api/3/webhook                  # 동적 webhook 등록 (OAuth 앱 전용)
```

- **인증**: 개인/서비스 계정이면 API 토큰(Basic auth)이 제일 단순. OAuth 3LO는 webhook 동적 등록이 필요할 때
- **트리거**: webhook(`jira:issue_updated` + assignee 변경 필터)이 정석이지만, 공인 IP 수신 엔드포인트가 필요. **개인 규모면 30~60초 JQL 폴링으로 시작 추천** — `assignee = "agent-bot" AND status = "To Do" AND labels = agent-ready` 같은 쿼리. 레이트리밋(시간당 65,000 포인트, 초당 100 req)에 한참 못 미침
- **Atlassian Remote MCP Server** (`https://mcp.atlassian.com/v1/mcp`, OAuth 2.1): MCP 지원 워커(Claude Code 등)를 쓰면 REST 직접 구현 없이 Jira 읽기/쓰기 가능
- **진행 보고 패턴**: 단계 전이마다 코멘트 (브랜치 생성됨 → 테스트 작성됨 → 구현 완료 → PR 링크). Jira가 그대로 audit trail이 됨
- **prior art**: Atlassian Rovo Dev가 정확히 이 루프(Jira 이슈 → 코드 → PR)의 매니지드 버전. 직접 만들면 모델 선택권/비용/커스텀 게이트를 갖는 게 차별점

---

## 7. 실행 환경 비교

| 옵션 | 비용 | 장점 | 단점 |
|---|---|---|---|
| **로컬 맥 상시 실행** (launchd + caffeinate + Tailscale) | 0원 | 회사 코드가 내 머신 밖으로 안 나감(LLM API 제외), 셋업 최소 | 머신 단일 장애점, 본인 작업과 리소스 경쟁 |
| **미니PC/홈서버** (Docker) | 초기 구매비만 | 24/7 독립, 내 네트워크 안 | 운영 부담 |
| **VPS** (Hetzner CX22 등) | 월 ~$5 | 24/7, webhook 공인 수신 가능 | **회사 코드가 외부 인프라로 나감** — 정책 확인 필수 |
| **GitHub Actions** | self-hosted 무료 | CI 통합 자연스러움 | hosted 6h 제한, 장시간 에이전트 잡엔 부적합 |
| **Copilot Coding Agent** (매니지드) | 구독 | 구축 0 | 커스텀 파이프라인/모델 선택 불가 — 우리가 만들려는 것의 기성품 |

**추천 경로**: 로컬 맥에서 시작(보안·비용 최소) → Tailscale로 폰/회사에서 대시보드 접근 + 티켓 투입 → 시스템이 검증되면 미니PC로 이전. VPS는 회사 코드 반출이라 비추.

### 보안 체크리스트 (회사 repo라서 중요)

1. **회사 AI 정책 먼저 확인** — 회사 코드를 OpenAI/Anthropic API로 보내는 것 자체가 허용되는지. 보통 enterprise 계약 + Zero Data Retention 조건이 붙음 (Anthropic 표준 보존 7일, ZDR은 계약 필요)
2. **봇 전용 GitHub 계정** — 개인 PAT 말고 최소 권한(브랜치 쓰기, PR 열기) 봇 계정
3. **브랜치 보호 = 최후 방어선** — main/develop에 human review 필수 설정. 에이전트는 draft PR까지만, self-merge 불가
4. **시크릿 격리** — 에이전트 worktree에 `.env` 원본 대신 더미/스코프 제한 값. egress 제한(Jira/GitHub/LLM API만 허용)은 Docker 단계에서
5. **키 관리** — 1Password CLI나 환경변수, 절대 repo 안에 넣지 않기

---

## 8. 추천 아키텍처 설계안

### 8.1 컴포넌트 구성

```
┌─────────────────────────────────────────────────────────────┐
│  Orchestrator (Node.js/TS, 로컬 맥 상시 실행)                  │
│                                                              │
│  ┌──────────┐   ┌───────────┐   ┌──────────────────────┐    │
│  │ Jira     │──▶│ Scheduler  │──▶│ Pipeline Runner       │    │
│  │ Poller   │   │ (의존성DAG │   │ (티켓당 상태머신)       │    │
│  │ (60s JQL)│   │  →큐 투입) │   │ SPEC→PLAN→TEST→IMPL→REV│   │
│  └──────────┘   └───────────┘   └──────┬───────────────┘    │
│       ▲              │                  │                    │
│       │         ┌────▼─────┐      ┌────▼──────────┐         │
│  ┌────┴─────┐   │ SQLite    │      │ WorkerEngine   │         │
│  │ Reporter │   │ (상태/로그 │      │ adapter        │         │
│  │ (코멘트/  │   │  /비용)   │      │ ┌────────────┐ │         │
│  │  전이)    │   └──────────┘      │ │codex exec  │ │         │
│  └──────────┘                     │ │claude -p   │ │         │
│                                   │ └────────────┘ │         │
│  ┌──────────────────────────┐     └────┬──────────┘         │
│  │ Dashboard (터미널 TUI나    │          │                     │
│  │ 웹, Tailscale로 원격 접근) │     ┌────▼──────────────┐      │
│  └──────────────────────────┘     │ ~/github/web-wt/   │      │
│                                   │  A-114/ A-115/ ... │      │
│                                   │  (worktree per 티켓)│      │
│                                   └───────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 티켓 1건의 라이프사이클

1. Poller가 `agent-ready` 라벨 + 본인 할당 티켓 발견 → DB에 job 생성, Jira "In Progress" 전이 + 코멘트
2. Runner가 worktree 생성: `git worktree add ../web-wt/A-114 -b agent/A-114 origin/develop` → `pnpm install` → `.env` 복사 → 포트 할당
3. **SPEC**: spec_analyst가 티켓 본문+repo 컨텍스트로 `_spec.md` 생성. 게이트: 필수 섹션(AC, 영향 파일, 비범위) 존재 검사 + LLM 판정
4. **PLAN**: `_spec.md` → `_plan.md` (파일 단위 변경 계획). 게이트: 계획 파일 존재 + 스키마 검사
5. **TEST**: 실패하는 테스트 작성 → 커밋. 게이트: `pnpm test` 가 **새 테스트만 실패**하는지 확인 + 테스트 파일 체크섬 기록
6. **IMPL**: 구현 루프 — `pnpm test && pnpm lint && tsc --noEmit` 통과까지 (budget 10회). 게이트: exit 0 + **테스트 파일 체크섬 불변** + diff 규칙 검사
7. **REVIEW**: 별도 모델 리뷰어가 diff + 루브릭으로 구조화 판정 `{verdict: APPROVE|CHANGES_REQUESTED, reasons[]}`. CHANGES_REQUESTED면 IMPL로 회귀(budget 차감)
8. push → `gh pr create --draft` → Jira에 PR remotelink + "In Review" 전이 → worktree 정리
9. 실패/budget 소진 시: Jira에 실패 사유 코멘트 + "Blocked" 라벨 → 사람 에스컬레이션

### 8.3 DB 스키마 (SQLite, 최소)

```sql
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  ticket_key TEXT UNIQUE,        -- A-114
  stage TEXT,                    -- SPEC|PLAN|TEST|IMPL|REVIEW|PR|FAILED|DONE
  gate_attempts INTEGER DEFAULT 0,
  worktree_path TEXT,
  branch TEXT,
  session_id TEXT,               -- 워커 세션 연속성
  test_checksums TEXT,           -- JSON: 테스트 파일 무결성
  cost_usd REAL DEFAULT 0,
  created_at TEXT, updated_at TEXT
);
CREATE TABLE events (             -- 모든 단계 전이/게이트 결과 로그
  id INTEGER PRIMARY KEY,
  job_id INTEGER, type TEXT, payload TEXT, created_at TEXT
);
```

### 8.4 구현 로드맵 (주말 단위)

| 단계 | 내용 | 산출물 |
|---|---|---|
| **W1: 단일 티켓 E2E** | Jira 폴링 → worktree 생성 → `codex exec` 1회 호출(IMPL만) → 테스트 실행 → draft PR → Jira 코멘트. 게이트는 exit code만 | 동작하는 최소 루프 |
| **W2: 파이프라인화** | 5단계 상태머신 + 파일 아티팩트 + retry budget + 단계별 프롬프트 템플릿(Spec Kit/BMAD 참고) | 단일 티켓 풀 파이프라인 |
| **W3: 통제 강화** | 테스트 체크섬 검사, diff 규칙, 리뷰어 모델 분리(Claude), 비용 추적 | 기만 방지 게이트 |
| **W4: 병렬화** | BullMQ 도입, in-flight N개, 포트/캐시 격리, TUI 대시보드(친구 스크린샷 스타일) | 병렬 fleet |
| **W5+: 운영** | Tailscale 원격 접근, 의존성 DAG 스케줄러, 실패 패턴 분석, (선택) Docker 샌드박스/미니PC 이전 | 상시 운영 |

W1을 가장 강조하고 싶다 — **오케스트레이터 없이 `codex exec` 한 번으로 티켓 하나를 끝까지 보내보는 것**부터. 거기서 게이트가 왜 필요한지, 프롬프트에 뭐가 부족한지가 전부 드러난다. 친구가 "통제가 제일 어려웠다"고 한 건 W3 영역이고, 이건 W1~W2 경험 없이는 설계할 수 없다.

### 8.5 비용 감각

- 조사된 경험 보고: 에이전트 10개 야간 가동 기준 2026년 $50~120/박 수준 (모델 선택에 따라 큰 편차)
- 역할별 차등 모델 + 프롬프트 캐싱으로 50~70% 추가 절감 가능
- Claude 구독 활용 시: 2026-06-15부터 SDK 헤드리스 사용은 별도 크레딧 풀(Max 5x 기준 $100/월 상당) — 야간 배치엔 부족할 수 있어 API 키 병행 설계 권장
- 처음엔 job별 `cost_usd` 추적을 W1부터 넣을 것. 비용 가시성 없이 병렬화하면 청구서로 배운다

---

## 9. 검증 노트 (신뢰도 표시)

1차 소스로 직접 확인된 사실: Codex `exec`/`--json`/SDK/서드파티 모델 지원, Claude Code 헤드리스 플래그/Agent SDK, Mastra 1.0, LiteLLM 기능 전반, OpenRouter 수수료(5.5%/BYOK 5%), Atlassian MCP 서버/webhook API, Anthropic 2026-06-15 크레딧 풀 변경, OpenHands MIT/헤드리스, AI SDK 6 `ToolLoopAgent`, GitHub Actions 시간 제한.

신뢰도 낮음(2차 소스, 구축 시점에 재확인 필요): 2026년 6월 모델명·벤치마크 수치·가격표, 개별 도구의 star 수, 일부 블로그 기반 비용 수치.

---

## Sources

### 워커 엔진
- [Claude Code headless 공식 문서](https://code.claude.com/docs/en/headless)
- [Claude Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Codex non-interactive mode (OpenAI)](https://developers.openai.com/codex/noninteractive)
- [Codex SDK (OpenAI)](https://developers.openai.com/codex/sdk)
- [Codex 서드파티 모델 지원](https://developers.openai.com/codex/models)
- [openai/codex (GitHub, 오픈소스)](https://github.com/openai/codex)
- [OpenHands headless mode](https://docs.openhands.dev/openhands/usage/run-openhands/headless-mode)
- [mini-SWE-agent (GitHub)](https://github.com/SWE-agent/mini-swe-agent)
- [Aider](https://aider.chat) · [Goose](https://github.com/block/goose) · [OpenCode](https://github.com/anomalyco/opencode)

### 오케스트레이션·게이트
- [Mastra 1.0 발표](https://mastra.ai/blog/announcing-mastra-1) · [Workflow suspend/resume](https://mastra.ai/en/docs/workflows/suspend-and-resume)
- [OpenAI Agents SDK JS](https://github.com/openai/openai-agents-js)
- [Temporal + OpenAI Agents SDK GA](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- [Inngest AgentKit](https://github.com/inngest/agent-kit) · [When a queue isn't enough](https://www.inngest.com/blog/when-a-queue-isnt-enough)
- [Berkeley RDI: 벤치마크 해킹 보고서](https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont/)
- [METR: reward hacking 평가](https://metr.org/blog/2025-06-05-recent-reward-hacking/)
- [Factory.ai TDD droid 오케스트레이션](https://medium.com/@silas_27632/how-to-make-droids-code-for-hours-using-test-driven-development-and-smart-orchestration-in-factory-a-40838d66e048)
- [GitHub Spec Kit (EPAM 분석)](https://www.epam.com/insights/ai/blogs/inside-spec-driven-development-what-githubspec-kit-makes-possible-for-ai-engineering)
- [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) · [statelyai/agent (XState)](https://github.com/statelyai/agent)

### worktree 병렬화·사례
- [Spotify Honk: background coding agent](https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1)
- [mabl: 75+ repo 에이전트 운영기](https://www.mabl.com/blog/how-we-built-a-system-for-ai-agents-to-ship-real-code-across-75-repos)
- [Mike McQuaid: sandboxed agent worktrees 셋업](https://mikemcquaid.com/sandboxed-agent-worktrees-my-coding-and-ai-setup-in-2026/)
- [pnpm + git worktrees](https://pnpm.io/git-worktrees)
- [Claude Squad](https://github.com/smtg-ai/claude-squad) · [container-use (Dagger)](https://github.com/dagger/container-use) · [LangChain Open SWE](https://github.com/langchain-ai/open-swe)
- [Augment: worktree 병렬 실행 가이드](https://www.augmentcode.com/guides/git-worktrees-parallel-ai-agent-execution)

### 멀티모델
- [LiteLLM virtual keys](https://docs.litellm.ai/docs/proxy/virtual_keys) · [cost tracking](https://docs.litellm.ai/docs/proxy/cost_tracking)
- [OpenRouter FAQ (수수료)](https://openrouter.ai/docs/faq) · [BYOK 1M 무료](https://openrouter.ai/announcements/1-million-free-byok-requests-per-month)
- [Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6) · [ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [프로바이더별 프롬프트 캐싱 비교 (PromptHub)](https://www.prompthub.us/blog/prompt-caching-with-openai-anthropic-and-google-models)

### Jira·실행환경·보안
- [Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) · [rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/) · [webhooks](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-webhooks/)
- [Atlassian Remote MCP Server](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/getting-started-with-the-atlassian-remote-mcp-server/)
- [Atlassian Rovo Dev](https://www.atlassian.com/software/rovo-dev)
- [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits)
- [Copilot coding agent](https://docs.github.com/copilot/concepts/agents/coding-agent/about-coding-agent)
- [Anthropic API 데이터 보존 정책](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
- [Anthropic Agent SDK 크레딧 변경 (2026-06-15)](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
- [Tailscale로 맥 원격 접근](https://dev.to/jagafarm/reach-your-home-mac-from-anywhere-with-tailscale-so-claude-code-can-come-with-you-1077)
