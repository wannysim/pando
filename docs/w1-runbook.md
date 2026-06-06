# W1 런북 — 헤드리스 검증 (네 맥에서 직접 실행)

> 목적: 데몬을 만들기 전에 4가지 가설을 손으로 검증한다 (docs/repo-structure.md §6).
> 전부 통과하면 W2(데몬)는 이 스크립트들의 TS 이식이라 리스크가 거의 없다.

## 사전 준비

```bash
cd ~/Github/pando

# 1. MCP 헤드리스 config 준비
mkdir -p ~/.pando
cp config/mcp-headless.example.json ~/.pando/mcp-headless.json
claude mcp list   # ← 출력을 보고 서버 키/URL을 실제 값으로 맞춘다
                  #    (Atlassian이 플러그인 경유면 그 설정을 그대로 옮긴다)

# 2. 검증용 티켓 선정: 작고 독립적인 AP-* 티켓 1개 (UI 없는 게 1차로 적합)
```

## Step 1 — worktree 생성 (원본 repo 무간섭 확인)

```bash
./scripts/01-worktree.sh ~/Github/web AP-XXXX develop
```

확인할 것: `~/.worktrees/web/feat-AP-XXXX` 생성, lockfile 감지 기반 install 완료, **원본 ~/Github/web의 체크아웃/working tree가 그대로인지** (네가 작업 중이어도 간섭 없어야 함).

## Step 2 — implement-jira 헤드리스 (최대 리스크)

```bash
./scripts/02-plan-headless.sh ~/.worktrees/web/feat-AP-XXXX AP-XXXX
```

| 결과 | 의미 | 다음 행동 |
|---|---|---|
| PLAN.md 생성됨 | MCP 헤드리스 주입 성공 — 설계 그대로 진행 | Step 3 |
| MCP 인증 실패 | Atlassian OAuth가 비대화형에서 안 풀림 | `claude mcp` 재인증 후 재시도. 그래도 안 되면 **SPEC 수집을 Jira REST 직접 호출로 대체** (ADR 추가 필요) |
| 스킬을 못 찾음 | `/implement-jira`가 헤드리스에서 미로드 | `.ai-skills` 설치 경로 확인. `--bare` 플래그를 쓰고 있지 않은지 확인 (auto-discovery 필요) |

비용 주의: 2026-06-15부터 구독 기반 `claude -p`는 별도 Agent SDK 크레딧 차감. API 키 모드면 `ANTHROPIC_API_KEY` 설정 후 실행.

## Step 3 — Codex 구현 1회

```bash
./scripts/03-impl-codex.sh ~/.worktrees/web/feat-AP-XXXX
```

확인할 것: workspace-write 샌드박스가 worktree 밖을 안 건드리는지, JSON 이벤트 스트림이 파싱 가능한 형태인지 (`/tmp/pando-impl-result.txt`).

## Step 4 — 게이트

```bash
# TEST 단계 직후 시점 가정: 체크섬 기록
./scripts/04-gates.sh ~/.worktrees/web/feat-AP-XXXX

# IMPL 후: 체크섬 비교 + test/lint/types
./scripts/04-gates.sh ~/.worktrees/web/feat-AP-XXXX
```

## 기록

각 스텝 결과(성공/실패/걸린 시간/비용/특이사항)를 이 파일 하단에 추가 → W2 설계 입력값이 된다.

### 실행 로그

#### 2026-06-06 · 1차 헤드리스 검증 (macOS, claude 2.1.167)

검증 티켓: **AP-1234** [Web] admin·a-peach Jest 환경 구성 (Task / To Do / issuelink·subtask 0 = 독립적 / 비-UI → Atlassian MCP만 필요).

**사전 준비 발견**
- `flock` 이 macOS 미설치 → `brew install flock`(0.4.0). fd 모드(`flock -w 30 9`) 정상 동작. (W2 TS 이식 시 `proper-lockfile` 등으로 대체해 외부 의존 제거 권장)
- MCP는 `claude.ai config` 스코프 managed connector("claude.ai Atlassian"/"claude.ai Figma"). 이름에 공백 포함, `claude mcp get atlassian` 불가, URL/토큰 비노출.

**Step 1 — worktree 생성: ✅ PASS**
- `~/.worktrees/web/feat-AP-1234` 생성(origin/develop=<sha>). 원본 web(`feat/example`, HEAD <sha>) **무간섭 확인**(branch/HEAD/dirty 전부 불변). `.dispatch.lock` 규약 준수.
- ⚠️ **결함 발견·수정**: `01-worktree.sh`가 `pnpm install` 하드코딩인데 web은 **yarn@1.22.19 모노레포**. setup 훅을 lockfile 감지(yarn/pnpm/npm)로 수정했고, 이후 `config/repos.yaml`도 PM-agnostic action(`install/test/lint/typecheck`)으로 정리했다.
- yarn install 39.9s, node_modules 1.8G / 1168 pkgs.

**Step 2 — implement-jira 헤드리스: ✅ PASS** (스크립트 원형은 FAIL → 방식 정정 후 통과)

| 시도 | 구성 | 결과 |
|---|---|---|
| 1차 (원형) | `--mcp-config ~/.pando/mcp-headless.json` + `--allowedTools "Read,Glob,Grep,Write,Bash(git *)"` | ❌ FAIL — 주입한 `atlassian`이 **OAuth 미인증 새 서버**가 됨. authenticate 도구만 노출 → guardrail abort, PLAN.md 미생성. $0.86 |
| 미니 진단 | `--mcp-config` 없이 `atlassianUserInfo` 직접 호출 | ✅ claude.ai connector **헤드리스 상속 확인**(dev@… 반환). $0.21 |
| 2차 (정정) | `--mcp-config` **제거** + `--allowedTools "…,Task,mcp__claude_ai_Atlassian"` | ✅ **PASS** — PLAN.md 생성(4-PR Stacked Roadmap, 실제 repo·release/x.y 대조). $1.58 / 26 turns |

**🔑 핵심 결론 (W2 설계 직결)**
1. **헤드리스 Atlassian MCP는 `--mcp-config` 주입이 아니라 사용자 claude.ai connector 상속으로 써야 한다.** 동일 URL을 `--mcp-config`로 주면 미인증 새 서버가 생겨 인증을 깬다. → `02-plan-headless.sh`의 `--mcp-config` 라인 제거 필요. `config/mcp-headless.example.json`의 주입식 전제는 폐기 또는 ADR로 재정의(데몬이 별도 머신이면 그 머신에서 `claude` 1회 로그인으로 connector 확보).
2. allowedTools에 **`Task`(서브에이전트)** + **`mcp__claude_ai_Atlassian`(서버)** 필수. jira-context-gatherer가 Task로 호출된다.
3. `Bash(git *)`만으론 부족 — 계획 중 `cat | python3`·`echo; git show | sed` 복합/파이프 명령이 거부됨(Read로 우회했으나 turn 낭비). 데몬은 Bash 화이트리스트를 넓히거나 Read 계열로 충분히 커버.
4. implement-jira **batch mode 정상 작동** — 질문 없이 Open Questions로 미룸, PLAN.md 산출. 스킬 auto-discovery·repo-scope(acme 판정) 헤드리스에서 정상.
5. **base branch 이슈**: PLAN의 [Blocker] — AP-1234는 `develop`이 아니라 `release/x.y` 기반이어야 함(AP-1234 커밋 미포함). `RepoProfile.baseBranch` 고정값 가정이 티켓별로 틀릴 수 있음 → 인입 시 티켓 fixVersion/base 결정 로직 필요.

→ **최대 리스크(헤드리스 PLAN 생성) 검증 완료.**

#### 2026-06-06 · Step 3 codex 구현 검증 (gpt-5.5, AP-1234 PR1)

`03-impl-codex.sh`로 codex가 PLAN.md의 PR 1(pts·a-components jest config 표준화)을 구현. (⚠️ 03/04 스크립트의 완료기준이 한때 `pnpm`이라 yarn 모노레포와 불일치했다. 이후 04 게이트는 lockfile 감지 기반으로 정리했고, `repos.yaml`의 `gates`도 PM-agnostic action으로 정리했다.)

**결과: ✅ codex IMPL 검증 — ADR-002(IMPL=codex) 실측 통과**
- ✅ 샌드박스 격리: `--sandbox workspace-write`가 worktree 밖(origin web `<sha>`/pando) 무간섭. 정확히 대상 2개 파일만 수정.
- ✅ JSON 이벤트 스트림 파싱 가능 (`thread.started`→`item.*`→`turn.completed`). `-o`로 최종 메시지 별도 저장.
- ✅ 구현 품질 우수:
  - pts: 주석 전부 제거, `coverageDirectory` 제거, `.next` ignore 유지
  - a-components: `node_modules` ignore·`coverageDirectory` 제거
  - **Open Question 자가 검증**: codex가 `typescript-config/nextjs.json`을 직접 열어 `jsx: preserve ≠ react-jsx` 불일치 확인 → PLAN의 "불일치 시 inline 유지" 조건대로 inline tsconfig **유지**. planning 의도를 구현에서 정확히 이어받음.
  - **객관 게이트**: a-components `yarn … test` → **93 tests passed** (config 리팩터가 동작 무변경).
- ⚠️ 미세 이탈: 두 config 순서를 *일관* 통일했으나 티켓 명시 순서(`moduleNameMapper`→`setupFilesAfterEnv`)와 반대로 통일. 기능 무해 → **결정적 게이트로 미검출 → REVIEW 단계 필요 사례** (IMPL⇄REVIEW 루프 정당성 입증).

**🔑 게이트 스코핑 (W2 설계 입력 6)**
- pts `yarn test`는 codex 변경과 무관하게 **baseline(stash 후)에서도 동일 실패**: 기존 테스트 깨짐 + `MAX_LENGTH.INPUT_FIELD` undefined(패키지 의존성/base 이슈).
- 함의: 게이트가 **전체 test**를 돌리면 "해당 PR이 안 건드린 기존 실패"를 IMPL 실패로 오판. → 게이트를 **변경 워크스페이스/파일로 스코프**(turbo affected 등) 필수.

→ **Step 3 검증 완료.** Step 4 체크섬 게이트는 PR1이 테스트 파일 무수정이라 메커니즘만 자명 — 별도 실행 생략.
