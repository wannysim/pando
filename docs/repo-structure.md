# 레포 구조 설계 — multi-repo background coding agent orchestrator

> 작성일: 2026-06-06 · 전제: [v1 리서치](./agent-driven-dev-workflow-research.md), [v2 설계안](./agent-workflow-design-v2-multi-repo.md)
> 결정사항: 로컬 우선(홈서버 Docker는 후반 로드맵) · 단일 레포 · SQLite-only(Redis 없음) · 구현 전 구조 리뷰

---

## 1. 단일 레포 가능 여부 → 가능

오케스트레이터 데몬, CLI, 설정, 프롬프트, 문서, (추후) 대시보드, (추후) Docker 구성까지 전부 한 레포에 담는 데 문제 없다. 의도적으로 **밖에 두는 것** 두 가지만 명확히 하면 된다:

| 밖에 두는 것 | 이유 | 연결 방식 |
|---|---|---|
| `~/.ai-skills` | 이미 독립 관리 중인 스킬 레포. 복제하면 이중 관리 | 프롬프트 템플릿에서 경로 참조 (`skills_root` 설정값) |
| `~/.worktrees`, 대상 레포들 | 작업 산출물/대상이지 시스템 코드가 아님 | `repos.yaml`의 `path` |
| 시크릿 (.env) | 커밋 금지 | `.env` + `.env.example` 커밋 |

---

## 2. 디렉터리 구조

```
~/Github/{name}/
├── package.json              # pnpm, Node 22+, TypeScript strict
├── tsconfig.json
├── .env.example              # JIRA_API_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY ...
│
├── config/
│   ├── repos.yaml            # RepoProfile 목록 (v2 §1)
│   ├── stages.yaml           # 단계별 engine/model 매핑 + 전역 기본값 (v2 §4)
│   └── orchestrator.yaml     # global cap, poll 주기, worktree root, skills_root
│
├── src/
│   ├── index.ts              # 데몬 엔트리 (W2부터)
│   │
│   ├── core/                 # 순수 도메인 — 외부 의존 없음
│   │   ├── types.ts          # WorkItem, RepoProfile, StageName, GateResult, JobState
│   │   ├── state-machine.ts  # SPEC→PLAN→TEST→IMPL⇄REVIEW→PR 전이 규칙, retry budget
│   │   └── artifacts.ts      # _spec.md / PLAN.md / 게이트 결과 스키마 정의·검증
│   │
│   ├── db/
│   │   ├── schema.sql        # jobs, events, repos (v1 스키마 + repo/source/depends_on)
│   │   └── index.ts          # better-sqlite3 래퍼 (동기 API — 단순함이 장점)
│   │
│   ├── scheduler/
│   │   ├── scheduler.ts      # global cap / per-repo cap / DAG leaf 선별
│   │   ├── semaphore.ts      # 인프로세스 카운팅 세마포어 (MCP rate cap 포함)
│   │   └── repo-mutex.ts     # .git/.dispatch.lock 호환 파일락 (worktree-dispatch §5)
│   │
│   ├── intake/
│   │   ├── jira-poller.ts    # JQL 폴링 → WorkItem (source: jira)
│   │   └── brief.ts          # briefs/*.md 감시 + CLI 투입 → WorkItem (source: brief)
│   │
│   ├── pipeline/
│   │   ├── runner.ts         # 잡 1개의 단계 실행 루프 (상태머신 구동)
│   │   ├── stages/           # 단계별 정의: 프롬프트 조립 + 게이트
│   │   │   ├── spec.ts
│   │   │   ├── plan.ts       # implement-jira --batch 호출 조립
│   │   │   ├── test.ts
│   │   │   ├── impl.ts
│   │   │   ├── review.ts
│   │   │   └── pr.ts
│   │   └── gates/            # 기계 판정만 모음 (LLM 출력 신뢰 금지 원칙)
│   │       ├── exit-code.ts        # gates.test/lint/types 실행
│   │       ├── artifact-schema.ts  # _spec.md/PLAN.md 필수 섹션 검사
│   │       ├── checksum.ts         # 테스트 파일 불변성
│   │       └── diff-rules.ts       # 금지 경로 수정 검사
│   │
│   ├── engines/
│   │   ├── engine.ts         # WorkerEngine 인터페이스 (v1 §2)
│   │   ├── claude-code.ts    # claude -p, claude.ai connector 상속(--mcp-config 금지)
│   │   └── codex.ts          # codex exec --json
│   │
│   ├── worktree/
│   │   └── manager.ts        # 데몬 모드 생성(origin ref 직접 분기, v2 §3.2),
│   │                         #   setup 훅(.env 복사/install/포트), cleanup
│   │                         #   경로 규약은 worktree-dispatch §1과 호환
│   │
│   ├── reporters/
│   │   ├── jira.ts           # 코멘트/전이/remotelink (REST v3)
│   │   └── log.ts            # events 테이블 + 콘솔 (brief 레포 기본)
│   │
│   └── cli/
│       └── agentctl.ts       # 아래 §4 명령들
│
├── prompts/                  # 단계 워커에게 줄 프롬프트 템플릿 (.md, 변수 치환)
│   ├── spec-from-brief.md    # 신규 (v2 §7-5의 brief-intake 상당)
│   ├── impl-from-plan.md     # 신규 (PLAN.md → 구현 루프)
│   └── review-rubric.md      # verifier를 구조화 JSON 출력으로 감싼 버전
│
├── briefs/                   # 개인 프로젝트 기획 인박스 (gitignore 선택)
│   └── {id}/brief.md, assets/
│
├── scripts/                  # W1 헤드리스 검증용 단발 스크립트 (데몬 이전)
│   ├── 01-worktree.sh
│   ├── 02-plan-headless.sh   # claude -p "/implement-jira X --batch" 검증
│   ├── 03-impl-codex.sh
│   └── 04-gates.sh
│
├── docs/                     # 본 문서들 + ADR
│   ├── research-v1.md
│   ├── design-v2-multi-repo.md
│   ├── repo-structure.md     # 이 문서
│   └── adr/                  # 결정 기록 (001-sqlite-only.md ...)
│
├── dashboard/                # (후반) TUI 또는 웹. 비워두고 시작
└── deploy/                   # (후반) 홈서버용 docker-compose.yml, Dockerfile
```

---

## 3. 핵심 인터페이스 (구현 전 합의용)

```typescript
// core/types.ts — 전체 시스템이 공유하는 계약

export type StageName = "SPEC" | "PLAN" | "TEST" | "IMPL" | "REVIEW" | "PR";
export type JobStatus = StageName | "QUEUED" | "DONE" | "FAILED" | "ESCALATED";

export interface WorkItem {
  id: string;                          // "AP-1234" | "personal-site-20260606-a"
  repo: string;                        // repos.yaml 키
  source: "jira" | "brief" | "github_issue";
  title: string;
  branch?: string;
  dependsOn?: string[];
  payload:
    | { kind: "jira"; ticketKey: string }
    | { kind: "brief"; briefPath: string; assets?: string[] }
    | { kind: "github_issue"; owner: string; repo: string; issueNumber: number };
}

export interface RepoProfile {
  path: string;
  scope: "acme" | "external";
  baseBranch: string;
  intake: { sources: ("jira" | "brief" | "github_issue")[] };
  context: {
    providers: ("confluence" | "figma")[];
    policyRefs: string[];
  };
  workItemSource: "jira" | "brief" | "github_issue"; // legacy primary source
  contextProviders: ("confluence" | "figma")[];       // legacy provider list
  conventions: string;                 // 스킬 이름 or "repo-local"
  setup: string;
  gates: { test: string; lint?: string; types?: string };
  concurrency: number;
  portRange: [number, number];
  envFiles?: string[];
  guards: { protectedBranches: string[]; forbidTestEditInImpl: boolean };
}

export interface WorkerEngine {
  run(opts: {
    cwd: string;                       // worktree 경로
    prompt: string;
    model: string;
    sessionId?: string;                // 단계 간 세션 연속성
    mcpConfig?: string;                // claude-code 전용
    outputSchema?: object;             // 구조화 출력 강제
    timeoutMs: number;
    env?: Record<string, string>;      // IMPLEMENT_JIRA_BATCH=1 등
  }): Promise<{
    ok: boolean;
    sessionId?: string;
    costUsd?: number;
    output: string;                    // 최종 메시지 (게이트 판정엔 사용 금지)
  }>;
}

export interface Gate {
  name: string;
  check(ctx: { worktree: string; job: Job; profile: RepoProfile }): Promise<GateResult>;
}
export interface GateResult { pass: boolean; reason?: string; evidence?: string }

export interface StageDefinition {
  name: StageName;
  buildPrompt(ctx: StageContext): string;      // prompts/ 템플릿 + 아티팩트 조립
  engine(ctx: StageContext): WorkerEngine;     // stages.yaml 매핑 해석
  gates: Gate[];                               // 전부 pass해야 전이
  budget: number;                              // 기본 orchestrator.yaml에서
}
```

상태머신 전이 규칙 (core/state-machine.ts):

```
QUEUED → SPEC → PLAN → TEST → IMPL → REVIEW → PR → DONE
                 │              ▲       │
                 │              └───────┘ CHANGES_REQUESTED (budget 차감)
                 └→ ESCALATED  (PLAN의 Open Questions에 blocking 항목)
任意 단계: budget 소진 or 게이트 연속 실패 → FAILED → 보고
```

---

## 4. CLI 설계 (`agentctl`)

```bash
agentctl submit jira AP-1234 [--repo web]        # 수동 투입 (poller 외)
agentctl submit brief --repo personal-site           # $EDITOR로 brief 템플릿 열기 → 저장 시 투입
agentctl list [--repo web] [--status in-flight]  # 친구 스크린샷의 그 화면 (텍스트판)
agentctl show AP-1234                            # 단계/게이트/이벤트 로그 상세
agentctl retry AP-1234 [--from IMPL]             # 특정 단계부터 재시작
agentctl cancel AP-1234
agentctl cleanup [--merged-only]                 # worktree-dispatch §8 호환
agentctl daemon                                  # 데몬 기동 (W2)
```

`dispatch --list`/`--cleanup`과 디렉터리 규약이 같으므로 기존 스킬과 상호 운용됨.

---

## 5. 로컬 실행 모델 (Redis 없음)

- **단일 Node 프로세스** 데몬. 동시성은 인프로세스 세마포어(global/per-repo/per-provider 3계층)
- 워커는 `child_process.spawn`으로 `claude -p` / `codex exec` 실행 — 동시 N개는 자식 프로세스라 이벤트 루프 부담 없음
- 상태는 전부 SQLite (WAL 모드). 데몬이 죽어도 jobs 테이블에서 재개 — 단계 시작 전 상태만 기록하면 단계 단위 재실행으로 충분 (단계는 멱등: worktree가 이미 있으면 재사용)
- 큐 인터페이스만 분리해두면 홈서버 단계에서 BullMQ 교체 가능하지만, **단일 머신이면 SQLite로 끝까지 가도 무방** — Docker 전환의 실체는 "맥 → 리눅스 컨테이너 + 영속 볼륨"이지 큐 교체가 아님

### 홈서버 전환 시 변경점 (deploy/, 후반 로드맵)

```yaml
# deploy/docker-compose.yml 개요 (미래)
services:
  orchestrator:   # 이 레포 그대로. SQLite 볼륨 마운트
  # repo 클론들을 named volume으로, ~/.worktrees도 볼륨
  # 시크릿은 .env → docker secrets
```
주의점만 미리 기록: 컨테이너 안에서 `claude`/`codex` CLI 설치·인증(API 키 모드), Atlassian OAuth 토큰 갱신, git 자격증명(deploy key 권장), pnpm store 볼륨 공유.

---

## 6. W1 진입 기준 (이 구조 승인 후 첫 작업)

구현 순서는 v2 로드맵 그대로, 단 `scripts/` 4개를 레포 첫 커밋에 포함:

1. `01-worktree.sh` — web 레포에서 origin/develop 분기 worktree 생성+setup (데몬 방식 검증)
2. `02-plan-headless.sh` — **최대 리스크 검증**: `claude -p "/implement-jira AP-X --batch"`가 claude.ai managed connector를 상속해 비대화형에서 PLAN.md를 만들어내는가. Atlassian MCP 인증이 헤드리스에서 살아있는가
3. `03-impl-codex.sh` — PLAN.md 주고 `codex exec --json --sandbox workspace-write`로 구현 1회
4. `04-gates.sh` — pnpm test/lint/tsc + 테스트 체크섬 비교

4개가 전부 통과하면 W2(데몬)는 이 스크립트들의 TS 이식 + 상태머신 결합이라 리스크가 거의 없다.

---

## 7. 리뷰 포인트 (확인 필요)

1. **prompts/ vs ~/.ai-skills 경계**: 단계 프롬프트 신규분(impl-from-plan 등)을 이 레포 prompts/에 둘지, .ai-skills에 스킬로 추가할지. 제안: **오케스트레이터 전용(비대화형 전제)은 이 레포, 대화형으로도 쓸 것은 .ai-skills** 기준
2. brief 인박스(briefs/)를 레포에 커밋할지 gitignore할지 — 개인 기획이 GitHub(private이어도)에 올라가는 게 괜찮은지
3. 대시보드를 TUI(터미널, 친구 스타일)로 갈지 웹(Tailscale 폰 접근에 유리)으로 갈지 — W4 전까지 결정하면 됨
