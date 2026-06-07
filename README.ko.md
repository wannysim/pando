# pando

[English](./README.md) | 한국어

pando는 하나 이상의 Git 레포를 대상으로 로컬 daemon에서 코딩 에이전트 작업을
실행합니다. 격리된 git worktree를 만들고, 각 작업을 단계별 pipeline으로
진행하며, 운영용 API/dashboard와 SQLite 기반 queue 상태를 제공합니다.

```text
SPEC -> PLAN -> TEST -> IMPL <-> REVIEW -> PR (draft)
```

Gate 판정은 exit code, 파일, checksum, 구조화 JSON 같은 결정적 evidence만
사용합니다. LLM output text는 pass/fail 신호로 사용하지 않습니다.

## 요구사항

- Node.js `>=22.13.0`.
- `package.json`에 고정된 package manager인 `pnpm@11.5.2`.
- `git`.
- 인증이 준비된 Claude Code CLI(`claude`). 기본 pipeline은 모든 stage에서
  Claude Code를 사용합니다.
- `gh auth status`가 통과하는 GitHub CLI(`gh`). PR stage에서 `gh`를
  사용합니다.
- 선택 사항: container 점검용 Docker, optional worker smoke/adapter 경로용
  Codex CLI.

임시 DB, worktree, smoke evidence는 `/tmp` 아래에 두세요. 기본 local runner는
이 방식을 사용합니다.

## 설치

이 repository snapshot에서는 checkout script를 사용하세요.

```bash
git clone https://github.com/wannysim/pando.git
cd pando
corepack enable
corepack prepare pnpm@11.5.2 --activate
pnpm install
```

checkout에서 전역 명령을 선택적으로 연결할 수 있습니다.

```bash
pnpm link --global
pandoctl start
```

repo에는 build 가능한 `packages/pandoctl` 배포본도 포함되어 있습니다. public
npm package가 이 checkout보다 늦을 수 있으므로, 설치된 `pandoctl` version이 이
문서와 일치한다는 것을 알고 있을 때만 사용하고 기본은 checkout command를
사용하세요.

배포된 global command를 사용 중이라면 아래처럼 업데이트합니다.

```bash
npm update -g pandoctl
```

## 로컬 실행

local daemon/API를 시작합니다.

```bash
pnpm pando start
```

시작 로그에는 다음 정보가 출력됩니다.

- API health URL, 일반적으로 `http://127.0.0.1:3210/health`.
- Dashboard URL, 일반적으로 `http://127.0.0.1:3210/dashboard`.
- `/tmp/pando-local-<timestamp>/pando.sqlite` 아래의 SQLite DB path.
- `/tmp/pando-local-<timestamp>/worktrees` 아래의 worktree root.
- 종료와 cleanup 방법.

Port `3210`이 사용 중이면 pando가 다음 빈 port를 찾아 실제 사용한 URL을
출력합니다.

자세한 runner 설명: [docs/runbooks/local-pando-runner.md](./docs/runbooks/local-pando-runner.md).

## Dashboard 사용

Dashboard는 pando server가 dashboard asset을 서빙할 때 동작합니다. 예를 들어
Docker image를 사용하거나 `PANDO_STATIC_DASHBOARD_ROOT`가 build된 dashboard
directory를 가리키는 경우입니다.

source checkout에서는 아래 흐름이 가장 직접적입니다.

```bash
pnpm pando start
VITE_PANDO_API_URL=http://127.0.0.1:3210 pnpm --filter @pando/dashboard dev
```

Vite가 출력한 `/dashboard/`로 끝나는 dashboard URL을 여세요.

기본 intake 경로는 dashboard의 인라인 자연어 brief form입니다.

Dashboard에서 작업을 제출하는 방법:

1. "Describe a task" form을 사용합니다.
2. `Task repo`를 입력합니다. 예: `pando`.
3. 고유한 `Task ID`를 입력합니다. 예: `readme-demo`.
4. 구현할 내용을 자연어로 쓰고, spec/doc/asset reference를 한 줄에 하나씩
   추가합니다.
5. Submit하면 pando가 repo 밖에 canonical `brief.md`를 materialize하고 job을
   queue에 넣습니다.

Job list와 detail view에서 status, stage event, worktree path, duration,
deterministic evidence를 확인할 수 있습니다.

## CLI 사용

`pandoctl`은 operator CLI입니다. checkout에서는 `pnpm pandoctl`로 실행합니다.

실행 중인 API를 통해 job을 list/watch 합니다.

```bash
PANDO_API_URL=http://127.0.0.1:3210 pnpm pandoctl list
PANDO_API_URL=http://127.0.0.1:3210 pnpm pandoctl watch readme-demo
PANDO_API_URL=http://127.0.0.1:3210 pnpm pandoctl daemon status
```

자세한 event history는 `pando start`가 출력한 DB path를 사용합니다.

```bash
PANDO_DB=/tmp/pando-local-<timestamp>/pando.sqlite pnpm pandoctl show readme-demo
```

Terminal workflow에서는 file-backed brief 제출도 사용할 수 있습니다.

```bash
mkdir -p briefs/readme-demo
cat > briefs/readme-demo/brief.md <<'EOF'
# README Demo

## Goal

Make a small documentation-only change.

## User Story

As an operator, I want a clear local run check so that I can verify pando quickly.

## Acceptance Criteria

- [ ] The change is documented.

## Screens or Behavior

No UI change.

## Non-Goals

- Do not change source code.

## Assets

- None

## Open Questions

- None
EOF

PANDO_DB=/tmp/pando-local-<timestamp>/pando.sqlite \
  pnpm pandoctl submit brief \
  --repo pando \
  --id readme-demo \
  --branch chore/readme-demo \
  --brief-path briefs/readme-demo/brief.md
```

실행 중인 daemon의 읽기/action에는 `PANDO_API_URL`을 우선 사용하세요. File-backed
submit, `show`, worktree cleanup 같은 offline/local DB operation에는 `PANDO_DB`를
사용합니다.

## 종료와 Cleanup

- `pnpm pando start`를 실행 중인 terminal에서 `Ctrl-C`로 daemon을 종료합니다.
- 시작 로그에 출력된 run root를 삭제합니다. 예:

```bash
rm -rf /tmp/pando-local-<timestamp>
```

- pando를 통해 단일 job worktree만 cleanup하려면 같은 DB path를 사용합니다.

```bash
PANDO_DB=/tmp/pando-local-<timestamp>/pando.sqlite pnpm pandoctl cleanup readme-demo
```

## Smoke 및 Readiness 점검

Host readiness smoke는 secret을 출력하지 않고 worker CLI availability, auth
signal, mount/path readiness, concurrency cap을 점검합니다.

```bash
pnpm pandoctl smoke readiness --target host \
  --evidence /tmp/pando-readiness-smoke/host.json
```

Credential 없이 deterministic smoke evidence가 필요하면 fake mode를 사용합니다.

```bash
PANDO_GLOBAL_CONCURRENCY=2 \
  pnpm smoke:two-job -- --mode fake \
  --evidence /tmp/pando-two-job-fake.json
```

Live worker와 Docker smoke는 유효한 local/container auth가 필요합니다. 자세한 내용:
[docs/runbooks/two-job-smoke.md](./docs/runbooks/two-job-smoke.md).

## 제한 사항

- pando는 local/private-network 도구입니다. Public API auth는 구현되어 있지
  않습니다.
- 기본 pipeline은 Claude Code auth를 기대하며 model credit을 사용할 수
  있습니다.
- PR stage는 `gh`를 통해 commit 생성, branch push, draft PR 생성을 수행할 수
  있습니다.
- Docker live worker에는 container에서 보이는 CLI auth나 API key가 필요합니다.
  Host-managed auth가 container로 전달되지 않을 수 있습니다.
- Checkout의 `pando start` 경로는 daemon/API를 시작합니다. Dashboard serving은
  위에서 설명한 build된 dashboard asset 또는 Vite dev server가 필요합니다.

## 보안 메모

Daemon/API를 public internet에 노출하지 마세요. Secret은 brief, log, docs,
committed file에 넣지 마세요. Smoke evidence는 `/tmp` 아래에 두고, boolean auth
signal 또는 secret이 아닌 구조화 detail만 기록하세요.

## 추가 문서

문서 지도부터 시작하세요: [docs/README.md](./docs/README.md).
