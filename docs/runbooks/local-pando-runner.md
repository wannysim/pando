# Local pando runner

이 runbook은 로컬에서 pando API/dashboard를 띄운 뒤, 같은 SQLite queue를 local daemon loop가 처리하게 하는 최소 경로다.

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
