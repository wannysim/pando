# Local pando runner

이 runbook은 로컬에서 pando API/dashboard를 띄운 뒤, 같은 SQLite queue를 local daemon loop가 처리하게 하는 최소 경로다.

> 현재 이 절차는 의도적으로 자세한 개발자용 경로다. 실제 사용 UX 목표는 `pando start` 또는 `pnpm pando start` 같은 단일 명령으로 DB/worktree/dashboard/daemon을 함께 띄우는 것이다. 그 전까지는 아래 env var 경로를 source of truth로 둔다.

## Preconditions

- `pnpm install` 완료
- `claude`, `gh`, `git` CLI 사용 가능 (`codex` optional — all-Claude profile에서는 불필요)
- `gh auth status` 통과
- Claude auth는 로컬 auth dir 또는 API key로 준비
- evidence나 임시 DB는 repo 밖(`/tmp` 등)에 둔다

## Start local pando

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
  pnpm tsx src/cli/agentctl.ts submit brief \
  --repo pando \
  --id pando-small-task \
  --branch chore/pando-small-task \
  --brief-path briefs/pando-small-task/brief.md
```

현재 dashboard submit도 같은 모델이다. 즉 "brief 파일 경로"를 이미 만들어 둔 뒤 queue에 넣는다. 제품 UX 목표는 웹에서 자연어 작업 설명, 참고할 spec/docs/assets path를 입력하면 pando가 canonical `brief.md`를 생성하고 queue에 넣는 것이다. file-path submit은 advanced/debug path로 남긴다.

## Watch status

```bash
PANDO_API_URL=http://127.0.0.1:3210 \
  pnpm tsx src/cli/agentctl.ts list

PANDO_DB="$ROOT/pando.sqlite" \
  pnpm tsx src/cli/agentctl.ts show pando-small-task
```

## PR behavior

The `PR` stage is a real worker stage. It asks Claude Code to:

1. run `pnpm verify`
2. commit with an English message
3. push the branch
4. create a Draft PR against the repo base branch with `gh pr create`

Do not expose this server outside a private local network. Public auth is intentionally not implemented.

## Current friction found by self-dogfood

- Starting pando still requires too many environment variables.
- To run multiple pando self-dogfood jobs concurrently, jobs should be queued before starting the daemon, and both `PANDO_GLOBAL_CONCURRENCY` and the repo profile `concurrency` must allow the desired count.
- The PR stage prompt says Draft PR, but recent self-dogfood produced non-draft PRs. Add a deterministic check or force `gh pr create --draft`.
- Evidence and temporary DB/worktrees should stay under `/tmp`; do not commit them.
