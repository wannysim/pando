# Two-job smoke runbook

W5 PR 7 kept live validation intentionally small: exactly two jobs, with global concurrency set to 2 or 3. If CLI auth, provider auth, repo mounts, or cost controls are not ready, record deterministic fake smoke evidence instead.

There are now two host live scopes:

- **Worker probe**: one Claude Code worker job and one Codex worker job run in isolated directories and record deterministic exit-code evidence.
- **Full daemon live dogfood**: two `pando` self-profile jobs run through `runDaemonOnce`, then a follow-up single pando dogfood job runs through the same host path.

Production `src/server.ts` still serves API/static dashboard only; always-on daemon loop wiring remains a separate follow-up.

## Preconditions

- `PANDO_GLOBAL_CONCURRENCY` is `2` or `3`.
- SQLite is mounted at `/data/pando.sqlite`.
- Target repos are mounted under `/repos`.
- Worktrees are mounted under `/worktrees`.
- Runtime config is mounted at `/config`.
- Skills are mounted read-only at `/skills`.
- Claude and Codex authentication are available through API keys or auth volumes.

## Host worker readiness

Use this before a host-mode live worker smoke:

```bash
PANDO_GLOBAL_CONCURRENCY=2 \
  pnpm smoke:two-job -- --mode readiness --target host \
  --evidence /tmp/pando-host-readiness.json
```

The readiness evidence records:

- `globalConcurrency.value` and `withinLiveCap`
- `workerCli.commands.claude/codex.available`
- auth signals as booleans only (`ANTHROPIC_API_KEY`, `CLAUDE_CONFIG_DIR`, `OPENAI_API_KEY`, `CODEX_HOME`, or default config dirs)
- `gitCreds.signals` git push / PR credential presence as booleans only (deploy key, known_hosts, credential store, gitconfig, `GH_TOKEN` / `GITHUB_TOKEN`). Recorded, not a hard blocker; key/token values are never recorded
- host path readiness for SQLite parent, repos, worktrees, config, and skills

Do not commit evidence files; keep them under `/tmp` or another non-repo path. The
default evidence path `smoke/evidence/` is gitignored.

## Host live worker smoke

Run exactly two worker jobs with global cap 2 or 3:

```bash
mkdir -p /tmp/pando-live-worker-smoke

PANDO_GLOBAL_CONCURRENCY=2 \
PANDO_WORKTREE_ROOT=/tmp/pando-live-worker-smoke \
PANDO_SMOKE_RUN_ID="$(date +%Y%m%d-%H%M%S)" \
  pnpm smoke:two-job -- --mode live --target host \
  --evidence /tmp/pando-live-worker-smoke/live-worker-smoke.json
```

Success criteria:

- `mode` is `live`.
- `jobs` contains exactly `SMOKE-LIVE-CLAUDE` and `SMOKE-LIVE-CODEX`.
- both workers have `exitCode: 0` and `timedOut: false`.
- `checks.globalConcurrency.withinLiveCap` is `true`.
- `checks.worktreeCollision.pass` is `true`.
- `checks.providerCap.pass` is `true`.
- `checks.gateEvidence.pass` is `true`.

The smoke script records deterministic worker evidence (`exitCode`, `timedOut`, optional signal, stdout/stderr byte counts). It must not use LLM output text for pass/fail.

2026-06-06 host result: passed with global cap `2`. Claude Code and Codex both exited `0`, worktree paths were distinct, provider usage stayed within cap, and gate evidence was deterministic exit-code JSON.

## Host full daemon contract smoke

Use this PR 1 contract before live full-daemon workers. It runs exactly two `pando` brief jobs through `runDaemonOnce` with the real host worktree provisioner, checked-in stage config, real `ClaudeCodeEngine`/`CodexEngine` adapter classes, and deterministic package-action gate classes. In `contract` mode, worker and gate process runners are injected fakes, so this path does not call Claude/Codex or judge LLM output text.

```bash
RUN_ID="contract-$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-full-daemon-smoke-$RUN_ID"

pnpm smoke:full-daemon -- \
  --mode contract \
  --global-concurrency 2 \
  --worktree-root "$ROOT/worktrees" \
  --db "$ROOT/pando.sqlite" \
  --evidence "$ROOT/full-daemon-smoke.json" \
  --run-id "$RUN_ID"
```

Success criteria:

- `mode` is `contract`.
- `jobs` contains exactly `PANDO-FULL-SMOKE-1` and `PANDO-FULL-SMOKE-2`.
- both jobs finish `DONE`.
- `checks.twoJobsClaimed.actual` is `2`.
- `checks.globalConcurrency.value` is `2` or `3`, and `withinLiveCap` is `true`.
- `checks.worktreeCollision.pass` is `true`.
- `checks.providerCap.pass` is `true`.
- `checks.gateEvidence.pass` is `true`, with structured JSON evidence from `test`, `lint`, and `types` package-action gates.

2026-06-07 host contract result: passed with global cap `2`. Evidence: `/tmp/pando-full-daemon-smoke-contract-20260607-003713/full-daemon-smoke.json`. Both pando brief jobs finished `DONE`, worktree paths were distinct, provider usage was `{}`, and each job recorded three structured gate evidence entries. This is the baseline to run before live full-daemon workers.

## Host full daemon live dogfood

After the contract smoke passes, run the host full-daemon live smoke with exactly two `pando` self-profile jobs and global concurrency fixed at `2`. This path uses real Claude Code and Codex workers through `runDaemonOnce`.

```bash
RUN_ID="live-$(date +%Y%m%d-%H%M%S)"
ROOT="/tmp/pando-full-daemon-smoke-$RUN_ID"

pnpm smoke:full-daemon -- \
  --mode live \
  --global-concurrency 2 \
  --worktree-root "$ROOT/worktrees" \
  --db "$ROOT/pando.sqlite" \
  --evidence "$ROOT/full-daemon-smoke.json" \
  --run-id "$RUN_ID"
```

Success criteria:

- `mode` is `live`.
- `jobs` contains exactly `PANDO-FULL-SMOKE-1` and `PANDO-FULL-SMOKE-2`.
- both jobs finish `DONE`.
- `checks.twoJobsClaimed.actual` is `2`.
- `checks.globalConcurrency.value` is `2`, and `withinLiveCap` is `true`.
- `checks.worktreeCollision.pass`, `checks.providerCap.pass`, and `checks.gateEvidence.pass` are all `true`.
- DB events include real worker execution events, stage duration payloads, and structured gate evidence. If a worker fails, preserve the failure payload instead of relying on LLM output text.

2026-06-07 host live result:

- Baseline contract evidence: `/tmp/pando-full-daemon-smoke-contract-20260607-003713/full-daemon-smoke.json`.
- Initial live failure evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-failure-evidence.json`.
- Live resume evidence: `/tmp/pando-full-daemon-smoke-live-20260607-003749/live-resume-evidence.json`.
- Follow-up dogfood evidence: `/tmp/pando-full-daemon-dogfood-20260607-010122/dogfood-evidence.json`.

The initial live run used exactly two jobs with global concurrency `2` and exposed a Codex TEST-stage stdin wait: both Codex workers reported `Reading additional input from stdin...` after termination. The fix is to run Codex through `spawn(..., { stdio: ["ignore", "pipe", "pipe"] })` so stdin is closed. After that runner fix, the same two DB jobs resumed to `DONE` without enqueueing more live smoke jobs.

## Docker worker readiness

The readiness smoke runs the same `pnpm smoke:two-job -- --mode readiness` contract
*inside the container*, against the `docker` target. It records, as structured JSON,
which class of blocker is open: CLI, auth, or mount. See `deploy/README.md`
"Worker readiness" for the full CLI/auth/git decision and tradeoffs.

### Step 1 — baseline (proves the blocker class)

After building the image, run a one-off container with only the base mount
contract (no CLI, no auth):

```bash
docker compose -f deploy/docker-compose.yml build pando
mkdir -p /tmp/pando-docker-readiness/data /tmp/pando-docker-readiness/evidence

docker run --rm \
  -e PANDO_GLOBAL_CONCURRENCY=2 \
  -e PANDO_DB=/data/pando.sqlite \
  -e PANDO_REPOS_ROOT=/repos \
  -e PANDO_WORKTREE_ROOT=/worktrees \
  -e PANDO_CONFIG_DIR=/config \
  -e PANDO_SKILLS_ROOT=/skills \
  -v /tmp/pando-docker-readiness/data:/data \
  -v "$HOME/Github":/repos \
  -v "$HOME/.worktrees":/worktrees \
  -v "$PWD/config":/config:ro \
  -v "$HOME/.ai-skills":/skills:ro \
  -v /tmp/pando-docker-readiness/evidence:/evidence \
  deploy-pando:latest \
  node scripts/two-job-smoke.mjs --mode readiness --target docker \
  --evidence /evidence/docker-readiness.json
```

### Step 2 — make workers ready

Pick a CLI strategy (`deploy/README.md` covers the tradeoffs):

- **macOS host:** build with the opt-in install layer (Dockerfile option B). The
  host's `~/.local/bin` binaries are Mach-O and will NOT run in the container.

  ```bash
  PANDO_INSTALL_WORKER_CLIS=true \
    docker compose -f deploy/docker-compose.yml build pando
  ```

  Versions pin via `PANDO_CLAUDE_CLI_VERSION` / `PANDO_CODEX_CLI_VERSION`
  (defaults `2.1.167` / `0.137.0`).
- **Linux host:** bind-mount the host CLI bin at `/worker-bin` (compose mount #1).

Then add the auth volumes and re-run with the CLI image:

```bash
docker run --rm \
  -e PANDO_GLOBAL_CONCURRENCY=2 \
  -e PANDO_DB=/data/pando.sqlite -e PANDO_REPOS_ROOT=/repos \
  -e PANDO_WORKTREE_ROOT=/worktrees -e PANDO_CONFIG_DIR=/config \
  -e PANDO_SKILLS_ROOT=/skills \
  -e CLAUDE_CONFIG_DIR=/root/.claude -e CODEX_HOME=/root/.codex \
  -v /tmp/pando-docker-readiness/data:/data \
  -v "$HOME/Github":/repos -v "$HOME/.worktrees":/worktrees \
  -v "$PWD/config":/config:ro -v "$HOME/.ai-skills":/skills:ro \
  -v "$HOME/.claude":/root/.claude:ro -v "$HOME/.codex":/root/.codex:ro \
  -v "$HOME/.ssh/id_ed25519":/root/.ssh/id_ed25519:ro \
  -v /tmp/pando-docker-readiness/evidence:/evidence \
  deploy-pando:latest \
  node scripts/two-job-smoke.mjs --mode readiness --target docker \
  --evidence /evidence/docker-readiness-cli-installed.json
```

The optional SSH deploy-key mount above lets the `gitCreds` probe report
`sshReady: true`; drop it for a CLI/auth-only check.

### Interpreting the evidence

- `checks.workerCli.commands.{claude,codex}.available` -> CLI blocker.
- `checks.auth.signals.{claude,codex}` (booleans only) -> auth blocker.
- `checks.gitCreds.signals` (booleans + deploy-key path only) -> git push / PR
  credential presence. Recorded, not a hard blocker.
- `checks.mounts.paths.*.ready` -> mount blocker.
- `blockers[]` empty == ready for a live Docker worker smoke.

### 2026-06-07 Docker readiness result (verified in this environment)

- **Baseline** (`/tmp/pando-docker-readiness/evidence/docker-readiness.json`):
  mount contract `pass` and global cap `withinLiveCap: true`, but
  `blockers` = `[claude CLI not available, codex CLI not available, Claude auth not
  configured, Codex auth not configured]`. So the open blocker is **CLI + auth**, not
  mounts.
- **Auth volume mounted** (`docker-readiness-mounted.json`): mounting `~/.claude` /
  `~/.codex` at `/root/.claude` / `/root/.codex` flips `auth.pass` to `true`
  (`configDirPresent: true`). Auth-by-volume works.
- **Host bin mounted, macOS host**: mounting `~/.local/bin` at `/worker-bin` did
  **not** make the CLI available — `workerCli.pass` stayed `false`. The host
  binaries are Mach-O arm64; the `linux/arm64` container cannot exec them. This is
  the recorded reason the host-bin shortcut fails on macOS.
- **Linux CLI installed in image** (`docker-readiness-cli-installed.json`): with
  the opt-in install layer (`PANDO_INSTALL_WORKER_CLIS=true`) plus the auth volumes,
  `blockers` = `[]`, `workerCli.pass: true` (`claude 2.1.167`, `codex-cli 0.137.0`),
  `auth.pass: true`, `mounts.pass: true`. **This is the path that unblocks a live
  Docker worker smoke on a macOS host.**

Remaining gap before a live Docker worker smoke: a live confirmation that the
Claude managed connector is inherited in the container — if it is not, fall back to
API-key mode / Jira REST (ADR candidates in `deploy/README.md`). The connector check
requires real model calls and was not run here. Git push / PR credentials are now a
recorded `gitCreds` probe signal (deploy key or credential store, see
`deploy/README.md`); mount one before the PR stage.

## Docker HTTP smoke

Before live workers, verify the single-container deployment shape:

```bash
docker compose -f deploy/docker-compose.yml up --build -d
curl -fsS http://127.0.0.1:3210/health
curl -fsSI http://127.0.0.1:3210/dashboard
curl -fsS -X POST http://127.0.0.1:3210/briefs \
  -H 'content-type: application/json' \
  -d '{"id":"docker-smoke-1","repo":"pando","title":"Docker smoke"}'
curl -fsS http://127.0.0.1:3210/jobs
docker compose -f deploy/docker-compose.yml down -v
```

2026-06-06 result: image build passed, compose container became `healthy`, `/health` returned JSON 200, `/dashboard` and dashboard static assets returned 200, and brief enqueue/list returned 200.

## Live checks

1. Submit exactly two jobs.
2. Confirm both jobs have distinct worktree paths.
3. Confirm provider usage never exceeds configured provider caps.
4. Confirm stage/gate events include deterministic evidence such as exit code, checksum, or structured JSON.

## Deterministic fallback

```bash
pnpm smoke:two-job -- --mode fake --evidence smoke/evidence/two-job-smoke-fake.json
```

Use fallback when live credentials, repo mounts, provider access, or cost approval are missing. The evidence file must include the fallback reason and the same four checks as the live smoke.
