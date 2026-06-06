# Local pando runner

이 runbook은 로컬에서 pando API/dashboard를 띄운 뒤, 같은 SQLite queue를 local daemon loop가 처리하게 하는 최소 경로다.

> 빠른 경로는 아래 "Quick start (`pando start`)"다. 단일 명령으로 DB/worktree/config/dashboard/daemon을 함께 띄운다. 환경 변수를 직접 제어하고 싶거나 동작을 자세히 이해하고 싶으면 그 아래 "Start local pando (manual env path)"를 본다. 두 경로는 같은 기본값(`/tmp/pando-local-<timestamp>` run root, `config/`, port 3210, daemon enabled)을 쓴다.

## Quick start (`pando start`)

긴 env block 없이 로컬 pando를 한 번에 띄운다.

```bash
pnpm pando start
```

기본 동작:

- DB/worktree는 `/tmp/pando-local-<timestamp>` 아래에 생성된다 (run root와 `worktrees/` 디렉터리는 자동으로 만든다).
- config dir은 repo의 `config/`다.
- dashboard는 `http://127.0.0.1:3210/dashboard`다.
- daemon은 enabled, global concurrency 1이다.

시작 로그가 dashboard URL, API health URL, DB path, worktree root, stop 방법(Ctrl+C), cleanup 명령(`rm -rf /tmp/pando-local-<timestamp>`)을 출력한다. secret 값은 출력하지 않는다.

플래그로 기본값을 바꿀 수 있다.

```bash
pnpm pando start --port 4000 --config-dir config --concurrency 3 --tick-ms 500
```

- `--concurrency`는 1~3만 허용한다.
- 요청한 port가 이미 사용 중이면 다음 빈 port를 자동으로 찾아 그 URL을 로그에 찍는다. 10개 안에 빈 port가 없으면 명확한 에러로 종료하니 `--port <n>`으로 다른 port를 고른다.

usage는 인자 없이, 또는 `help`/`--help`로 본다.

```bash
pnpm pando help
```

### Global `pando` / `pandoctl` commands

repo 안에서 매번 `pnpm pando` / `pnpm pandoctl`을 치는 대신 전역 명령으로 만들 수 있다. 이 repo의 `package.json` `bin`은 두 명령을 모두 노출한다 — `pando`(데몬 부트스트랩)와 `pandoctl`(운영 CLI).

```bash
# repo 안에서 한 번 실행
pnpm link --global
# 또는
npm i -g .

# 이후 어디서든
pando start            # 로컬 daemon/dashboard 부트스트랩
pando help
pandoctl list          # 운영 CLI (submit/list/show/retry/cancel/cleanup/...)
pandoctl show <id>
```

> 참고: bare 이름 `pando`는 이미 public npm registry에 점유돼 있다(ADR-010). 그래서 **배포되는 CLI 이름은 `pandoctl`**이고, npm에 placeholder로 예약돼 있다(#43). 위 `pnpm link --global` / `npm i -g .`는 이 repo의 `package.json` `bin`(`pando`+`pandoctl`)을 그대로 링크하므로 local self-dogfood에 바로 쓸 수 있다. 빌드/번들된 `pandoctl` npm 패키지 publish는 별도 작업이다(roadmap PR 10).

## Start local pando (manual env path)

아래는 동작을 직접 제어하고 싶을 때 쓰는 자세한 개발자용 경로다.

## Preconditions

- `pnpm install` 완료
- `claude`, `gh`, `git` CLI 사용 가능 (`codex` optional — all-Claude profile에서는 불필요)
- `gh auth status` 통과
- Claude auth는 로컬 auth dir 또는 API key로 준비
- evidence나 임시 DB는 repo 밖(`/tmp` 등)에 둔다

### Boot with env vars

```bash
export RUN_ID="$(date +%Y%m%d-%H%M%S)"
export ROOT="/tmp/pando-local-runner-$RUN_ID"
mkdir -p "$ROOT/worktrees"

PANDO_DB="$ROOT/pando.sqlite" \
PANDO_CONFIG_DIR=config \
PANDO_WORKTREE_ROOT="$ROOT/worktrees" \
PANDO_DAEMON_ENABLED=1 \
PANDO_DAEMON_TICK_MS=1000 \
PANDO_GLOBAL_CONCURRENCY=1 \
PANDO_PORT=3210 \
  pnpm start
```

Open dashboard:

```bash
open http://127.0.0.1:3210/dashboard
```

## Submit a brief

In another terminal, reuse the same `ROOT` value.

```bash
mkdir -p briefs/pando-small-task
$EDITOR briefs/pando-small-task/brief.md

PANDO_DB="$ROOT/pando.sqlite" \
  pnpm pandoctl submit brief \
  --repo pando \
  --id pando-small-task \
  --branch chore/pando-small-task \
  --brief-path briefs/pando-small-task/brief.md
```

> CLI는 `pandoctl`이다 (ADR-010, npm 예약 이름). `bin/pandoctl.mjs`가 운영 CLI(`src/cli/agentctl.ts`)를 tsx로 실행하며, `pnpm pandoctl ...` / 전역 `pandoctl ...` / `pnpm tsx src/cli/agentctl.ts ...`는 모두 같은 진입점이다. 내부 모듈 이름은 ADR-010에 따라 당분간 `agentctl`로 유지한다.

현재 dashboard submit도 같은 모델이다. 즉 "brief 파일 경로"를 이미 만들어 둔 뒤 queue에 넣는다. 제품 UX 목표는 웹에서 자연어 작업 설명, 참고할 spec/docs/assets path를 입력하면 pando가 canonical `brief.md`를 생성하고 queue에 넣는 것이다. file-path submit은 advanced/debug path로 남긴다.

## Watch status

```bash
PANDO_API_URL=http://127.0.0.1:3210 \
  pnpm pandoctl list

PANDO_DB="$ROOT/pando.sqlite" \
  pnpm pandoctl show pando-small-task
```

## PR behavior

The `PR` stage is a real worker stage. It asks Claude Code to:

1. run `pnpm verify`
2. commit with an English message
3. push the branch
4. create a Draft PR against the repo base branch with `gh pr create`

Do not expose this server outside a private local network. Public auth is intentionally not implemented.

## Current friction found by self-dogfood

- The long env-var boot is now optional; `pnpm pando start` (or the global `pando start`) covers the common local path. The env-var path stays for fine-grained control.
- To run multiple pando self-dogfood jobs concurrently, jobs should be queued before starting the daemon, and both `PANDO_GLOBAL_CONCURRENCY` and the repo profile `concurrency` must allow the desired count.
- The PR stage prompt says Draft PR, but recent self-dogfood produced non-draft PRs. Add a deterministic check or force `gh pr create --draft`.
- Evidence and temporary DB/worktrees should stay under `/tmp`; do not commit them.
