# pando 실사용 전환 로드맵

> 작성일: 2026-06-07 · 목적: pando를 "직접 써볼 수 있는 도구"에서 "실제로 일을 맡길 수 있는 도구"로 올리는 다음 작업 묶음

## 현재 경계

현재 pando는 아래까지 확인됐다.

- Hono API와 Vite dashboard를 단일 Node server에서 띄울 수 있다.
- Docker HTTP/API/static dashboard smoke가 통과했다.
- Host에서 실제 `claude`/`codex` CLI worker 2-job probe가 통과했다.
- PR #28에서 `pando` self-profile과 host full-daemon contract smoke가 develop에 반영됐다.
- PR #29에서 host full-daemon live 2-job smoke와 단일 pando self-dogfood job이 develop에 반영됐다.
- PR #36~#38에서 pando가 concurrency 3 self-dogfood batch로 README/getting-started, dashboard operations context, agentctl operations status 작업을 끝까지 돌리고 PR까지 만들었다.
- worker readiness/live smoke evidence는 structured JSON으로 남긴다.

아직 아래는 남아 있다.

- local daemon loop는 `PANDO_DAEMON_ENABLED=1`로 켤 수 있지만, 실행 명령이 너무 복잡하다. `pando start` 같은 단일 명령이 없다.
- dashboard brief submit은 여전히 "brief 파일 경로" 중심이다. 사용자가 웹에 자연어 요청과 spec/doc 참고를 넣으면 pando가 canonical brief를 만들고 queue에 넣는 UX가 아니다.
- pando self-dogfood는 가능해졌지만, prompt/schema/tooling을 여러 번 손봐야 했다. 자가개발을 안정적으로 반복하려면 worker stage observability와 UX가 더 필요하다.
- Docker image 안에는 `claude`/`codex` CLI와 auth volume이 없다.
- npm 배포 경로가 없다. CLI는 `pandoctl`로 점유했지만(ADR-010), 사용자가 `npm i -g pandoctl`로 설치해 `pandoctl start`/`pandoctl list`를 쓰는 경로는 미구현이다. 명령 표면도 `pando`/`pandoctl`/`agentctl`로 갈려 있고, 빌드 단계와 `better-sqlite3` native 의존성 처리가 남아 있다. → PR 10.

따라서 다음 목표는 "새 기능 확장"이 아니라 **자가개발을 사람이 다시 돌리고 싶을 만큼 단순하게 만드는 것**이다. 우선순위는 one-command local run → web inline brief intake → docs/README parity → dashboard/agentctl review follow-up → Docker worker readiness 순서다.

## 요구사항 요약

- pando self-dogfooding: pando repo 자체를 brief 기반 target repo로 등록하고, host daemon 경로에서 2개 job만 실행한다.
- Docs consistency: handoff, roadmap, next-session prompt, runbook이 PR #29 이후 상태를 같은 말로 설명해야 한다.
- Dashboard UX: queued/running/failed 상태와 readiness blocker를 눈으로 이해할 수 있어야 한다.
- Terminal UX: `agentctl`로 submit/list/show/retry/cancel/cleanup/status/smoke 흐름을 빠르게 확인할 수 있어야 한다.
- README/getting started: 처음 보는 사용자가 5분 안에 dashboard를 열고, fake/readiness/live smoke 중 하나를 실행할 수 있어야 한다.
- Web brief UX: 사용자가 file path가 아니라 자연어 요청, spec/doc reference, asset reference를 입력하면 pando가 canonical brief를 만들 수 있어야 한다.
- Local start UX: 환경 변수 긴 블록 없이 pando daemon/dashboard를 시작할 수 있어야 한다.
- 결정은 계속 deterministic evidence를 기준으로 한다. LLM output text를 pass/fail로 쓰지 않는다.

## Stacked PR Roadmap

### Done: PR 1 — pando self-profile and full daemon smoke contract

- Focus: Foundations + Data/Logic
- Status: ✅ 완료, develop 반영(PR #28)
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

### Done: PR 2 — host full daemon live pipeline smoke

- Focus: Integration
- Depends on: PR 1
- Status: ✅ 완료, develop 반영(PR #29)
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

### Done: PR 3 — docs consistency after dogfood

- Focus: Docs
- Depends on: PR 1~2
- Status: ✅ 완료, develop 반영(PR #30). 이후 PR #36~#38 결과와 실행 UX 발견사항을 이 문서에서 다시 반영.
- Files:
  - `docs/practical-adoption-roadmap.md`
  - `docs/next-session-prompt.md`
  - `docs/handoff.md`
  - `docs/runbooks/two-job-smoke.md` if needed
- Work:
  - PR #28/#29 완료 상태를 roadmap과 next-session prompt에 반영한다.
  - 다음 우선순위를 docs consistency, dashboard operations UX, terminal UX, README/getting-started, Docker worker readiness 순서로 정렬한다.
  - "full daemon smoke가 아직 안 됐다"처럼 PR #29 이후 상태와 충돌하는 문구를 제거한다.
  - 다음 세션 목표를 pando self-dogfood로 작은 문서/운영 UX 작업을 돌리는 흐름으로 정리한다.
- Acceptance:
  - docs가 host full-daemon contract/live dogfood 완료 상태를 일관되게 설명한다.
  - 남은 한계는 operations UX, local start UX, Docker worker readiness처럼 실제로 남은 항목만 말한다.
  - `pnpm format:check` 통과.
  - 가능하면 `pnpm verify` 통과.
- Commit:
  - `docs: update roadmap after full daemon dogfood`

### Done: PR 4 — dashboard operations UX pass

- Focus: Atomic UI + Integration
- Depends on: PR 3
- Status: ✅ 1차 완료, develop 반영(PR #37). Follow-up 필요.
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

Follow-up:
- Branch display는 worktree slug가 아니라 API의 `job.branch`를 우선한다.
- Event row에 `payload.durationMs`/`payload.costUsd`를 사람이 읽는 형태로 보여준다.
- Evidence truncation과 copy-to-clipboard를 추가한다.
- #37 tests는 AC 주석 중심이라 실제 사용자 동작 assertion을 더 강화한다.

### Done: PR 5 — terminal UX first pass

- Focus: Data/Logic + Integration
- Depends on: PR 3
- Status: ✅ 1차 완료, develop 반영(PR #38). Follow-up 필요.
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

Follow-up:
- `agentctl watch <job-id>` 또는 `agentctl list --watch`를 추가한다.
- `agentctl smoke readiness --target host|docker`를 검토한다.
- API-backed mode와 local DB mode의 차이를 README/runbook에 더 명확히 쓴다.

### Done: PR 6 — README and getting started page

- Focus: Docs + polish
- Depends on: PR 3~5 중 실제 동작하는 범위
- Status: ✅ 1차 완료, develop 반영(PR #36). README.ko parity는 이 문서 정리에서 보완.
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

Follow-up:
- README.md와 README.ko.md는 같은 local run/status/limitations를 계속 유지한다.
- README는 아직 runbook으로 넘기는 부분이 많다. `pando start`가 생기면 5분 경로를 실제 단일 명령 중심으로 다시 쓴다.

### PR 7: one-command local run

- Focus: Operator UX + Integration
- Depends on: PR #35 runtime prompt/tool fix
- Files:
  - `src/cli/agentctl.ts` 또는 새 CLI entrypoint
  - `src/server.ts`
  - `package.json`
  - `docs/runbooks/local-pando-runner.md`
  - CLI/server tests
- Work:
  - `pando start` 또는 `pnpm pando start`에 해당하는 단일 local start command를 만든다.
  - 기본값은 `/tmp/pando-local-{timestamp}` DB/worktree, `config/`, dashboard `3210`, daemon enabled, global concurrency 1~3이다.
  - 시작 로그에 dashboard URL, DB path, worktree root, stop 방법, cleanup 방법을 출력한다.
  - 이미 포트가 사용 중이면 명확한 에러 또는 대체 포트를 제공한다.
- Acceptance:
  - README/runbook의 local start path가 긴 env block 없이 동작한다.
  - command가 secret 값을 출력하지 않는다.
  - local daemon/dashboard/API health가 한 명령으로 확인된다.
- Commit:
  - `feat(cli): add local pando start command`

### PR 8: web inline brief intake

- Focus: Product UX + Intake
- Depends on: one-command local run
- Files:
  - `dashboard/src/*`
  - `src/api/app.ts`
  - `src/intake/brief.ts`
  - tests
  - docs/runbooks
- Work:
  - dashboard에서 brief file path 대신 자연어 요청 textarea를 기본 입력으로 둔다.
  - spec/docs/assets reference를 텍스트로 함께 넣을 수 있게 한다.
  - API가 inline brief를 받아 canonical `brief.md`를 repo 밖 configured inbox 또는 `/tmp`에 materialize한 뒤 WorkItem payload에 연결한다.
  - 기존 file-path brief submit은 advanced mode로 남긴다.
- Acceptance:
  - 사용자가 "무엇을 구현할지"와 "어디를 참고할지"만 입력해도 queue에 들어간다.
  - 생성된 brief는 기존 brief schema gate를 통과한다.
  - validation 실패 reason이 dashboard에 표시된다.
  - secrets를 저장하거나 출력하지 않는다.
- Commit:
  - `feat(dashboard): add inline brief intake`

### PR 9: Docker worker readiness hardening

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

### PR 10: pandoctl npm distribution

- Focus: Distribution
- Depends on: PR 7 one-command local run(#41, `pando start` 머지됨), CLI name 결정(ADR-010 / #46)
- Files:
  - `packages/pandoctl/package.json`
  - `src/cli/pando.ts`, `src/cli/agentctl.ts` (또는 통합 entrypoint)
  - 빌드 설정 (tsdown/tsup 등) + `package.json`
  - `docs/runbooks/local-pando-runner.md`, `README*`
  - CLI/bin tests
- 맥락:
  - npm의 `pando`는 외부에 선점됨 → 배포 바이너리는 `pandoctl`이다(ADR-010, placeholder `pandoctl@0.0.1` #43).
  - 현재 명령 표면이 셋으로 갈려 있다: `pando start`(데몬 부트스트랩, `src/cli/pando.ts`, 로컬 `bin/pando.mjs` shim·private) · `pnpm pandoctl <ops>`(ops 클라이언트 alias → `src/cli/agentctl.ts`, #46) · 내부 식별자 `agentctl`. 배포 시 `pando` bin은 publish되지 않으므로(루트 private) 이걸 정리해야 한다.
- Work:
  - **명령 표면 통합** — published 바이너리는 `pandoctl` 하나. `pandoctl start`(현 `pando start`) + `pandoctl submit/list/show/retry/cancel/cleanup`(현 agentctl)을 한 바이너리의 서브커맨드로 합친다. 로컬 `pando`/`pandoctl` 이원화를 해소한다.
  - **빌드 단계** — 지금은 `tsx`로 TS 직접 실행. 배포 패키지는 컴파일/번들된 JS + shebang bin을 담는다.
  - **`bin.pandoctl` 재연결** — `packages/pandoctl/package.json`의 bin을 placeholder stub → 빌드된 통합 진입점으로 교체.
  - **native 의존성 처리** — `better-sqlite3`는 native 모듈이라 글로벌 설치 시 prebuilt/node-gyp가 필요. 번들+prebuild로 갈지, sqlite 어댑터를 순수 JS로 교체할지 결정(ADR-001과 엮임 → 필요 시 새 ADR).
  - **실제 버전 publish** — `0.1.0`을 placeholder `0.0.1` 위에 publish.
- Acceptance:
  - `npm i -g pandoctl` (또는 `npx pandoctl`) 후 `pandoctl start` / `pandoctl list`가 동작한다.
  - 글로벌 설치가 native dep 빌드 실패 없이 끝난다(또는 실패 시 구조화된 이유와 다음 작업이 명확하다).
  - placeholder 시절 alias(`pnpm pandoctl`, `pando start`)와의 차이가 README/runbook에 일관되게 설명된다.
  - `pnpm verify` 통과.
- Commit:
  - `feat(cli): unify command surface under pandoctl`
  - `chore(release): publish pandoctl 0.1.0`

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

PR #36~#38 이후에는 작은 문서/운영 UX 작업을 pando self-dogfood batch로 끝까지 돌릴 수 있다. 다만 아직 사용자가 기대하는 "웹에 자연어로 할 일을 넣으면 알아서 brief/spec를 만들고 실행"하는 UX는 아니다. 현재 방식은 operator가 `/tmp` run root, config, concurrency, brief 파일 경로, daemon env를 직접 관리하는 개발자용 경로다.

1. 새 Codex/Claude 세션을 연다.
2. `docs/next-session-prompt.md`를 그대로 붙여 넣는다.
3. 이번 문서(`docs/practical-adoption-roadmap.md`)를 읽고 현재 첫 우선순위부터 진행하라고 시킨다.
4. pando self-dogfood를 사용할 경우, jobs를 먼저 queue에 넣고 daemon을 concurrency 2~3으로 켜야 같은 tick에서 병렬 처리된다.
5. 작업이 끝나면 `pnpm verify`, `/tmp` structured evidence, docs/handoff 업데이트, English commit을 요구한다.

붙여 넣을 수 있는 짧은 지시:

```text
CLAUDE.md, docs/handoff.md, docs/practical-adoption-roadmap.md, docs/next-session-prompt.md를 읽고 develop 최신 상태에서 시작해줘.

목표는 self-dogfood를 사람이 다시 쓰기 쉽게 만드는 작은 작업 하나야.
우선순위는 one-command local run → web inline brief intake → README/docs parity → dashboard/agentctl follow-up이야.
비밀값은 출력/커밋하지 말고, evidence는 /tmp 아래에 남겨줘.
완료 후 pnpm verify를 통과시키고 English commit message로 커밋해줘.
```

### self-dogfood 방식

작은 작업은 pando 자신에게 brief를 넣는 방식으로 전환할 수 있다. 현재는 아직 file-path 기반이라 아래처럼 brief 파일을 먼저 만든다.

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

주의: 현재 runbook 경로는 env var가 길다. `pando start`가 생기기 전까지는 `docs/runbooks/local-pando-runner.md`를 따른다. 동일 tick에서 여러 job을 병렬 처리하려면 daemon 시작 전에 jobs를 queue에 넣고, `PANDO_GLOBAL_CONCURRENCY`와 repo profile `concurrency`를 둘 다 올린다.

## 다음 결정

다음 작업은 **PR 7: one-command local run**으로 시작한다. 그 다음은 web inline brief intake → README/docs parity → dashboard/agentctl follow-up → Docker worker readiness 순서가 맞다.
