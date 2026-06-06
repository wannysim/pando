# pando 실사용 전환 로드맵

> 작성일: 2026-06-07 · 목적: pando를 "직접 써볼 수 있는 도구"에서 "실제로 일을 맡길 수 있는 도구"로 올리는 다음 작업 묶음

## 현재 경계

현재 pando는 아래까지 확인됐다.

- Hono API와 Vite dashboard를 단일 Node server에서 띄울 수 있다.
- Docker HTTP/API/static dashboard smoke가 통과했다.
- Host에서 실제 `claude`/`codex` CLI worker 2-job probe가 통과했다.
- worker readiness/live smoke evidence는 structured JSON으로 남긴다.

아직 아래는 안 됐다.

- `src/server.ts`가 production daemon loop를 돌리지 않는다. 지금 server는 API/static dashboard entrypoint다.
- dashboard/API로 job을 넣으면 DB에 queued job이 생기지만, real `runDaemonOnce` + real worker engines + worktree provisioner + gates가 상시 실행되지는 않는다.
- `config/repos.yaml`에 pando self-profile이 없다. 즉 `repo: pando`로 queued job을 넣을 수는 있어도 full daemon 실행 시 repo profile lookup에서 막힌다.
- Docker image 안에는 `claude`/`codex` CLI와 auth volume이 없다.

따라서 다음 목표는 "멋진 UI"가 아니라 **host에서 pando가 자기 자신을 대상으로 2개 job만 안전하게 실행하는 최소 경로**다. 그 다음에 dashboard/terminal/README를 사용자용으로 다듬는다.

## 요구사항 요약

- pando self-dogfooding: pando repo 자체를 brief 기반 target repo로 등록하고, host daemon 경로에서 2개 job만 실행한다.
- Dashboard UX: queued/running/failed 상태와 readiness blocker를 눈으로 이해할 수 있어야 한다.
- Terminal UX: `agentctl`로 submit/list/show/retry/cancel/cleanup/status/smoke 흐름을 빠르게 확인할 수 있어야 한다.
- README/getting started: 처음 보는 사용자가 5분 안에 dashboard를 열고, fake/readiness/live smoke 중 하나를 실행할 수 있어야 한다.
- 결정은 계속 deterministic evidence를 기준으로 한다. LLM output text를 pass/fail로 쓰지 않는다.

## Stacked PR Roadmap

### PR 1: pando self-profile and full daemon smoke contract

- Focus: Foundations + Data/Logic
- Files:
  - `config/repos.yaml`
  - `scripts/` 또는 `src/daemon/`의 host-only smoke entrypoint
  - `tests/unit` 또는 `tests/integration`의 daemon smoke wiring contract
- Work:
  - `pando` RepoProfile을 brief-only target으로 추가한다.
  - host-only daemon smoke가 `runDaemonOnce`를 real worktree provisioner, real stage config, real engines, deterministic gates와 연결할 수 있는 최소 계약을 만든다.
  - exactly 2 jobs, global cap 2 또는 3, `/tmp` evidence output만 허용한다.
- Acceptance:
  - queued job 2개만 claim된다.
  - worktree paths가 충돌하지 않는다.
  - provider cap 초과가 없다.
  - gate evidence가 structured JSON으로 남는다.
  - `pnpm verify` 통과.
- Commit:
  - `chore: add pando self daemon smoke contract`

### PR 2: host full daemon live pipeline smoke

- Focus: Integration
- Depends on: PR 1
- Files:
  - `scripts/full-daemon-smoke.mjs` 같은 수동 smoke script
  - `docs/runbooks/two-job-smoke.md`
  - `docs/handoff.md`
- Work:
  - pando self-profile을 대상으로 brief 2개를 enqueue한다.
  - host에서 real worker engines를 낮은 cap으로 실행한다.
  - 아직 production server loop가 아니어도 된다. 먼저 수동 smoke script로 full daemon path를 고정한다.
- Acceptance:
  - `mode=live-daemon` evidence가 `/tmp`에 생성된다.
  - job count는 정확히 2다.
  - terminal status, stage event, cost/duration/failure payload가 DB events에 남는다.
  - 실패 시 fallback reason이 구체적이다.
- Commit:
  - `chore: run host daemon live smoke`

### PR 3: dashboard operations UX pass

- Focus: Atomic UI + Integration
- Depends on: PR 1~2
- Files:
  - `dashboard/src/*`
  - `src/api/schema.ts`, `src/api/app.ts` if response shape needs small additions
  - dashboard unit tests
- Work:
  - empty state를 "what to do next"가 아니라 실제 action 중심으로 정리한다.
  - jobs list에서 status, stage, repo, attempts, updated time, latest reason/evidence를 scan하기 쉽게 만든다.
  - job detail에서 timeline, gate evidence, worktree path, worker cost/duration을 바로 보이게 한다.
  - retry/cancel/cleanup button은 가능한 상태에서만 활성화하고, 불가능하면 reason을 보여준다.
  - health/readiness panel에 host/docker worker readiness summary를 표시한다.
- Acceptance:
  - dashboard에서 queued/running/failed/escalated/done을 한 화면에서 구분할 수 있다.
  - failed/escalated job의 deterministic evidence를 copy 없이 읽을 수 있다.
  - mobile viewport에서도 주요 text가 겹치지 않는다.
  - dashboard tests와 `pnpm verify` 통과.
- Commit:
  - `feat(dashboard): improve operations workflow`

### PR 4: terminal UX and smoke commands

- Focus: Data/Logic + Integration
- Depends on: PR 1~2
- Files:
  - `src/cli/agentctl.ts`
  - `scripts/two-job-smoke.mjs`
  - CLI tests
- Work:
  - `agentctl smoke readiness --target host|docker` 또는 동등한 명령을 추가한다.
  - `agentctl watch <job-id>` 또는 `agentctl list --watch`를 검토한다. full-screen TUI는 아직 보류하고, line-oriented terminal UX를 먼저 만든다.
  - `agentctl show` 출력에서 latest failure/evidence/cost/duration을 더 읽기 좋게 정리한다.
- Acceptance:
  - terminal에서 submit -> list -> show -> retry/cancel/cleanup 흐름이 README 예시 그대로 동작한다.
  - smoke/readiness 명령은 secret 값을 출력하지 않는다.
  - API-backed mode와 local DB mode 차이가 문서화된다.
- Commit:
  - `feat(cli): add operator smoke commands`

### PR 5: README and getting started page

- Focus: Docs + polish
- Depends on: PR 1~4 중 실제 동작하는 범위
- Files:
  - `README.md`
  - `README.ko.md`
  - `docs/getting-started.md`
  - `docs/practical-adoption-roadmap.md`
- Work:
  - README의 stale status를 현재 상태로 고친다.
  - "5-minute local dashboard" 섹션을 추가한다.
  - "fake smoke / readiness smoke / host live worker smoke / full daemon smoke" 차이를 표로 설명한다.
  - command reference를 `agentctl`, `pnpm smoke:two-job`, Docker로 나눈다.
  - 공개 OSS 사용자에게 필요한 prerequisites(Node, pnpm, Docker optional, Claude/Codex optional)를 명확히 쓴다.
- Acceptance:
  - 처음 보는 사용자가 README만 보고 dashboard를 열 수 있다.
  - secrets를 커밋하지 말라는 경고가 명확하다.
  - current limitations가 과장 없이 적혀 있다.
- Commit:
  - `docs: add getting started guide`

### PR 6: Docker worker readiness hardening

- Focus: Deployment
- Depends on: host daemon smoke가 먼저 통과한 뒤 착수
- Files:
  - `deploy/Dockerfile`
  - `deploy/docker-compose.yml`
  - `deploy/README.md`
  - `docs/runbooks/two-job-smoke.md`
- Work:
  - Docker image에 worker CLI를 설치할지, host-mounted CLI/auth volume을 쓸지 결정한다.
  - Claude managed connector 상속이 container에서 가능한지 확인한다.
  - 안 되면 API key mode 또는 Jira REST fallback을 별도 ADR 후보로 남긴다.
  - git credentials mount/deploy key 방식을 문서화한다.
- Acceptance:
  - Docker target readiness blocker가 CLI/auth/gits 중 무엇인지 구조화 evidence로 남는다.
  - Docker live worker smoke를 실행하지 못하면 이유와 최소 다음 작업이 명확하다.
- Commit:
  - `chore(docker): document worker readiness path`

## Dashboard UX 기준

Dashboard는 marketing page가 아니라 operator console이다.

- 첫 화면은 job table이어야 한다.
- decorative hero나 큰 설명 card보다 상태 scan이 우선이다.
- 주요 상태는 color만으로 구분하지 않는다. text label과 timestamp를 함께 둔다.
- detail 화면은 "이 job이 왜 멈췄는가"를 10초 안에 알 수 있어야 한다.
- evidence는 raw JSON을 숨기지 말고, 기본은 사람이 읽기 쉬운 key-value로 보여준다.
- submit brief는 최소 필드로 시작하되, validation 실패 reason을 즉시 보여준다.

## Terminal UX 기준

초기에는 full-screen TUI보다 line-oriented CLI가 낫다. 이유는 API/DB/event 계약이 아직 빠르게 변하기 때문이다.

우선순위:

1. `agentctl daemon status`
2. `agentctl list --status <status>`
3. `agentctl show <job-id>`
4. `agentctl submit brief --repo pando --id <id>`
5. `agentctl smoke readiness --target host|docker`
6. `agentctl watch <job-id>` 또는 `agentctl list --watch`

full-screen TUI는 위 command가 안정된 뒤 W6 후보로 둔다.

## 처음 사용자를 위한 README 구조

README는 아래 순서가 좋다.

1. What is pando?
2. Current status and limitations
3. Prerequisites
4. Install
5. Start local dashboard
6. Submit a preview brief
7. Run smoke checks
8. Understand the pipeline
9. Configuration overview
10. Development and contribution

`docs/getting-started.md`는 README보다 자세히 쓴다. README는 5분 안에 성공하는 경로만 둔다.

## pando에게 이 작업을 시키는 방법

### 지금 당장 가능한 방식

지금은 dashboard/API에 job을 넣을 수 있지만 full daemon execution은 아직 붙지 않았다. 그래서 pando에게 일을 "완전히 자동으로" 맡기기 전까지는 아래 방식이 맞다.

1. 새 Codex/Claude 세션을 연다.
2. `docs/next-session-prompt.md`를 그대로 붙여 넣는다.
3. 이번 문서(`docs/practical-adoption-roadmap.md`)를 읽고 PR 1부터 진행하라고 시킨다.
4. 작업이 끝나면 `pnpm verify`, smoke evidence, docs/handoff 업데이트, English commit을 요구한다.

붙여 넣을 수 있는 짧은 지시:

```text
CLAUDE.md, docs/handoff.md, docs/practical-adoption-roadmap.md, docs/next-session-prompt.md를 읽고 develop 최신 상태에서 시작해줘.

목표는 docs/practical-adoption-roadmap.md의 PR 1이야.
TDD로 pando self-profile과 host full daemon smoke contract를 먼저 고정하고, 가능하면 2-job smoke까지 실행해줘.
비밀값은 출력/커밋하지 말고, evidence는 /tmp 아래에 남겨줘.
완료 후 pnpm verify를 통과시키고 English commit message로 커밋해줘.
```

### full daemon wiring 이후 방식

PR 1~2가 끝난 뒤에는 pando 자신에게 brief를 넣는 방식으로 전환한다.

예상 흐름:

```bash
mkdir -p briefs/pando-dashboard-ops-ux
$EDITOR briefs/pando-dashboard-ops-ux/brief.md

pnpm tsx src/cli/agentctl.ts submit brief \
  --repo pando \
  --id pando-dashboard-ops-ux \
  --title "Improve dashboard operations UX"

PANDO_API_URL=http://127.0.0.1:3210 \
  pnpm tsx src/cli/agentctl.ts list
```

주의: 이 흐름은 `config/repos.yaml`에 `pando` self-profile이 추가되고, daemon execution wiring이 붙은 뒤에만 실제 구현까지 진행된다. 지금은 queued job과 dashboard preview까지만 확인할 수 있다.

## 다음 결정

다음 작업은 **PR 1: pando self-profile and full daemon smoke contract**로 시작한다. dashboard/terminal/README polish는 full daemon path가 최소 1번 통과한 뒤가 맞다.
